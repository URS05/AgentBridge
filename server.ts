import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import { verifyAuditChain, verifyJourneyAuditChain } from './src/core/audit';
import { buildTimeSeriesBuckets, computePercentiles, deriveClusterKey, groupJourneysIntoTopIssues } from './src/core/clustering';
import { TEAM_ROSTER, type DepartmentHealth, type StageName } from './src/core/types';
import { store } from './src/server/store';
import { sseHub } from './src/server/sse';
import {
  approveSourceKycAndResume,
  assignClusterOwner,
  assignJourneyOwner,
  bulkResolveCluster,
  cancelJourney,
  decideApprovalRequest,
  probeProtocolConnections,
  recheckAndResumeJourney,
  runA2ABatchSimulation,
  simulateDuplicateActivation,
  startNewJourney,
} from './src/server/workflowEngine';
import { handleChatRequest } from './src/server/chatAssistant';
import {
  getVoiceCapabilities,
  synthesizeSpeechWithSarvam,
  transcribeAudioWithSarvam,
} from './src/server/sarvamVoice';

const PORT = Number(process.env.PORT ?? 3000);
const isProduction = process.env.NODE_ENV === 'production';

async function createApp() {
  const app = express();
  app.use(express.json({ limit: '8mb' }));

  // Request correlation header
  app.use((req, res, next) => {
    const reqId = (req.headers['x-request-id'] as string) || `req_${Date.now().toString(36)}`;
    res.setHeader('x-request-id', reqId);
    next();
  });

  // Health endpoint
  app.get('/api/v1/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'agentbridge-control-tower',
      environment: 'SIMULATED',
      timestamp: new Date().toISOString(),
    });
  });

  // Live SSE Event Stream
  app.get('/api/v1/events/stream', (_req, res) => {
    sseHub.subscribe(res);
  });

  // Overview KPI & Summary (computed strictly from store records)
  app.get('/api/v1/overview', (_req, res) => {
    const state = store.getState();
    const journeys = state.journeys;

    let activeJourneys = 0;
    let verifiedJourneys = 0;
    let blockedJourneys = 0;
    let pendingVerification = 0;
    let failedJourneys = 0;
    let needsHumanJourneys = 0;
    const teamCounts = new Map<string, number>();
    for (const member of TEAM_ROSTER) teamCounts.set(member, 0);
    teamCounts.set('Unassigned', 0);

    for (const j of journeys) {
      if (j.status === 'RUNNING') activeJourneys += 1;
      else if (j.status === 'VERIFIED') verifiedJourneys += 1;
      else if (j.status === 'BLOCKED') blockedJourneys += 1;
      else if (j.status === 'VERIFICATION_PENDING') pendingVerification += 1;
      else if (j.status === 'FAILED') failedJourneys += 1;
      else if (j.status === 'NEEDS_HUMAN') needsHumanJourneys += 1;

      if (['BLOCKED', 'NEEDS_HUMAN', 'VERIFICATION_PENDING', 'FAILED'].includes(j.status)) {
        const owner = j.assignedTo ?? 'Unassigned';
        teamCounts.set(owner, (teamCounts.get(owner) ?? 0) + 1);
      }
    }

    const humanEscalations = state.approvalRequests.filter((a) => a.status === 'PENDING').length;

    const kpis = {
      activeJourneys,
      verifiedJourneys,
      blockedJourneys,
      pendingVerification,
      failedJourneys,
      humanEscalations,
      totalJourneys: journeys.length,
    };

    const systemsOutage = state.integrations.filter((i) => i.status === 'OUTAGE').length;
    const systemsDegraded = state.integrations.filter((i) => i.status === 'DEGRADED').length;
    const systemsHealthy = state.integrations.filter((i) => i.status === 'HEALTHY').length;

    const piProtocols = state.integrations.filter((i) =>
      ['PI_RUNTIME', 'AGENT_PROTOCOL', 'TOOL_PROTOCOL'].includes(i.category)
    );
    const gateways = state.integrations.filter((i) => i.category === 'SOURCE_SYSTEM');

    const pulse = {
      needsActionNow: blockedJourneys + pendingVerification + failedJourneys + needsHumanJourneys,
      verifiedToday: verifiedJourneys,
      systemsHealthy,
      systemsTotal: state.integrations.length,
      systemsOutage,
      systemsDegraded,
      piProtocolsHealthy: piProtocols.filter((i) => i.status === 'HEALTHY').length,
      piProtocolsTotal: piProtocols.length,
      gatewaysHealthy: gateways.filter((i) => i.status === 'HEALTHY').length,
      gatewaysTotal: gateways.length,
    };

    const topIssues = groupJourneysIntoTopIssues(
      journeys,
      state.stages,
      state.approvalRequests,
      Date.now(),
      5
    );

    const journeyById = new Map(journeys.map((j) => [j.id, j]));
    const intById = new Map(state.integrations.map((i) => [i.id, i]));
    const basePiHealthy =
      intById.get('int_pi_rpc')?.status === 'HEALTHY' &&
      intById.get('int_pi_sdk')?.status === 'HEALTHY' &&
      intById.get('int_mcp_server')?.status === 'HEALTHY' &&
      intById.get('int_acp_gate')?.status === 'HEALTHY';
    const a2aHealthy = intById.get('int_a2a_bus')?.status === 'HEALTHY';

    const deptDefs: Array<{
      stageName: StageName;
      departmentName: string;
      roleLabel: string;
      gatewayId: string;
      gatewayName: string;
      requiresA2A: boolean;
      defaultPath: string;
    }> = [
      {
        stageName: 'SALES_ONBOARDING',
        departmentName: 'Sales & Intake',
        roleLabel: 'Merchant Profile Setup',
        gatewayId: 'int_merchant_api',
        gatewayName: 'Merchant API',
        requiresA2A: false,
        defaultPath: '/journeys',
      },
      {
        stageName: 'KYC_VERIFICATION',
        departmentName: 'KYC Verification',
        roleLabel: 'Bank KYC Check',
        gatewayId: 'int_kyc_api',
        gatewayName: 'Bank KYC API',
        requiresA2A: true,
        defaultPath: '/journeys?status=BLOCKED',
      },
      {
        stageName: 'RISK_ASSESSMENT',
        departmentName: 'Compliance & Risk',
        roleLabel: 'Risk & Policy Review',
        gatewayId: 'int_risk_api',
        gatewayName: 'Risk Engine API',
        requiresA2A: true,
        defaultPath: '/approvals',
      },
      {
        stageName: 'OPERATIONS_ACTIVATION',
        departmentName: 'Operations & Activation',
        roleLabel: 'Account Go-Live',
        gatewayId: 'int_activation_api',
        gatewayName: 'Activation API',
        requiresA2A: true,
        defaultPath: '/journeys',
      },
    ];

    const departments: DepartmentHealth[] = deptDefs.map((def) => {
      const gw = intById.get(def.gatewayId);
      const gatewayStatus = gw?.status ?? 'HEALTHY';
      const gatewayLatencyMs = gw?.latencyMs ?? 0;
      const protocolHealthy = basePiHealthy && (!def.requiresA2A || a2aHealthy);

      let blockedCount = 0;
      let waitingApprovalCount = 0;
      for (const j of journeys) {
        if (j.currentStage !== def.stageName) continue;
        if (['BLOCKED', 'FAILED', 'VERIFICATION_PENDING'].includes(j.status)) blockedCount += 1;
        else if (j.status === 'NEEDS_HUMAN') waitingApprovalCount += 1;
      }

      let verifiedCount = 0;
      let waitingUpstreamCount = 0;
      for (const stg of state.stages) {
        if (stg.stageName !== def.stageName) continue;
        if (stg.status === 'VERIFIED') {
          verifiedCount += 1;
        } else if (stg.status === 'NOT_STARTED') {
          const parent = journeyById.get(stg.journeyId);
          if (parent && ['BLOCKED', 'NEEDS_HUMAN', 'VERIFICATION_PENDING'].includes(parent.status)) {
            waitingUpstreamCount += 1;
          }
        }
      }

      let readiness: DepartmentHealth['readiness'] = 'GOOD_TO_GO';
      let readinessLabel = 'Good to Go';
      let summary = `${verifiedCount.toLocaleString()} verified · ${def.gatewayName} (${gatewayLatencyMs} ms)`;
      let targetPath = def.defaultPath;

      if (gatewayStatus !== 'HEALTHY' || !protocolHealthy) {
        readiness = 'OFFLINE';
        readinessLabel = gatewayStatus !== 'HEALTHY' ? 'Gateway Offline' : 'Protocol Offline';
        summary =
          gatewayStatus !== 'HEALTHY'
            ? `${def.gatewayName} is offline — cases paused safely`
            : 'Pi Agent / A2A / MCP / ACP link offline — check Topology';
        targetPath = '/integrations';
      } else if (blockedCount > 0) {
        readiness = 'ATTENTION_NEEDED';
        readinessLabel = `${blockedCount.toLocaleString()} Blocked`;
        summary = `${blockedCount.toLocaleString()} waiting on verification · ${def.gatewayName} (${gatewayLatencyMs} ms)`;
        targetPath = '/journeys?status=BLOCKED';
      } else if (waitingApprovalCount > 0) {
        readiness = 'ATTENTION_NEEDED';
        readinessLabel = `${waitingApprovalCount.toLocaleString()} Sign-Off Waiting`;
        summary = `${waitingApprovalCount.toLocaleString()} awaiting manager decision · ${def.gatewayName} (${gatewayLatencyMs} ms)`;
        targetPath = '/approvals';
      } else if (waitingUpstreamCount > 0) {
        readiness = 'WAITING_UPSTREAM';
        readinessLabel = `${waitingUpstreamCount.toLocaleString()} Held Upstream`;
        summary = `${verifiedCount.toLocaleString()} live · ${waitingUpstreamCount.toLocaleString()} held safely upstream`;
        targetPath = '/journeys';
      }

      return {
        stageName: def.stageName,
        departmentName: def.departmentName,
        roleLabel: def.roleLabel,
        readiness,
        readinessLabel,
        blockedCount,
        waitingApprovalCount,
        waitingUpstreamCount,
        verifiedCount,
        gatewayName: def.gatewayName,
        gatewayStatus,
        gatewayLatencyMs,
        protocolHealthy,
        summary,
        targetPath,
      };
    });

    const teamLoad = [
      ...TEAM_ROSTER.map((name) => ({ name, activeCount: teamCounts.get(name) ?? 0 })),
      { name: 'Unassigned', activeCount: teamCounts.get('Unassigned') ?? 0 },
    ];

    const mismatches = state.validationChecks
      .filter((c) => c.validationType === 'BUSINESS_OUTCOME' && (c.result === 'MISMATCH' || c.result === 'UNAVAILABLE'))
      .slice(0, 8)
      .map((check) => {
        const journey = journeys.find((j) => j.id === check.journeyId);
        const stage = state.stages.find((s) => s.id === check.stageId);
        const evidence = check.evidenceId
          ? state.evidenceRecords.find((e) => e.id === check.evidenceId) ?? null
          : null;
        return {
          ...check,
          merchantName: journey?.merchantName ?? 'Unknown Merchant',
          externalReference: journey?.externalReference ?? '',
          journeyStatus: journey?.status ?? 'BLOCKED',
          reportedState: stage?.reportedState ?? null,
          evidence,
        };
      });

    const recentAuditEvents = [...state.auditEvents].slice(-12).reverse();
    const recentRuns = state.agentRuns.slice(0, 8).map((run) => {
      const agent = state.agents.find((a) => a.id === run.agentId);
      const journey = journeys.find((j) => j.id === run.journeyId);
      return {
        ...run,
        agentName: agent?.name ?? run.agentId,
        merchantName: journey?.merchantName ?? run.journeyId,
      };
    });

    res.json({
      environment: 'SIMULATED',
      kpis,
      pulse,
      departments,
      topIssues,
      teamLoad,
      teamRoster: [...TEAM_ROSTER],
      mismatches,
      recentAuditEvents,
      recentRuns,
      integrations: state.integrations,
      agents: state.agents,
      journeys: journeys.slice(0, 8),
    });
  });

  // List journeys with optional filtering + server-side pagination
  app.get('/api/v1/journeys', (req, res) => {
    const state = store.getState();
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const scenario = typeof req.query.scenario === 'string' ? req.query.scenario : '';
    const verification = typeof req.query.verification === 'string' ? req.query.verification : '';
    const assignedTo = typeof req.query.assignedTo === 'string' ? req.query.assignedTo : '';
    const clusterKey = typeof req.query.clusterKey === 'string' ? req.query.clusterKey : '';
    const search = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 25) || 25));

    let filtered = state.journeys;

    if (status && status !== 'ALL') {
      filtered = filtered.filter((j) => j.status === status);
    }
    if (scenario && scenario !== 'ALL') {
      filtered = filtered.filter((j) => j.scenario === scenario);
    }
    if (verification && verification !== 'ALL') {
      filtered = filtered.filter((j) => j.verificationStatus === verification);
    }
    if (assignedTo && assignedTo !== 'ALL') {
      if (assignedTo === 'UNASSIGNED') {
        filtered = filtered.filter((j) => !j.assignedTo);
      } else {
        filtered = filtered.filter((j) => j.assignedTo === assignedTo);
      }
    }
    if (clusterKey && clusterKey !== 'ALL') {
      filtered = filtered.filter((j) => deriveClusterKey(j) === clusterKey);
    }
    if (search) {
      filtered = filtered.filter(
        (j) =>
          j.id.toLowerCase().includes(search) ||
          j.externalReference.toLowerCase().includes(search) ||
          j.merchantName.toLowerCase().includes(search) ||
          j.workflowId.toLowerCase().includes(search) ||
          (j.assignedTo ?? '').toLowerCase().includes(search)
      );
    }

    const total = filtered.length;
    const offset = (page - 1) * pageSize;
    const paged = filtered.slice(offset, offset + pageSize);
    const pagedIds = new Set(paged.map((j) => j.id));
    const stagesByJourney = new Map<string, typeof state.stages>();
    for (const s of state.stages) {
      if (!pagedIds.has(s.journeyId)) continue;
      const list = stagesByJourney.get(s.journeyId);
      if (list) list.push(s);
      else stagesByJourney.set(s.journeyId, [s]);
    }

    const items = paged.map((j) => ({
      ...j,
      stages: (stagesByJourney.get(j.id) ?? []).sort((a, b) => a.order - b.order),
    }));

    res.json({ journeys: items, total, page, pageSize });
  });

  // Start a new journey
  const StartJourneySchema = z.object({
    merchantName: z.string().trim().min(2, 'Merchant name must be at least 2 characters').max(80),
    scenario: z.enum([
      'FALSE_COMPLETION',
      'NORMAL',
      'API_TIMEOUT',
      'DUPLICATE_ATTEMPT',
      'DELAYED_CONSISTENCY',
      'SOURCE_UNAVAILABLE',
      'HUMAN_APPROVAL',
    ]),
  });

  app.post('/api/v1/journeys', async (req, res, next) => {
    try {
      const parsed = StartJourneySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request payload' });
        return;
      }
      const journey = await startNewJourney(parsed.data);
      res.status(201).json({ journey });
    } catch (err) {
      next(err);
    }
  });

  // Get single journey detail
  app.get('/api/v1/journeys/:id', (req, res) => {
    const state = store.getState();
    const journey = state.journeys.find((j) => j.id === req.params.id);
    if (!journey) {
      res.status(404).json({ error: 'Journey not found' });
      return;
    }

    const stages = state.stages.filter((s) => s.journeyId === journey.id).sort((a, b) => a.order - b.order);
    const agentRuns = state.agentRuns.filter((r) => r.journeyId === journey.id);
    const validationChecks = state.validationChecks.filter((c) => c.journeyId === journey.id);
    const evidenceRecords = state.evidenceRecords.filter((e) => e.journeyId === journey.id);
    const auditEvents = state.auditEvents.filter((e) => e.journeyId === journey.id).sort((a, b) => a.sequence - b.sequence);
    const approvalRequests = state.approvalRequests.filter((a) => a.journeyId === journey.id);
    const idempotencyKeys = state.idempotencyKeys.filter((k) => k.journeyId === journey.id);
    const auditVerification = verifyJourneyAuditChain(state.auditEvents, journey.id);

    const authoritativeState = {
      merchant: state.authoritative.merchants[journey.externalReference] ?? null,
      kyc: state.authoritative.kyc[journey.externalReference] ?? null,
      risk: state.authoritative.risk[journey.externalReference] ?? null,
      activation: state.authoritative.activations[journey.externalReference] ?? null,
    };

    res.json({
      journey,
      stages,
      handoffs: journey.handoffs ?? [],
      agentRuns,
      validationChecks,
      evidenceRecords,
      auditEvents,
      auditVerification,
      approvalRequests,
      idempotencyKeys,
      authoritativeState,
    });
  });

  // Assign a 7-person ops owner to a single journey
  app.post('/api/v1/journeys/:id/assign', (req, res, next) => {
    try {
      const owner = typeof req.body?.owner === 'string' && req.body.owner.trim() ? req.body.owner.trim() : null;
      const journey = assignJourneyOwner(req.params.id, owner);
      res.json({ journey });
    } catch (err) {
      next(err);
    }
  });

  // Assign owner to an entire issue cluster
  app.post('/api/v1/issues/assign', (req, res) => {
    const clusterKey = typeof req.body?.clusterKey === 'string' ? req.body.clusterKey : '';
    const owner = typeof req.body?.owner === 'string' && req.body.owner.trim() ? req.body.owner.trim() : null;
    if (!clusterKey) {
      res.status(400).json({ error: 'clusterKey is required' });
      return;
    }
    const updatedCount = assignClusterOwner(clusterKey, owner);
    res.json({ ok: true, updatedCount });
  });

  // Bulk resolve / recheck an issue cluster
  app.post('/api/v1/issues/bulk-resolve', async (req, res, next) => {
    try {
      const clusterKey = typeof req.body?.clusterKey === 'string' ? req.body.clusterKey : undefined;
      const approveKycFirst = Boolean(req.body?.approveKycFirst);
      const result = await bulkResolveCluster({ clusterKey, approveKycFirst });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // High-volume A2A study batch simulator
  const BatchSimSchema = z.object({
    count: z.number().int().min(10).max(10000).default(500),
    mismatchRatePct: z.number().min(0).max(80).default(12),
    timeoutRatePct: z.number().min(0).max(80).default(6),
    highRiskRatePct: z.number().min(0).max(80).default(7),
    spreadHours: z.number().min(1).max(168).default(24),
  });

  app.post('/api/v1/simulator/batch', (req, res) => {
    const parsed = BatchSimSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid batch simulation configuration' });
      return;
    }
    const result = runA2ABatchSimulation(parsed.data);
    res.status(201).json(result);
  });

  // Recheck & resume workflow
  app.post('/api/v1/journeys/:id/recheck', async (req, res, next) => {
    try {
      const journey = await recheckAndResumeJourney(req.params.id);
      res.json({ journey });
    } catch (err) {
      next(err);
    }
  });

  // Transition Mock Authoritative KYC API to APPROVED & trigger workflow recheck
  app.post('/api/v1/journeys/:id/approve-source-kyc', async (req, res, next) => {
    try {
      const journey = await approveSourceKycAndResume(req.params.id);
      res.json({ journey });
    } catch (err) {
      next(err);
    }
  });

  // Simulate duplicate activation attempt to prove idempotency guard
  app.post('/api/v1/journeys/:id/simulate-duplicate', async (req, res, next) => {
    try {
      const result = await simulateDuplicateActivation(req.params.id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // Cancel journey
  app.post('/api/v1/journeys/:id/cancel', (req, res, next) => {
    try {
      const journey = cancelJourney(req.params.id);
      res.json({ journey });
    } catch (err) {
      next(err);
    }
  });

  // Validation Centre (capped at latest 100 checks for fast rendering under high volume)
  app.get('/api/v1/validations', (req, res) => {
    const state = store.getState();
    const type = typeof req.query.type === 'string' ? req.query.type : 'ALL';
    const resultFilter = typeof req.query.result === 'string' ? req.query.result : 'ALL';

    const journeyById = new Map(state.journeys.map((j) => [j.id, j]));
    const stageById = new Map(state.stages.map((s) => [s.id, s]));
    const evidenceById = new Map(state.evidenceRecords.map((e) => [e.id, e]));

    let filtered = state.validationChecks;
    if (type !== 'ALL') {
      filtered = filtered.filter((c) => c.validationType === type);
    }
    if (resultFilter !== 'ALL') {
      filtered = filtered.filter((c) => c.result === resultFilter);
    }

    const checks = filtered.slice(0, 100).map((c) => {
      const journey = journeyById.get(c.journeyId);
      const stage = stageById.get(c.stageId);
      const evidence = c.evidenceId ? evidenceById.get(c.evidenceId) ?? null : null;
      return {
        ...c,
        merchantName: journey?.merchantName ?? '',
        externalReference: journey?.externalReference ?? '',
        reportedState: stage?.reportedState ?? null,
        evidence,
      };
    });

    res.json({
      checks,
      totalChecks: filtered.length,
      idempotencyKeys: state.idempotencyKeys.slice(0, 50),
    });
  });

  // Agents Registry
  app.get('/api/v1/agents', (_req, res) => {
    const state = store.getState();
    const agents = state.agents.map((agent) => {
      const runs = state.agentRuns.filter((r) => r.agentId === agent.id);
      const failedRuns = runs.filter((r) => r.executionStatus !== 'SUCCESS').length;
      const avgLatencyMs = runs.length
        ? Math.round(runs.reduce((acc, r) => acc + r.latencyMs, 0) / runs.length)
        : 0;
      return {
        ...agent,
        totalRuns: runs.length,
        failureRate: runs.length ? Number(((failedRuns / runs.length) * 100).toFixed(1)) : 0,
        avgLatencyMs,
        recentRuns: runs.slice(0, 10),
      };
    });
    res.json({ agents });
  });

  // Approvals Queue (capped at 100 newest items to keep UI snappy at 10,000+ cases)
  app.get('/api/v1/approvals', (_req, res) => {
    const state = store.getState();
    const pendingCount = state.approvalRequests.filter((a) => a.status === 'PENDING').length;
    res.json({
      approvals: state.approvalRequests.slice(0, 100),
      totalApprovals: state.approvalRequests.length,
      pendingCount,
    });
  });

  const DecideApprovalSchema = z.object({
    decision: z.enum(['APPROVED', 'REJECTED', 'EVIDENCE_REQUESTED', 'ESCALATED']),
    reviewer: z.string().trim().min(2).default('Compliance Ops Lead'),
    reason: z.string().trim().min(5, 'Decision justification must be at least 5 characters'),
  });

  app.post('/api/v1/approvals/:id/decide', async (req, res, next) => {
    try {
      const parsed = DecideApprovalSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid approval decision payload' });
        return;
      }
      const approval = await decideApprovalRequest({
        approvalId: req.params.id,
        decision: parsed.data.decision,
        reviewer: parsed.data.reviewer,
        reason: parsed.data.reason,
      });
      res.json({ approval });
    } catch (err) {
      next(err);
    }
  });

  // Analytics (100% computed from store records, supports ?window=15m|1h|24h|7d)
  app.get('/api/v1/analytics', (req, res) => {
    const state = store.getState();
    const rawWindow = typeof req.query.window === 'string' ? req.query.window : '24h';
    const windowKey: '15m' | '1h' | '24h' | '7d' =
      rawWindow === '15m' || rawWindow === '1h' || rawWindow === '24h' || rawWindow === '7d' ? rawWindow : '24h';

    const spanMsMap = {
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
    };
    const nowMs = Date.now();
    const cutoffMs = nowMs - spanMsMap[windowKey];

    const windowedJourneys = state.journeys.filter((j) => {
      const t = new Date(j.startedAt).getTime();
      return !Number.isNaN(t) && t >= cutoffMs;
    });
    const windowedIds = new Set(windowedJourneys.map((j) => j.id));

    const total = windowedJourneys.length || 1;
    const verified = windowedJourneys.filter((j) => j.status === 'VERIFIED').length;
    const completedOrTerminated = windowedJourneys.filter((j) =>
      ['VERIFIED', 'FAILED', 'CANCELLED'].includes(j.status)
    ).length;

    const falseCompletions = windowedJourneys.filter((j) => j.verificationStatus === 'MISMATCH').length;
    const duplicateAttempts =
      state.idempotencyKeys.reduce((sum, k) => sum + Math.max(0, k.attemptCount - 1), 0) +
      state.auditEvents.filter((e) => e.eventType === 'DUPLICATE_BLOCKED' && windowedIds.has(e.journeyId)).length;

    const recoveredJourneys = windowedJourneys.filter(
      (j) =>
        j.status === 'VERIFIED' &&
        state.auditEvents.some((e) => e.journeyId === j.id && e.eventType === 'RETRY_EXECUTED')
    ).length;
    const blockedEver = windowedJourneys.filter(
      (j) => j.status === 'BLOCKED' || j.verificationStatus === 'MISMATCH'
    ).length;

    const durations = windowedJourneys.map((j) => j.durationMs).filter((d): d is number => d !== null);
    const avgDurationMs = durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

    // Collect A2A hop and official verification latencies from handoffs (plus agentRuns fallback)
    const a2aHopLatencies: number[] = [];
    const officialVerifyLatencies: number[] = [];
    const endToEndLatencies: number[] = [];

    for (const j of windowedJourneys) {
      if (j.handoffs && j.handoffs.length > 0) {
        let jHopSum = 0;
        for (const h of j.handoffs) {
          a2aHopLatencies.push(h.a2aHopMs);
          officialVerifyLatencies.push(h.officialVerifyMs);
          jHopSum += h.a2aHopMs + h.officialVerifyMs;
        }
        endToEndLatencies.push(jHopSum);
      }
    }
    const runLatencies = state.agentRuns.filter((r) => windowedIds.has(r.journeyId)).map((r) => r.latencyMs);
    const avgVerificationLatencyMs = officialVerifyLatencies.length
      ? Math.round(officialVerifyLatencies.reduce((a, b) => a + b, 0) / officialVerifyLatencies.length)
      : runLatencies.length
        ? Math.round(runLatencies.reduce((a, b) => a + b, 0) / runLatencies.length)
        : 0;

    const humanEscalations = windowedJourneys.filter((j) => j.status === 'NEEDS_HUMAN' || j.scenario === 'HUMAN_APPROVAL').length;

    const stageById = new Map(state.stages.map((s) => [s.id, s]));
    const agentBreakdown = state.agents.map((agent) => {
      const runs = state.agentRuns.filter((r) => r.agentId === agent.id && windowedIds.has(r.journeyId));
      const nonSuccess = runs.filter((r) => r.executionStatus !== 'SUCCESS').length;
      const checks = state.validationChecks.filter((c) => {
        if (!windowedIds.has(c.journeyId)) return false;
        const stg = stageById.get(c.stageId);
        return stg?.agentId === agent.id && c.validationType === 'BUSINESS_OUTCOME';
      });
      const mismatches = checks.filter((c) => c.result === 'MISMATCH' || c.result === 'FAIL').length;
      const lats = runs.map((r) => r.latencyMs);
      const pct = computePercentiles(lats);
      return {
        agentId: agent.id,
        agentName: agent.name,
        totalRuns: runs.length,
        executionFailures: nonSuccess,
        outcomeMismatches: mismatches,
        failureRate: runs.length ? Number((((nonSuccess + mismatches) / Math.max(runs.length, 1)) * 100).toFixed(1)) : 0,
        avgLatencyMs: pct.avg,
        p95LatencyMs: pct.p95,
      };
    });

    const scenarioBreakdown = (
      ['FALSE_COMPLETION', 'NORMAL', 'API_TIMEOUT', 'DUPLICATE_ATTEMPT', 'DELAYED_CONSISTENCY', 'SOURCE_UNAVAILABLE', 'HUMAN_APPROVAL'] as const
    ).map((sc) => ({
      scenario: sc,
      total: windowedJourneys.filter((j) => j.scenario === sc).length,
      verified: windowedJourneys.filter((j) => j.scenario === sc && j.status === 'VERIFIED').length,
      blockedOrPending: windowedJourneys.filter((j) => sc === j.scenario && ['BLOCKED', 'NEEDS_HUMAN', 'VERIFICATION_PENDING', 'FAILED'].includes(j.status)).length,
    }));

    res.json({
      window: windowKey,
      metrics: {
        totalJourneys: windowedJourneys.length,
        allTimeJourneys: state.journeys.length,
        journeyCompletionRate: windowedJourneys.length ? Number(((completedOrTerminated / total) * 100).toFixed(1)) : 0,
        verifiedOutcomeRate: windowedJourneys.length ? Number(((verified / total) * 100).toFixed(1)) : 0,
        falseCompletionDetections: falseCompletions,
        duplicateOperationsPrevented: duplicateAttempts,
        recoverySuccessRate: blockedEver ? Number(((recoveredJourneys / blockedEver) * 100).toFixed(1)) : 100,
        avgVerificationLatencyMs,
        avgJourneyDurationMs: avgDurationMs,
        humanEscalationRate: windowedJourneys.length ? Number(((humanEscalations / total) * 100).toFixed(1)) : 0,
      },
      latencyPercentiles: {
        a2aHop: computePercentiles(a2aHopLatencies),
        officialVerify: computePercentiles(officialVerifyLatencies),
        endToEnd: computePercentiles(endToEndLatencies),
      },
      timeSeries: buildTimeSeriesBuckets(windowedJourneys, windowKey, nowMs),
      agentBreakdown,
      scenarioBreakdown,
    });
  });

  // Audit Logs & SHA-256 Chain Verification (capped to latest 150 matching records)
  app.get('/api/v1/audit', (req, res) => {
    const state = store.getState();
    const eventType = typeof req.query.eventType === 'string' ? req.query.eventType : 'ALL';
    const search = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';

    let events = [...state.auditEvents].sort((a, b) => b.sequence - a.sequence);
    if (eventType !== 'ALL') {
      events = events.filter((e) => e.eventType === eventType);
    }
    if (search) {
      events = events.filter(
        (e) =>
          e.id.toLowerCase().includes(search) ||
          e.journeyId.toLowerCase().includes(search) ||
          e.actorId.toLowerCase().includes(search) ||
          e.eventType.toLowerCase().includes(search) ||
          e.eventHash.toLowerCase().includes(search)
      );
    }

    res.json({ events: events.slice(0, 150), totalEvents: events.length });
  });

  app.get('/api/v1/audit/verify', (_req, res) => {
    const state = store.getState();
    const verification = verifyAuditChain(state.auditEvents);
    res.json(verification);
  });

  // Integrations & Pi Protocols
  app.get('/api/v1/integrations', (_req, res) => {
    const state = store.getState();
    res.json({ integrations: state.integrations });
  });

  app.post('/api/v1/integrations/probe', (_req, res) => {
    const result = probeProtocolConnections();
    res.json(result);
  });

  app.post('/api/v1/integrations/:id/toggle-status', (req, res) => {
    const state = store.getState();
    const integration = state.integrations.find((i) => i.id === req.params.id);
    if (!integration) {
      res.status(404).json({ error: 'Integration not found' });
      return;
    }
    integration.status = integration.status === 'HEALTHY' ? 'OUTAGE' : 'HEALTHY';
    integration.lastCheckedAt = new Date().toISOString();
    store.persist();
    res.json({ integration });
  });

  // Settings & Policies
  app.get('/api/v1/settings', (_req, res) => {
    const state = store.getState();
    res.json({
      policies: state.policies,
      environment: 'SIMULATED',
    });
  });

  const UpdatePolicySchema = z.object({
    blockOnOutcomeMismatch: z.boolean(),
    enforceIdempotency: z.boolean(),
    requireHumanForHighRisk: z.boolean(),
    maxBackoffRetries: z.number().int().min(1).max(10),
    baseBackoffMs: z.number().int().min(100).max(10000),
  });

  app.put('/api/v1/settings/policies', (req, res) => {
    const parsed = UpdatePolicySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid policy configuration' });
      return;
    }
    const state = store.getState();
    state.policies = {
      ...parsed.data,
      allowLlmOverride: false,
    };
    store.persist();
    res.json({ policies: state.policies });
  });

  // Reset demo state cleanly
  app.post('/api/v1/demo/reset', (_req, res) => {
    const fresh = store.reset();
    res.json({ ok: true, journeysCount: fresh.journeys.length });
  });

  // Grounded Assistant Chat & Verification Check Endpoint
  const ChatSchema = z.object({
    message: z.string().trim().min(1, 'Message cannot be empty').max(1000),
    journeyId: z.string().optional(),
    provider: z.enum(['auto', 'sarvam', 'gemini', 'grounded']).optional(),
    language: z.enum(['en', 'hi', 'hinglish', 'ta', 'te']).optional(),
    currentPath: z.string().max(200).optional(),
    history: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string(),
        })
      )
      .optional(),
  });

  app.post('/api/v1/chat', async (req, res, next) => {
    try {
      const parsed = ChatSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid chat payload' });
        return;
      }
      const reply = await handleChatRequest({
        message: parsed.data.message,
        journeyId: parsed.data.journeyId,
        provider: parsed.data.provider,
        language: parsed.data.language,
        currentPath: parsed.data.currentPath,
        history: parsed.data.history,
      });
      res.json(reply);
    } catch (err) {
      next(err);
    }
  });

  // Sarvam AI Voice Endpoints (Speech-to-Text via saaras:v4 & Text-to-Speech via bulbul:v3)
  app.get('/api/v1/voice/capabilities', (_req, res) => {
    res.json(getVoiceCapabilities());
  });

  const SttSchema = z.object({
    audioBase64: z.string().min(8, 'Audio payload is required'),
    mimeType: z.string().optional(),
    language: z.enum(['en', 'hi', 'hinglish', 'ta', 'te']).optional(),
  });

  app.post('/api/v1/voice/stt', async (req, res, next) => {
    try {
      const parsed = SttSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid voice audio payload' });
        return;
      }
      const result = await transcribeAudioWithSarvam(parsed.data);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  const TtsSchema = z.object({
    text: z.string().trim().min(1, 'Text is required').max(2000),
    language: z.enum(['en', 'hi', 'hinglish', 'ta', 'te']).optional(),
    speaker: z.string().optional(),
  });

  app.post('/api/v1/voice/tts', async (req, res, next) => {
    try {
      const parsed = TtsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid text-to-speech payload' });
        return;
      }
      const result = await synthesizeSpeechWithSarvam(parsed.data);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // Central error handler (never leaks raw stack traces to client)
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[AgentBridge API Error]', err.message);
    res.status(400).json({ error: err.message || 'Operation failed' });
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distPath, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found. Run npm run build.');
      }
    });
  }

  return app;
}

createApp().then((app) => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[AgentBridge] Control Tower running on http://0.0.0.0:${PORT} (env=SIMULATED)`);
  });
});
