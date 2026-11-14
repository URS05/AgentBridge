import { createHash } from 'node:crypto';
import type {
  A2AHandoff,
  AgentRun,
  ApprovalRequest,
  AuditEventType,
  BatchSimulationConfig,
  EvidenceRecord,
  Journey,
  JourneyScenario,
  JourneyStage,
  StageName,
  ValidationCheck,
} from '../core/types';
import { TEAM_ROSTER } from '../core/types';
import { GENESIS_HASH, createAuditEvent } from '../core/audit';
import { deriveClusterKey } from '../core/clustering';
import { calculateBackoffDelayMs, deriveJourneyStatus } from '../core/stateMachine';
import {
  evaluateBusinessOutcome,
  validateAgentResponse,
  validateToolExecution,
} from '../core/validation';
import { verifiers } from './mockSystems';
import { sseHub } from './sse';
import { store } from './store';

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function recordAuditAndEmit(params: {
  journeyId: string;
  correlationId: string;
  actorType: 'AGENT' | 'VERIFIER' | 'WORKFLOW' | 'HUMAN' | 'SYSTEM';
  actorId: string;
  eventType: AuditEventType;
  previousState: string;
  newState: string;
  evidenceReference?: string | null;
  metadata?: Record<string, unknown>;
  source?: string;
}): void {
  const state = store.getState();
  state.counters.auditSeq += 1;
  const seq = state.counters.auditSeq;
  const lastEvent = state.auditEvents[state.auditEvents.length - 1];
  const prevHash = lastEvent ? lastEvent.eventHash : GENESIS_HASH;
  const createdAt = new Date().toISOString();

  const auditEvent = createAuditEvent({
    id: `evt_${String(seq).padStart(4, '0')}`,
    sequence: seq,
    journeyId: params.journeyId,
    correlationId: params.correlationId,
    actorType: params.actorType,
    actorId: params.actorId,
    eventType: params.eventType,
    previousState: params.previousState,
    newState: params.newState,
    evidenceReference: params.evidenceReference ?? null,
    metadata: params.metadata ?? {},
    previousHash: prevHash,
    createdAt,
  });

  state.auditEvents.push(auditEvent);
  store.persist();

  sseHub.broadcast({
    eventId: auditEvent.id,
    journeyId: params.journeyId,
    eventType: params.eventType,
    source: params.source ?? 'agentbridge.orchestrator',
    timestamp: createdAt,
    correlationId: params.correlationId,
    payload: {
      previousState: params.previousState,
      newState: params.newState,
      evidenceReference: params.evidenceReference ?? null,
      ...params.metadata,
    },
  });
}

function addEvidenceAndCheck(params: {
  journeyId: string;
  stageId: string;
  stageName: StageName;
  validationType: ValidationCheck['validationType'];
  checkName: string;
  expectedValue: string;
  actualValue: string;
  result: ValidationCheck['result'];
  reason: string;
  evidence?: {
    sourceSystem: string;
    evidenceType: string;
    referenceId: string;
    payloadHash: string;
    redactedPayload: Record<string, unknown>;
  };
}): ValidationCheck {
  const state = store.getState();
  const checkId = uid('chk');
  const now = new Date().toISOString();
  let evidenceId: string | null = null;

  if (params.evidence) {
    evidenceId = uid('evd');
    const ev: EvidenceRecord = {
      id: evidenceId,
      journeyId: params.journeyId,
      validationId: checkId,
      sourceSystem: params.evidence.sourceSystem,
      evidenceType: params.evidence.evidenceType,
      referenceId: params.evidence.referenceId,
      payloadHash: params.evidence.payloadHash,
      redactedPayload: params.evidence.redactedPayload,
      capturedAt: now,
    };
    state.evidenceRecords.unshift(ev);
  }

  const check: ValidationCheck = {
    id: checkId,
    journeyId: params.journeyId,
    stageId: params.stageId,
    stageName: params.stageName,
    validationType: params.validationType,
    checkName: params.checkName,
    expectedValue: params.expectedValue,
    actualValue: params.actualValue,
    result: params.result,
    reason: params.reason,
    evidenceId,
    checkedAt: now,
  };

  state.validationChecks.unshift(check);
  store.persist();
  return check;
}

function updateJourneyDerivedState(journey: Journey): void {
  const state = store.getState();
  const stages = state.stages.filter((s) => s.journeyId === journey.id).sort((a, b) => a.order - b.order);
  const derived = deriveJourneyStatus(stages);
  const now = new Date().toISOString();

  journey.status = derived;
  journey.updatedAt = now;

  if (derived === 'VERIFIED') {
    journey.verificationStatus = 'VERIFIED';
    journey.completedAt = journey.completedAt ?? now;
    journey.durationMs = new Date(journey.completedAt).getTime() - new Date(journey.startedAt).getTime();
    journey.blockedReason = null;
  } else if (derived === 'BLOCKED') {
    journey.verificationStatus = 'MISMATCH';
    const blockedStage = stages.find((s) => s.status === 'BLOCKED' || s.status === 'MISMATCH');
    journey.blockedReason = blockedStage?.blockedReason ?? 'Blocked by Business Outcome Validation.';
  } else if (derived === 'VERIFICATION_PENDING') {
    journey.verificationStatus = 'UNAVAILABLE';
    const pendingStage = stages.find((s) => s.status === 'VERIFICATION_PENDING' || s.status === 'SOURCE_UNAVAILABLE');
    journey.blockedReason = pendingStage?.blockedReason ?? 'Source system temporarily unavailable.';
  } else if (derived === 'NEEDS_HUMAN') {
    journey.verificationStatus = 'NEEDS_HUMAN';
    const humanStage = stages.find((s) => s.status === 'NEEDS_HUMAN');
    journey.blockedReason = humanStage?.blockedReason ?? 'Awaiting human approval.';
  } else if (derived === 'FAILED') {
    journey.verificationStatus = 'FAILED';
  } else if (derived === 'CANCELLED') {
    journey.verificationStatus = 'FAILED';
  } else {
    journey.verificationStatus = 'PENDING';
    journey.blockedReason = null;
  }

  const activeStage =
    stages.find((s) =>
      ['RUNNING', 'BLOCKED', 'MISMATCH', 'NEEDS_HUMAN', 'VERIFICATION_PENDING', 'SOURCE_UNAVAILABLE'].includes(s.status)
    ) ?? stages[stages.length - 1];
  if (activeStage) {
    journey.currentStage = activeStage.stageName;
  }

  journey.clusterKey = derived === 'VERIFIED' ? 'VERIFIED' : deriveClusterKey(journey);
  store.persist();
}

function upsertJourneyHandoff(
  journey: Journey,
  stage: JourneyStage,
  params: {
    payloadSummary: string;
    passedFields: string[];
    flaggedFields: string[];
    a2aHopMs: number;
    officialVerifyMs: number;
    outcome: A2AHandoff['outcome'];
  }
): void {
  const fromAgentMap: Record<StageName, string> = {
    SALES_ONBOARDING: 'Merchant Intake',
    KYC_VERIFICATION: 'Sales Agent',
    RISK_ASSESSMENT: 'KYC Agent',
    OPERATIONS_ACTIVATION: 'Risk Agent',
  };
  if (!journey.handoffs) {
    journey.handoffs = [];
  }
  const existingIdx = journey.handoffs.findIndex((h) => h.stageName === stage.stageName);
  const hop: A2AHandoff = {
    id: existingIdx >= 0 ? journey.handoffs[existingIdx].id : uid('hop'),
    journeyId: journey.id,
    sequence: stage.order,
    fromAgent: fromAgentMap[stage.stageName],
    toAgent: stage.agentName,
    stageName: stage.stageName,
    payloadSummary: params.payloadSummary,
    passedFields: params.passedFields,
    flaggedFields: params.flaggedFields,
    a2aHopMs: params.a2aHopMs,
    officialVerifyMs: params.officialVerifyMs,
    outcome: params.outcome,
    timestamp: new Date().toISOString(),
  };
  if (existingIdx >= 0) {
    journey.handoffs[existingIdx] = hop;
  } else {
    journey.handoffs.push(hop);
    journey.handoffs.sort((a, b) => a.sequence - b.sequence);
  }
}

async function executeStage(journey: Journey, stage: JourneyStage): Promise<'PROCEED' | 'HALT'> {
  const state = store.getState();
  const agent = state.agents.find((a) => a.id === stage.agentId);
  if (!agent) throw new Error(`Agent ${stage.agentId} not found`);

  const now = new Date().toISOString();
  stage.status = 'RUNNING';
  stage.startedAt = stage.startedAt ?? now;
  stage.blockedReason = null;
  agent.lastActiveAt = now;
  updateJourneyDerivedState(journey);

  recordAuditAndEmit({
    journeyId: journey.id,
    correlationId: journey.correlationId,
    actorType: 'AGENT',
    actorId: agent.id,
    eventType: 'AGENT_STARTED',
    previousState: 'NOT_STARTED',
    newState: 'RUNNING',
    metadata: { stageName: stage.stageName, agentName: agent.name },
  });

  const requestId = uid(`req_${stage.order}`);
  const idempotencyKey = `idem_${journey.id}_${stage.stageName.toLowerCase()}`;

  const toolConfig: Record<
    StageName,
    { toolName: string; perm: string; opType: string; reportedStatus: string; verifierKey: keyof typeof verifiers }
  > = {
    SALES_ONBOARDING: {
      toolName: 'create_merchant_profile',
      perm: 'merchant:create',
      opType: 'CREATE_MERCHANT_PROFILE',
      reportedStatus: 'COMPLETED',
      verifierKey: 'merchant',
    },
    KYC_VERIFICATION: {
      toolName: 'submit_kyc_application',
      perm: 'kyc:submit',
      opType: 'KYC_SUBMIT',
      reportedStatus: 'KYC_APPROVED',
      verifierKey: 'kyc',
    },
    RISK_ASSESSMENT: {
      toolName: 'evaluate_merchant_risk',
      perm: 'risk:evaluate',
      opType: 'RISK_EVALUATE',
      reportedStatus: journey.scenario === 'HUMAN_APPROVAL' ? 'FLAGGED' : 'RISK_CLEARED',
      verifierKey: 'risk',
    },
    OPERATIONS_ACTIVATION: {
      toolName: 'activate_merchant_account',
      perm: 'merchant:activate',
      opType: 'MERCHANT_ACTIVATE',
      reportedStatus: 'ACTIVATED',
      verifierKey: 'activation',
    },
  };

  const cfg = toolConfig[stage.stageName];

  // Protocol & Control Plane Pre-Flight Checks (Pi RPC / A2A / MCP / ACP)
  const piRpc = state.integrations.find((i) => i.id === 'int_pi_rpc');
  const a2aBus = state.integrations.find((i) => i.id === 'int_a2a_bus');
  const mcpServer = state.integrations.find((i) => i.id === 'int_mcp_server');
  const acpGate = state.integrations.find((i) => i.id === 'int_acp_gate');

  const offlineGate =
    acpGate?.status === 'OUTAGE'
      ? {
          integration: acpGate,
          failClosed: true,
          reason: 'ACP Guardrail Policy Gate is offline — fail-closed safety rule prevents unguarded tool execution.',
        }
      : piRpc?.status === 'OUTAGE'
        ? {
            integration: piRpc,
            failClosed: false,
            reason: 'Pi Agent Native RPC (JSONL stdio) worker is offline; holding stage cleanly until worker reconnects.',
          }
        : a2aBus?.status === 'OUTAGE' && stage.order > 1
          ? {
              integration: a2aBus,
              failClosed: false,
              reason: 'Pi-A2A Peer Handoff Bus (JSON-RPC 2.0) is offline; holding handoff before downstream call.',
            }
          : mcpServer?.status === 'OUTAGE'
            ? {
                integration: mcpServer,
                failClosed: false,
                reason: `Pi-MCP Tool Adapter (${cfg.toolName}) is unreachable; holding tool execution without failing falsely.`,
              }
            : null;

  if (offlineGate) {
    stage.status = offlineGate.failClosed ? 'BLOCKED' : 'VERIFICATION_PENDING';
    stage.validationStatus = offlineGate.failClosed ? 'FAIL' : 'UNAVAILABLE';
    stage.blockedReason = offlineGate.reason;

    addEvidenceAndCheck({
      journeyId: journey.id,
      stageId: stage.id,
      stageName: stage.stageName,
      validationType: 'EXECUTION',
      checkName: `${offlineGate.integration.name} Connectivity`,
      expectedValue: 'ONLINE',
      actualValue: 'OUTAGE',
      result: offlineGate.failClosed ? 'FAIL' : 'UNAVAILABLE',
      reason: offlineGate.reason,
    });

    upsertJourneyHandoff(journey, stage, {
      payloadSummary: offlineGate.reason,
      passedFields: ['merchantReference'],
      flaggedFields: [`protocolOffline=${offlineGate.integration.protocol ?? offlineGate.integration.id}`],
      a2aHopMs: offlineGate.integration.latencyMs,
      officialVerifyMs: 0,
      outcome: 'TIMEOUT',
    });

    updateJourneyDerivedState(journey);

    recordAuditAndEmit({
      journeyId: journey.id,
      correlationId: journey.correlationId,
      actorType: 'SYSTEM',
      actorId: offlineGate.integration.id,
      eventType: offlineGate.failClosed ? 'WORKFLOW_BLOCKED' : 'OUTCOME_VERIFICATION_FAILED',
      previousState: 'RUNNING',
      newState: stage.status,
      metadata: {
        protocol: offlineGate.integration.protocolLabel ?? offlineGate.integration.name,
        reason: offlineGate.reason,
      },
    });

    return 'HALT';
  }

  // Level 2: Execution Validation (tool, permissions, request identity, idempotency)
  const existingIdem = state.idempotencyKeys.find((k) => k.key === idempotencyKey) ?? null;
  const execCheck = validateToolExecution({
    agent,
    toolName: cfg.toolName,
    requiredPermission: cfg.perm,
    requestId,
    idempotencyKey,
    operationType: cfg.opType,
    existingIdempotency: state.policies.enforceIdempotency ? existingIdem : null,
  });

  addEvidenceAndCheck({
    journeyId: journey.id,
    stageId: stage.id,
    stageName: stage.stageName,
    validationType: 'EXECUTION',
    checkName: 'Tool Identity, Permissions & Idempotency',
    expectedValue: execCheck.expectedValue,
    actualValue: execCheck.actualValue,
    result: execCheck.result,
    reason: execCheck.reason,
  });

  if (execCheck.result === 'FAIL') {
    stage.status = 'BLOCKED';
    stage.validationStatus = 'FAIL';
    stage.blockedReason = execCheck.reason;
    updateJourneyDerivedState(journey);

    recordAuditAndEmit({
      journeyId: journey.id,
      correlationId: journey.correlationId,
      actorType: 'VERIFIER',
      actorId: 'execution-validator',
      eventType: execCheck.isDuplicate ? 'DUPLICATE_BLOCKED' : 'AGENT_FAILED',
      previousState: 'RUNNING',
      newState: 'BLOCKED',
      metadata: { reason: execCheck.reason, idempotencyKey },
    });
    return 'HALT';
  }

  recordAuditAndEmit({
    journeyId: journey.id,
    correlationId: journey.correlationId,
    actorType: 'VERIFIER',
    actorId: 'execution-validator',
    eventType: 'EXECUTION_VALIDATED',
    previousState: 'RUNNING',
    newState: 'EXECUTION_AUTHORIZED',
    metadata: { toolName: cfg.toolName, requestId, idempotencyKey },
  });

  // Perform simulated agent activity & authoritative side-effects based on scenario
  const startMs = Date.now();
  let execStatus: AgentRun['executionStatus'] = 'SUCCESS';
  let outputSummary = `${agent.name} completed ${cfg.toolName} for ${journey.externalReference}.`;

  if (stage.stageName === 'SALES_ONBOARDING') {
    state.authoritative.merchants[journey.externalReference] = {
      merchantReference: journey.externalReference,
      merchantName: journey.merchantName,
      status: 'PROFILE_CREATED',
      updatedAt: new Date().toISOString(),
    };
    if (journey.scenario === 'API_TIMEOUT') {
      execStatus = 'TIMEOUT';
      outputSummary = 'Upstream HTTP gateway timed out after 5000ms while awaiting response, though request was dispatched.';
    }
  } else if (stage.stageName === 'KYC_VERIFICATION') {
    if (journey.scenario === 'FALSE_COMPLETION') {
      // Authoritative KYC stays PENDING while agent erroneously reports KYC_APPROVED!
      state.authoritative.kyc[journey.externalReference] = {
        merchantReference: journey.externalReference,
        status: 'KYC_PENDING',
        checkCount: 0,
        autoApproveAfterChecks: null,
        updatedAt: new Date().toISOString(),
      };
      outputSummary = 'KYC Agent reported KYC_APPROVED immediately upon document upload acknowledgement.';
    } else if (journey.scenario === 'DELAYED_CONSISTENCY') {
      state.authoritative.kyc[journey.externalReference] = {
        merchantReference: journey.externalReference,
        status: 'KYC_PENDING',
        checkCount: 0,
        autoApproveAfterChecks: 3,
        updatedAt: new Date().toISOString(),
      };
      outputSummary = 'KYC Agent reported KYC_APPROVED; authoritative ledger has eventual consistency lag.';
    } else {
      state.authoritative.kyc[journey.externalReference] = {
        merchantReference: journey.externalReference,
        status: 'KYC_APPROVED',
        checkCount: 0,
        autoApproveAfterChecks: null,
        updatedAt: new Date().toISOString(),
      };
    }
  } else if (stage.stageName === 'RISK_ASSESSMENT') {
    const isHumanScenario = journey.scenario === 'HUMAN_APPROVAL';
    state.authoritative.risk[journey.externalReference] = {
      merchantReference: journey.externalReference,
      status: isHumanScenario ? 'RISK_REVIEW_REQUIRED' : 'RISK_CLEARED',
      score: isHumanScenario ? 81 : 19,
      updatedAt: new Date().toISOString(),
    };
    if (isHumanScenario) {
      outputSummary = 'Risk Agent flagged MCC threshold (score 81/100) and requested compliance sign-off.';
    }
  } else if (stage.stageName === 'OPERATIONS_ACTIVATION') {
    const actCode = `ACT-${journey.externalReference.replace('MRC-', '')}`;
    state.authoritative.activations[journey.externalReference] = {
      merchantReference: journey.externalReference,
      status: 'ACTIVATED',
      idempotencyKey,
      activationCode: actCode,
      updatedAt: new Date().toISOString(),
    };
  }

  // Record idempotency key commit for side-effect
  state.idempotencyKeys.unshift({
    key: idempotencyKey,
    operationType: cfg.opType,
    journeyId: journey.id,
    status: 'COMMITTED',
    responseReference: `${cfg.opType.toLowerCase()}_${journey.externalReference}`,
    attemptCount: 1,
    createdAt: new Date().toISOString(),
    lastAttemptAt: new Date().toISOString(),
  });

  const latencyMs = Math.max(45, Date.now() - startMs + 90 + stage.order * 24);
  const completedAt = new Date().toISOString();

  const agentRun: AgentRun = {
    id: uid('run'),
    journeyId: journey.id,
    stageId: stage.id,
    agentId: agent.id,
    requestId,
    idempotencyKey,
    toolName: cfg.toolName,
    inputSummary: `merchantReference="${journey.externalReference}", merchantName="${journey.merchantName}"`,
    outputSummary,
    reportedStatus: execStatus === 'TIMEOUT' ? 'PENDING' : cfg.reportedStatus,
    executionStatus: execStatus,
    latencyMs,
    startedAt: stage.startedAt,
    completedAt,
  };
  state.agentRuns.unshift(agentRun);

  stage.reportedState = agentRun.reportedStatus;
  stage.latencyMs = latencyMs;
  stage.status = 'REPORTED_SUCCESS';
  store.persist();

  recordAuditAndEmit({
    journeyId: journey.id,
    correlationId: journey.correlationId,
    actorType: 'AGENT',
    actorId: agent.id,
    eventType: execStatus === 'TIMEOUT' ? 'AGENT_FAILED' : 'AGENT_COMPLETED',
    previousState: 'RUNNING',
    newState: `REPORTED (${agentRun.reportedStatus})`,
    metadata: { latencyMs, executionStatus: execStatus },
  });

  // Level 1: AI Response Validation
  const responsePayload = {
    agentId: agent.id,
    requestId,
    merchantReference: journey.externalReference,
    reportedStatus: agentRun.reportedStatus,
    referenceId: `${stage.stageName.toLowerCase()}_${journey.externalReference}`,
    summary: outputSummary,
    confidence: execStatus === 'TIMEOUT' ? 0.42 : 0.96,
    timestamp: completedAt,
  };

  const respCheck = validateAgentResponse(responsePayload, agent.id);
  addEvidenceAndCheck({
    journeyId: journey.id,
    stageId: stage.id,
    stageName: stage.stageName,
    validationType: 'AI_RESPONSE',
    checkName: 'AgentResponseSchema & Consistency',
    expectedValue: respCheck.expectedValue,
    actualValue: respCheck.actualValue,
    result: respCheck.result,
    reason: respCheck.reason,
  });

  recordAuditAndEmit({
    journeyId: journey.id,
    correlationId: journey.correlationId,
    actorType: 'VERIFIER',
    actorId: 'response-validator',
    eventType: 'RESPONSE_VALIDATED',
    previousState: 'REPORTED_SUCCESS',
    newState: respCheck.result,
    metadata: { reportedStatus: agentRun.reportedStatus },
  });

  // Handle Human Escalation scenario cleanly
  if (stage.stageName === 'RISK_ASSESSMENT' && journey.scenario === 'HUMAN_APPROVAL') {
    stage.status = 'NEEDS_HUMAN';
    stage.actualState = 'RISK_REVIEW_REQUIRED';
    stage.validationStatus = 'MISMATCH';
    stage.blockedReason = 'High-risk MCC requires Compliance Officer sign-off before Operations activation.';

    const approval: ApprovalRequest = {
      id: uid('apr'),
      journeyId: journey.id,
      merchantName: journey.merchantName,
      stageId: stage.id,
      stageName: stage.stageName,
      reason: 'Risk score 81/100 exceeds automated activation threshold (65). Human review required.',
      riskLevel: 'HIGH',
      requestedAction: 'Approve Risk Clearance & Resume Operations Activation',
      status: 'PENDING',
      requestedBy: agent.id,
      assignedReviewer: journey.assignedTo ?? 'Compliance Ops Lead',
      reviewedBy: null,
      decisionReason: null,
      createdAt: new Date().toISOString(),
      deadlineAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      resolvedAt: null,
    };
    state.approvalRequests.unshift(approval);
    upsertJourneyHandoff(journey, stage, {
      payloadSummary: 'Risk Agent scored MCC threshold 81/100 (>65 cap) and paused for human compliance review.',
      passedFields: ['merchantReference', 'kycLedgerId', 'riskScore=81'],
      flaggedFields: ['highRiskThresholdExceeded (81 > 65)'],
      a2aHopMs: Math.round(latencyMs * 0.55),
      officialVerifyMs: Math.round(latencyMs * 0.45),
      outcome: 'ESCALATED',
    });
    updateJourneyDerivedState(journey);

    recordAuditAndEmit({
      journeyId: journey.id,
      correlationId: journey.correlationId,
      actorType: 'AGENT',
      actorId: agent.id,
      eventType: 'APPROVAL_REQUESTED',
      previousState: 'RISK_ASSESSMENT',
      newState: 'NEEDS_HUMAN',
      metadata: { approvalId: approval.id, riskLevel: 'HIGH' },
    });
    return 'HALT';
  }

  // If SOURCE_UNAVAILABLE scenario, trigger temporary outage on KYC API before verification
  if (stage.stageName === 'KYC_VERIFICATION' && journey.scenario === 'SOURCE_UNAVAILABLE') {
    const kycIntegration = state.integrations.find((i) => i.id === 'int_kyc_api');
    if (kycIntegration) {
      kycIntegration.status = 'OUTAGE';
      store.persist();
    }
  }

  // Level 3: Business Outcome Verification (Authoritative Source of Truth)
  return await verifyStageOutcome(journey, stage, cfg.verifierKey);
}

async function verifyStageOutcome(
  journey: Journey,
  stage: JourneyStage,
  verifierKey: keyof typeof verifiers
): Promise<'PROCEED' | 'HALT'> {
  const state = store.getState();
  stage.status = 'VERIFYING';
  updateJourneyDerivedState(journey);

  recordAuditAndEmit({
    journeyId: journey.id,
    correlationId: journey.correlationId,
    actorType: 'VERIFIER',
    actorId: 'outcome-engine',
    eventType: 'OUTCOME_VERIFICATION_STARTED',
    previousState: stage.reportedState ?? 'RUNNING',
    newState: 'VERIFYING',
    metadata: { expectedState: stage.expectedState, stageName: stage.stageName },
  });

  const verification = await verifiers[verifierKey].verify({
    journeyId: journey.id,
    merchantReference: journey.externalReference,
    expectedState: stage.expectedState,
    operationId: `${journey.id}_${stage.stageName}`,
  });

  const comparison = evaluateBusinessOutcome(stage.expectedState, verification);

  const check = addEvidenceAndCheck({
    journeyId: journey.id,
    stageId: stage.id,
    stageName: stage.stageName,
    validationType: 'BUSINESS_OUTCOME',
    checkName: `Authoritative ${verification.sourceSystem} Gate`,
    expectedValue: comparison.expectedValue,
    actualValue: comparison.actualValue,
    result: comparison.result,
    reason: comparison.reason,
    evidence: {
      sourceSystem: verification.sourceSystem,
      evidenceType: 'AUTHORITATIVE_STATE_SNAPSHOT',
      referenceId: verification.evidenceReference,
      payloadHash: verification.payloadHash,
      redactedPayload: verification.redactedPayload,
    },
  });

  stage.actualState = verification.actualState;
  stage.validationStatus = comparison.result;

  if (comparison.result === 'UNAVAILABLE') {
    stage.status = 'VERIFICATION_PENDING';
    stage.blockedReason = comparison.reason;
    upsertJourneyHandoff(journey, stage, {
      payloadSummary: `${stage.agentName} handoff reached ${verification.sourceSystem}, which returned unavailable (503).`,
      passedFields: ['merchantReference', stage.stageName],
      flaggedFields: [`sourceUnavailable (${verification.sourceSystem})`],
      a2aHopMs: stage.latencyMs ?? 82,
      officialVerifyMs: 145,
      outcome: 'TIMEOUT',
    });
    updateJourneyDerivedState(journey);

    recordAuditAndEmit({
      journeyId: journey.id,
      correlationId: journey.correlationId,
      actorType: 'VERIFIER',
      actorId: 'outcome-engine',
      eventType: 'RETRY_SCHEDULED',
      previousState: 'VERIFYING',
      newState: 'VERIFICATION_PENDING',
      evidenceReference: check.evidenceId,
      metadata: {
        reason: comparison.reason,
        backoffMs: calculateBackoffDelayMs(stage.retryCount, state.policies.baseBackoffMs),
      },
    });
    return 'HALT';
  }

  if (comparison.result === 'MISMATCH' || !comparison.canProceed) {
    stage.status = 'BLOCKED';
    stage.blockedReason = `Claim (${stage.reportedState}) != Source (${verification.actualState}). ${comparison.reason}`;
    upsertJourneyHandoff(journey, stage, {
      payloadSummary: `${stage.agentName} reported ${stage.reportedState}, but ${verification.sourceSystem} returned ${verification.actualState}.`,
      passedFields: ['merchantReference', 'idempotencyKey'],
      flaggedFields: [`stateMismatch (AI=${stage.reportedState} vs Official=${verification.actualState})`],
      a2aHopMs: stage.latencyMs ?? 76,
      officialVerifyMs: 68,
      outcome: 'MISMATCH',
    });
    updateJourneyDerivedState(journey);

    recordAuditAndEmit({
      journeyId: journey.id,
      correlationId: journey.correlationId,
      actorType: 'VERIFIER',
      actorId: 'outcome-engine',
      eventType: 'OUTCOME_VERIFICATION_FAILED',
      previousState: `${stage.reportedState} (CLAIM)`,
      newState: `MISMATCH (SOURCE: ${verification.actualState})`,
      evidenceReference: check.evidenceId,
      metadata: { expected: stage.expectedState, actual: verification.actualState },
    });

    recordAuditAndEmit({
      journeyId: journey.id,
      correlationId: journey.correlationId,
      actorType: 'WORKFLOW',
      actorId: 'orchestrator',
      eventType: 'WORKFLOW_BLOCKED',
      previousState: stage.stageName,
      newState: 'BLOCKED_DOWNSTREAM_STAGES',
      evidenceReference: check.evidenceId,
      metadata: { reason: stage.blockedReason },
    });

    // If DELAYED_CONSISTENCY scenario, schedule bounded backoff recheck automatically!
    if (journey.scenario === 'DELAYED_CONSISTENCY' && stage.retryCount < stage.maxRetries) {
      const delayMs = calculateBackoffDelayMs(stage.retryCount, state.policies.baseBackoffMs, 3000);
      setTimeout(() => {
        void recheckAndResumeJourney(journey.id);
      }, delayMs);
    }

    return 'HALT';
  }

  // Passed!
  stage.status = 'VERIFIED';
  stage.completedAt = new Date().toISOString();
  stage.blockedReason = null;
  upsertJourneyHandoff(journey, stage, {
    payloadSummary: `${stage.agentName} output verified against ${verification.sourceSystem} (${verification.actualState}).`,
    passedFields: ['merchantReference', verification.evidenceReference, `state=${verification.actualState}`],
    flaggedFields: [],
    a2aHopMs: Math.max(32, Math.round((stage.latencyMs ?? 120) * 0.55)),
    officialVerifyMs: Math.max(28, Math.round((stage.latencyMs ?? 120) * 0.45)),
    outcome: 'VERIFIED',
  });
  updateJourneyDerivedState(journey);

  recordAuditAndEmit({
    journeyId: journey.id,
    correlationId: journey.correlationId,
    actorType: 'VERIFIER',
    actorId: 'outcome-engine',
    eventType: 'OUTCOME_VERIFICATION_PASSED',
    previousState: 'VERIFYING',
    newState: `VERIFIED (${verification.actualState})`,
    evidenceReference: check.evidenceId,
    metadata: { sourceSystem: verification.sourceSystem },
  });

  return 'PROCEED';
}

function verifierKeyForStage(stageName: StageName): keyof typeof verifiers {
  switch (stageName) {
    case 'SALES_ONBOARDING':
      return 'merchant';
    case 'KYC_VERIFICATION':
      return 'kyc';
    case 'RISK_ASSESSMENT':
      return 'risk';
    case 'OPERATIONS_ACTIVATION':
      return 'activation';
  }
}

export async function startNewJourney(input: {
  merchantName: string;
  scenario: JourneyScenario;
}): Promise<Journey> {
  const state = store.getState();
  state.counters.journeySeq += 1;
  const seq = state.counters.journeySeq;
  const journeyId = `jrn_${seq}`;
  const externalReference = `MRC-${88400 + seq}`;
  const correlationId = `corr_${88400 + seq}_${input.scenario.toLowerCase().slice(0, 4)}`;
  const now = new Date().toISOString();

  const journey: Journey = {
    id: journeyId,
    externalReference,
    merchantName: input.merchantName.trim(),
    journeyType: 'MERCHANT_ONBOARDING',
    scenario: input.scenario,
    status: 'RUNNING',
    verificationStatus: 'PENDING',
    currentStage: 'SALES_ONBOARDING',
    environment: 'SIMULATED',
    correlationId,
    workflowId: `wf-onboard-${externalReference.toLowerCase()}`,
    startedAt: now,
    completedAt: null,
    updatedAt: now,
    durationMs: null,
    blockedReason: null,
  };

  const stageDefs: Array<{ order: number; stageName: StageName; label: string; agentId: string; agentName: string; expectedState: string }> = [
    { order: 1, stageName: 'SALES_ONBOARDING', label: 'Sales Onboarding', agentId: 'agent_sales', agentName: 'Sales Agent', expectedState: 'PROFILE_CREATED' },
    { order: 2, stageName: 'KYC_VERIFICATION', label: 'KYC Verification', agentId: 'agent_kyc', agentName: 'KYC Agent', expectedState: 'KYC_APPROVED' },
    { order: 3, stageName: 'RISK_ASSESSMENT', label: 'Risk Assessment', agentId: 'agent_risk', agentName: 'Risk Agent', expectedState: 'RISK_CLEARED' },
    { order: 4, stageName: 'OPERATIONS_ACTIVATION', label: 'Operations Activation', agentId: 'agent_ops', agentName: 'Operations Agent', expectedState: 'ACTIVATED' },
  ];

  const newStages: JourneyStage[] = stageDefs.map((d) => ({
    id: `stg_${seq}_${d.order}`,
    journeyId,
    order: d.order,
    stageName: d.stageName,
    label: d.label,
    agentId: d.agentId,
    agentName: d.agentName,
    status: 'NOT_STARTED',
    validationStatus: 'PENDING',
    expectedState: d.expectedState,
    actualState: null,
    reportedState: null,
    retryCount: 0,
    maxRetries: state.policies.maxBackoffRetries,
    latencyMs: null,
    startedAt: null,
    completedAt: null,
    blockedReason: null,
  }));

  state.journeys.unshift(journey);
  state.stages.push(...newStages);
  store.persist();

  recordAuditAndEmit({
    journeyId,
    correlationId,
    actorType: 'WORKFLOW',
    actorId: 'orchestrator',
    eventType: 'JOURNEY_CREATED',
    previousState: 'NONE',
    newState: 'RUNNING',
    metadata: { merchantName: journey.merchantName, scenario: journey.scenario },
  });

  await advanceWorkflow(journey);

  // For DUPLICATE_ATTEMPT scenario, automatically test a duplicate activation attempt after completion
  if (input.scenario === 'DUPLICATE_ATTEMPT') {
    await simulateDuplicateActivation(journey.id);
  }

  return journey;
}

async function advanceWorkflow(journey: Journey): Promise<void> {
  const state = store.getState();
  const stages = state.stages.filter((s) => s.journeyId === journey.id).sort((a, b) => a.order - b.order);

  for (const stage of stages) {
    if (stage.status === 'VERIFIED' || stage.status === 'COMPLETED') {
      continue;
    }
    const outcome = await executeStage(journey, stage);
    if (outcome === 'HALT') {
      return;
    }
  }

  updateJourneyDerivedState(journey);
  if (journey.status === 'VERIFIED') {
    recordAuditAndEmit({
      journeyId: journey.id,
      correlationId: journey.correlationId,
      actorType: 'VERIFIER',
      actorId: 'outcome-engine',
      eventType: 'JOURNEY_VERIFIED',
      previousState: 'RUNNING',
      newState: 'VERIFIED',
      metadata: { durationMs: journey.durationMs },
    });
  }
}

export async function approveSourceKycAndResume(journeyId: string): Promise<Journey> {
  const state = store.getState();
  const journey = state.journeys.find((j) => j.id === journeyId);
  if (!journey) throw new Error('Journey not found');

  const kycRecord = state.authoritative.kyc[journey.externalReference];
  const now = new Date().toISOString();
  if (kycRecord) {
    kycRecord.status = 'KYC_APPROVED';
    kycRecord.updatedAt = now;
  } else {
    state.authoritative.kyc[journey.externalReference] = {
      merchantReference: journey.externalReference,
      status: 'KYC_APPROVED',
      checkCount: 1,
      autoApproveAfterChecks: null,
      updatedAt: now,
    };
  }

  // Also ensure KYC integration is healthy if it was in outage
  const kycInt = state.integrations.find((i) => i.id === 'int_kyc_api');
  if (kycInt && kycInt.status === 'OUTAGE') {
    kycInt.status = 'HEALTHY';
  }

  store.persist();

  recordAuditAndEmit({
    journeyId: journey.id,
    correlationId: journey.correlationId,
    actorType: 'SYSTEM',
    actorId: 'authoritative-kyc-api',
    eventType: 'SOURCE_SYSTEM_UPDATED',
    previousState: 'KYC_PENDING',
    newState: 'KYC_APPROVED',
    metadata: { merchantReference: journey.externalReference },
  });

  return await recheckAndResumeJourney(journeyId);
}

export async function recheckAndResumeJourney(journeyId: string): Promise<Journey> {
  const state = store.getState();
  const journey = state.journeys.find((j) => j.id === journeyId);
  if (!journey) throw new Error('Journey not found');

  const stages = state.stages.filter((s) => s.journeyId === journey.id).sort((a, b) => a.order - b.order);
  const blockedOrPendingStage = stages.find((s) =>
    ['BLOCKED', 'MISMATCH', 'VERIFICATION_PENDING', 'SOURCE_UNAVAILABLE'].includes(s.status)
  );

  if (blockedOrPendingStage) {
    blockedOrPendingStage.retryCount += 1;
    recordAuditAndEmit({
      journeyId: journey.id,
      correlationId: journey.correlationId,
      actorType: 'WORKFLOW',
      actorId: 'orchestrator',
      eventType: 'RETRY_EXECUTED',
      previousState: blockedOrPendingStage.status,
      newState: 'VERIFYING',
      metadata: { stageName: blockedOrPendingStage.stageName, attempt: blockedOrPendingStage.retryCount },
    });

    const outcome = await verifyStageOutcome(
      journey,
      blockedOrPendingStage,
      verifierKeyForStage(blockedOrPendingStage.stageName)
    );
    if (outcome === 'HALT') {
      return journey;
    }
  }

  await advanceWorkflow(journey);
  return journey;
}

export async function simulateDuplicateActivation(journeyId: string): Promise<{ blocked: boolean; message: string }> {
  const state = store.getState();
  const journey = state.journeys.find((j) => j.id === journeyId);
  if (!journey) throw new Error('Journey not found');

  const opsStage = state.stages.find((s) => s.journeyId === journey.id && s.stageName === 'OPERATIONS_ACTIVATION');
  const opsAgent = state.agents.find((a) => a.id === 'agent_ops');
  if (!opsStage || !opsAgent) throw new Error('Operations stage or agent missing');

  const idempotencyKey = `idem_${journey.id}_operations_activation`;
  const existingIdem = state.idempotencyKeys.find((k) => k.key === idempotencyKey) ?? null;
  const requestId = uid('req_dup');

  const execCheck = validateToolExecution({
    agent: opsAgent,
    toolName: 'activate_merchant_account',
    requiredPermission: 'merchant:activate',
    requestId,
    idempotencyKey,
    operationType: 'MERCHANT_ACTIVATE',
    existingIdempotency: existingIdem,
  });

  if (existingIdem) {
    existingIdem.attemptCount += 1;
    existingIdem.lastAttemptAt = new Date().toISOString();
  }

  addEvidenceAndCheck({
    journeyId: journey.id,
    stageId: opsStage.id,
    stageName: opsStage.stageName,
    validationType: 'EXECUTION',
    checkName: 'Idempotency Duplicate Operation Guard',
    expectedValue: execCheck.expectedValue,
    actualValue: execCheck.actualValue,
    result: execCheck.result,
    reason: execCheck.reason,
  });

  if (execCheck.isDuplicate) {
    recordAuditAndEmit({
      journeyId: journey.id,
      correlationId: journey.correlationId,
      actorType: 'VERIFIER',
      actorId: 'execution-validator',
      eventType: 'DUPLICATE_BLOCKED',
      previousState: 'DUPLICATE_ACTIVATE_REQUEST',
      newState: 'BLOCKED_BY_IDEMPOTENCY',
      metadata: { idempotencyKey, requestId },
    });
    return { blocked: true, message: execCheck.reason };
  }

  return { blocked: false, message: 'No prior committed activation found; safe to proceed.' };
}

export async function decideApprovalRequest(params: {
  approvalId: string;
  decision: 'APPROVED' | 'REJECTED' | 'EVIDENCE_REQUESTED' | 'ESCALATED';
  reviewer: string;
  reason: string;
}): Promise<ApprovalRequest> {
  const state = store.getState();
  const approval = state.approvalRequests.find((a) => a.id === params.approvalId);
  if (!approval) throw new Error('Approval request not found');
  if (!params.reason || params.reason.trim().length < 5) {
    throw new Error('A justification reason of at least 5 characters is required for compliance decisions.');
  }

  const journey = state.journeys.find((j) => j.id === approval.journeyId);
  const stage = state.stages.find((s) => s.id === approval.stageId);
  if (!journey || !stage) throw new Error('Associated journey or stage not found');

  const now = new Date().toISOString();
  approval.status = params.decision;
  approval.reviewedBy = params.reviewer;
  approval.decisionReason = params.reason.trim();

  if (params.decision === 'APPROVED') {
    approval.resolvedAt = now;
    state.authoritative.risk[journey.externalReference] = {
      merchantReference: journey.externalReference,
      status: 'RISK_CLEARED',
      score: 45,
      updatedAt: now,
    };
    stage.actualState = 'RISK_CLEARED';
    stage.validationStatus = 'PASS';
    stage.status = 'VERIFIED';
    stage.completedAt = now;
    stage.blockedReason = null;

    addEvidenceAndCheck({
      journeyId: journey.id,
      stageId: stage.id,
      stageName: stage.stageName,
      validationType: 'BUSINESS_OUTCOME',
      checkName: 'Human Compliance Sign-Off Gate',
      expectedValue: 'RISK_CLEARED',
      actualValue: 'RISK_CLEARED (HUMAN_APPROVED)',
      result: 'PASS',
      reason: `Approved by ${params.reviewer}: ${approval.decisionReason}`,
      evidence: {
        sourceSystem: 'Human Approval Centre',
        evidenceType: 'COMPLIANCE_SIGN_OFF',
        referenceId: approval.id,
        payloadHash: createHash('sha256').update(`${approval.id}:${params.reviewer}:${now}`).digest('hex').slice(0, 16),
        redactedPayload: { approvalId: approval.id, decision: 'APPROVED', reviewer: params.reviewer },
      },
    });

    recordAuditAndEmit({
      journeyId: journey.id,
      correlationId: journey.correlationId,
      actorType: 'HUMAN',
      actorId: params.reviewer,
      eventType: 'APPROVAL_GRANTED',
      previousState: 'NEEDS_HUMAN',
      newState: 'VERIFIED',
      metadata: { approvalId: approval.id, reason: approval.decisionReason },
    });

    await advanceWorkflow(journey);
  } else if (params.decision === 'REJECTED') {
    approval.resolvedAt = now;
    stage.status = 'FAILED';
    stage.validationStatus = 'FAIL';
    stage.blockedReason = `Rejected by ${params.reviewer}: ${approval.decisionReason}`;
    updateJourneyDerivedState(journey);

    recordAuditAndEmit({
      journeyId: journey.id,
      correlationId: journey.correlationId,
      actorType: 'HUMAN',
      actorId: params.reviewer,
      eventType: 'APPROVAL_REJECTED',
      previousState: 'NEEDS_HUMAN',
      newState: 'FAILED',
      metadata: { approvalId: approval.id, reason: approval.decisionReason },
    });
  } else {
    // EVIDENCE_REQUESTED or ESCALATED keeps stage paused
    store.persist();
    recordAuditAndEmit({
      journeyId: journey.id,
      correlationId: journey.correlationId,
      actorType: 'HUMAN',
      actorId: params.reviewer,
      eventType: 'APPROVAL_REQUESTED',
      previousState: approval.status,
      newState: params.decision,
      metadata: { approvalId: approval.id, reason: approval.decisionReason },
    });
  }

  return approval;
}

export function cancelJourney(journeyId: string): Journey {
  const state = store.getState();
  const journey = state.journeys.find((j) => j.id === journeyId);
  if (!journey) throw new Error('Journey not found');

  const stages = state.stages.filter((s) => s.journeyId === journey.id);
  for (const s of stages) {
    if (s.status !== 'VERIFIED' && s.status !== 'COMPLETED') {
      s.status = 'CANCELLED';
    }
  }
  updateJourneyDerivedState(journey);

  recordAuditAndEmit({
    journeyId: journey.id,
    correlationId: journey.correlationId,
    actorType: 'HUMAN',
    actorId: 'ops-operator',
    eventType: 'JOURNEY_CANCELLED',
    previousState: 'ACTIVE',
    newState: 'CANCELLED',
  });

  return journey;
}

export function assignJourneyOwner(journeyId: string, owner: string | null): Journey {
  const state = store.getState();
  const journey = state.journeys.find((j) => j.id === journeyId);
  if (!journey) throw new Error('Journey not found');

  journey.assignedTo = owner;
  journey.updatedAt = new Date().toISOString();

  for (const apr of state.approvalRequests) {
    if (apr.journeyId === journeyId && apr.status === 'PENDING') {
      apr.assignedReviewer = owner ?? 'Compliance Ops Lead';
    }
  }

  store.persist();
  return journey;
}

export function assignClusterOwner(clusterKey: string, owner: string | null): number {
  const state = store.getState();
  const actionable = new Set(['BLOCKED', 'NEEDS_HUMAN', 'VERIFICATION_PENDING', 'FAILED']);
  let updated = 0;
  const now = new Date().toISOString();

  for (const j of state.journeys) {
    if (actionable.has(j.status) && deriveClusterKey(j) === clusterKey) {
      j.assignedTo = owner;
      j.updatedAt = now;
      updated += 1;
    }
  }

  for (const apr of state.approvalRequests) {
    if (apr.status === 'PENDING') {
      const j = state.journeys.find((item) => item.id === apr.journeyId);
      if (j && deriveClusterKey(j) === clusterKey) {
        apr.assignedReviewer = owner ?? 'Compliance Ops Lead';
      }
    }
  }

  store.persist();
  return updated;
}

export async function bulkResolveCluster(params: {
  clusterKey?: string;
  approveKycFirst?: boolean;
}): Promise<{ updatedCount: number; verifiedCount: number }> {
  const state = store.getState();
  const actionable = new Set(['BLOCKED', 'VERIFICATION_PENDING', 'FAILED']);
  const targets = state.journeys.filter((j) => {
    if (!actionable.has(j.status)) return false;
    if (params.clusterKey && deriveClusterKey(j) !== params.clusterKey) return false;
    return true;
  });

  if (targets.length === 0) {
    return { updatedCount: 0, verifiedCount: 0 };
  }

  // Ensure KYC integration is healthy when doing recovery
  const kycInt = state.integrations.find((i) => i.id === 'int_kyc_api');
  if (kycInt && kycInt.status === 'OUTAGE') {
    kycInt.status = 'HEALTHY';
  }

  // For modest counts (< 25), run full live workflow progression; for large batches (hundreds/thousands), apply deterministic verified transition cleanly
  if (targets.length <= 25) {
    let verifiedCount = 0;
    for (const j of targets) {
      const updated = params.approveKycFirst
        ? await approveSourceKycAndResume(j.id)
        : await recheckAndResumeJourney(j.id);
      if (updated.status === 'VERIFIED') verifiedCount += 1;
    }
    return { updatedCount: targets.length, verifiedCount };
  }

  const now = new Date().toISOString();
  const stagesByJourney = new Map<string, JourneyStage[]>();
  for (const s of state.stages) {
    const arr = stagesByJourney.get(s.journeyId);
    if (arr) arr.push(s);
    else stagesByJourney.set(s.journeyId, [s]);
  }

  let verifiedCount = 0;
  for (const j of targets) {
    if (params.approveKycFirst) {
      state.authoritative.kyc[j.externalReference] = {
        merchantReference: j.externalReference,
        status: 'KYC_APPROVED',
        checkCount: 2,
        autoApproveAfterChecks: null,
        updatedAt: now,
      };
    }
    const jStages = stagesByJourney.get(j.id) ?? [];
    for (const stg of jStages) {
      stg.status = 'VERIFIED';
      stg.validationStatus = 'PASS';
      stg.actualState = stg.expectedState;
      stg.reportedState = stg.expectedState;
      stg.completedAt = now;
      stg.blockedReason = null;
    }
    if (j.handoffs) {
      for (const h of j.handoffs) {
        h.outcome = 'VERIFIED';
        h.flaggedFields = [];
      }
    }
    j.status = 'VERIFIED';
    j.verificationStatus = 'VERIFIED';
    j.currentStage = 'OPERATIONS_ACTIVATION';
    j.completedAt = now;
    j.updatedAt = now;
    j.blockedReason = null;
    j.clusterKey = 'VERIFIED';
    j.durationMs = Math.max(1200, j.durationMs ?? 2400);
    verifiedCount += 1;
  }

  // Append a single bulk audit event cleanly linked into the hash chain
  recordAuditAndEmit({
    journeyId: targets[0].id,
    correlationId: targets[0].correlationId,
    actorType: 'HUMAN',
    actorId: 'ops-manager-bulk',
    eventType: 'SOURCE_SYSTEM_UPDATED',
    previousState: `BULK_${targets.length}_PAUSED`,
    newState: `BULK_${verifiedCount}_VERIFIED`,
    metadata: { clusterKey: params.clusterKey ?? 'ALL', updatedCount: targets.length, verifiedCount },
  });

  store.persist();
  return { updatedCount: targets.length, verifiedCount };
}

const SYNTHETIC_PREFIXES = [
  'Narmada', 'Kaveri', 'Deccan', 'Malabar', 'Saffron', 'Indus', 'Vindhya', 'Godavari',
  'Sahyadri', 'Konkan', 'Bengal', 'Aurelia', 'Bharat', 'Shakti', 'Navratna', 'Pragati',
  'Zaveri', 'Chola', 'Maratha', 'Ganges', 'Himalaya', 'Lotus', 'Krishi', 'Swadeshi',
];

const SYNTHETIC_SUFFIXES = [
  'Retail Mart', 'Fresh Foods', 'Electronics Hub', 'Pharma Care', 'Logistics Co',
  'Apparel House', 'Digital Services', 'Agro Traders', 'Grocers LLP', 'Hardware Pvt Ltd',
  'Jewellers', 'Auto Spares', 'Cafe & Bakery', 'Home Essentials', 'Payments Outlet',
];

export function runA2ABatchSimulation(config: BatchSimulationConfig): {
  createdCount: number;
  summary: { verified: number; mismatches: number; timeouts: number; highRisk: number };
  elapsedMs: number;
} {
  const t0 = Date.now();
  const count = Math.max(10, Math.min(10000, Math.round(config.count)));
  const mismatchRate = Math.max(0, Math.min(80, config.mismatchRatePct)) / 100;
  const timeoutRate = Math.max(0, Math.min(80, config.timeoutRatePct)) / 100;
  const highRiskRate = Math.max(0, Math.min(80, config.highRiskRatePct)) / 100;
  const spreadMs = Math.max(1, config.spreadHours) * 3600 * 1000;

  const state = store.getState();
  const nowMs = Date.now();
  let lastEvent = state.auditEvents[state.auditEvents.length - 1];
  let prevHash = lastEvent ? lastEvent.eventHash : GENESIS_HASH;

  let verified = 0;
  let mismatches = 0;
  let timeouts = 0;
  let highRisk = 0;

  const newJourneys: Journey[] = [];
  const newStages: JourneyStage[] = [];
  const newRuns: AgentRun[] = [];
  const newChecks: ValidationCheck[] = [];
  const newApprovals: ApprovalRequest[] = [];
  const newAuditEvents: typeof state.auditEvents = [];

  for (let i = 0; i < count; i += 1) {
    state.counters.journeySeq += 1;
    const seq = state.counters.journeySeq;
    const journeyId = `jrn_${seq}`;
    const extRef = `MRC-${88400 + seq}`;
    const name = `${SYNTHETIC_PREFIXES[i % SYNTHETIC_PREFIXES.length]} ${SYNTHETIC_SUFFIXES[(i * 7) % SYNTHETIC_SUFFIXES.length]} #${seq}`;

    // Distribute timestamps smoothly across the configured window
    const offsetMs = Math.round(((count - i) / count) * spreadMs + (i % 17) * 4000);
    const startMs = nowMs - Math.min(spreadMs, offsetMs);
    const startedAt = new Date(startMs).toISOString();

    const roll = ((i * 9301 + 49297) % 233280) / 233280;
    let scenario: JourneyScenario = 'NORMAL';
    let status: Journey['status'] = 'VERIFIED';
    let verificationStatus: Journey['verificationStatus'] = 'VERIFIED';
    let currentStage: StageName = 'OPERATIONS_ACTIVATION';
    let blockedReason: string | null = null;
    let clusterKey = 'VERIFIED';

    if (roll < mismatchRate) {
      scenario = 'FALSE_COMPLETION';
      status = 'BLOCKED';
      verificationStatus = 'MISMATCH';
      currentStage = 'KYC_VERIFICATION';
      blockedReason = 'Agent claimed KYC_APPROVED while Authoritative KYC API reports KYC_PENDING.';
      clusterKey = 'KYC_PREMATURE_CLAIM';
      mismatches += 1;
    } else if (roll < mismatchRate + timeoutRate) {
      scenario = i % 2 === 0 ? 'SOURCE_UNAVAILABLE' : 'API_TIMEOUT';
      status = i % 2 === 0 ? 'VERIFICATION_PENDING' : 'FAILED';
      verificationStatus = i % 2 === 0 ? 'UNAVAILABLE' : 'FAILED';
      currentStage = i % 2 === 0 ? 'KYC_VERIFICATION' : 'SALES_ONBOARDING';
      blockedReason = i % 2 === 0
        ? 'Bank KYC API returned 503 unavailable during A2A verification.'
        : 'A2A gateway timed out after 5000ms during profile handoff.';
      clusterKey = i % 2 === 0 ? 'PARTNER_KYC_OUTAGE' : 'A2A_GATEWAY_TIMEOUT';
      timeouts += 1;
    } else if (roll < mismatchRate + timeoutRate + highRiskRate) {
      scenario = 'HUMAN_APPROVAL';
      status = 'NEEDS_HUMAN';
      verificationStatus = 'NEEDS_HUMAN';
      currentStage = 'RISK_ASSESSMENT';
      blockedReason = 'High-value MCC risk score exceeded 65; awaiting manager approval.';
      clusterKey = 'HIGH_RISK_COMPLIANCE_APPROVAL';
      highRisk += 1;
    } else {
      verified += 1;
    }

    const salesHop = 32 + (i % 25);
    const kycHop = 65 + (i % 55) + (scenario === 'FALSE_COMPLETION' ? 28 : 0);
    const riskHop = 48 + (i % 40) + (scenario === 'HUMAN_APPROVAL' ? 35 : 0);
    const opsHop = 52 + (i % 38);
    const verifyBase = 40 + (i % 45) + (scenario === 'SOURCE_UNAVAILABLE' ? 380 : 0);

    const totalLatMs =
      status === 'VERIFIED'
        ? salesHop + kycHop + riskHop + opsHop + verifyBase * 4
        : salesHop + kycHop + verifyBase * 2;

    const assignedTo = i % 4 === 0 ? null : TEAM_ROSTER[i % TEAM_ROSTER.length];
    const completedAt = status === 'VERIFIED' ? new Date(startMs + totalLatMs).toISOString() : null;
    const updatedAt = completedAt ?? new Date(startMs + 900).toISOString();

    const handoffs: A2AHandoff[] = [
      {
        id: `hop_${seq}_1`,
        journeyId,
        sequence: 1,
        fromAgent: 'Merchant Intake',
        toAgent: 'Sales Agent',
        stageName: 'SALES_ONBOARDING',
        payloadSummary: `Profile ${extRef} created`,
        passedFields: ['merchantName', 'externalReference'],
        flaggedFields: scenario === 'API_TIMEOUT' ? ['gatewayTimeout5000ms'] : [],
        a2aHopMs: salesHop,
        officialVerifyMs: verifyBase,
        outcome: scenario === 'API_TIMEOUT' ? 'TIMEOUT' : 'VERIFIED',
        timestamp: startedAt,
      },
      {
        id: `hop_${seq}_2`,
        journeyId,
        sequence: 2,
        fromAgent: 'Sales Agent',
        toAgent: 'KYC Agent',
        stageName: 'KYC_VERIFICATION',
        payloadSummary:
          scenario === 'FALSE_COMPLETION'
            ? 'KYC Agent claimed Approved; Bank KYC Ledger returned Pending.'
            : scenario === 'SOURCE_UNAVAILABLE'
              ? 'Bank KYC API timed out (503) during verification check.'
              : 'PAN/GST documents matched Bank KYC Ledger.',
        passedFields: ['panToken', 'gstinToken'],
        flaggedFields:
          scenario === 'FALSE_COMPLETION'
            ? ['kycStatusMismatch']
            : scenario === 'SOURCE_UNAVAILABLE'
              ? ['source503Unavailable']
              : [],
        a2aHopMs: kycHop,
        officialVerifyMs: verifyBase + (scenario === 'SOURCE_UNAVAILABLE' ? 290 : 12),
        outcome:
          scenario === 'FALSE_COMPLETION'
            ? 'MISMATCH'
            : scenario === 'SOURCE_UNAVAILABLE'
              ? 'TIMEOUT'
              : 'VERIFIED',
        timestamp: new Date(startMs + salesHop + verifyBase).toISOString(),
      },
    ];

    if (scenario === 'NORMAL' || scenario === 'HUMAN_APPROVAL') {
      handoffs.push({
        id: `hop_${seq}_3`,
        journeyId,
        sequence: 3,
        fromAgent: 'KYC Agent',
        toAgent: 'Risk Agent',
        stageName: 'RISK_ASSESSMENT',
        payloadSummary:
          scenario === 'HUMAN_APPROVAL'
            ? 'Risk score 81/100 flagged for compliance approval.'
            : 'Risk score 21/100 cleared policy.',
        passedFields: ['kycLedgerId', `riskScore=${scenario === 'HUMAN_APPROVAL' ? 81 : 21}`],
        flaggedFields: scenario === 'HUMAN_APPROVAL' ? ['highValueThreshold'] : [],
        a2aHopMs: riskHop,
        officialVerifyMs: verifyBase,
        outcome: scenario === 'HUMAN_APPROVAL' ? 'ESCALATED' : 'VERIFIED',
        timestamp: new Date(startMs + salesHop + kycHop + verifyBase * 2).toISOString(),
      });
    }

    if (status === 'VERIFIED') {
      handoffs.push({
        id: `hop_${seq}_4`,
        journeyId,
        sequence: 4,
        fromAgent: 'Risk Agent',
        toAgent: 'Operations Agent',
        stageName: 'OPERATIONS_ACTIVATION',
        payloadSummary: `Activated rails under ACT-${88400 + seq}.`,
        passedFields: ['activationCode', 'idempotencyKey'],
        flaggedFields: [],
        a2aHopMs: opsHop,
        officialVerifyMs: verifyBase,
        outcome: 'VERIFIED',
        timestamp: completedAt!,
      });
    }

    newJourneys.push({
      id: journeyId,
      externalReference: extRef,
      merchantName: name,
      journeyType: 'MERCHANT_ONBOARDING',
      scenario,
      status,
      verificationStatus,
      currentStage,
      environment: 'SIMULATED',
      correlationId: `corr_${88400 + seq}_sim`,
      workflowId: `wf-onboard-${extRef.toLowerCase()}`,
      startedAt,
      completedAt,
      updatedAt,
      durationMs: status === 'VERIFIED' ? totalLatMs : null,
      blockedReason,
      assignedTo,
      slaDeadlineAt: new Date(startMs + 3600 * 1000).toISOString(),
      clusterKey,
      handoffs,
    });

    // Authoritative records
    state.authoritative.merchants[extRef] = {
      merchantReference: extRef,
      merchantName: name,
      status: 'PROFILE_CREATED',
      updatedAt: startedAt,
    };
    state.authoritative.kyc[extRef] = {
      merchantReference: extRef,
      status: scenario === 'FALSE_COMPLETION' || scenario === 'SOURCE_UNAVAILABLE' ? 'KYC_PENDING' : 'KYC_APPROVED',
      checkCount: 1,
      autoApproveAfterChecks: null,
      updatedAt,
    };
    if (scenario === 'NORMAL' || scenario === 'HUMAN_APPROVAL') {
      state.authoritative.risk[extRef] = {
        merchantReference: extRef,
        status: scenario === 'HUMAN_APPROVAL' ? 'RISK_REVIEW_REQUIRED' : 'RISK_CLEARED',
        score: scenario === 'HUMAN_APPROVAL' ? 81 : 21,
        updatedAt,
      };
    }

    // 4 stages
    const stgBase: Array<{ order: number; stageName: StageName; label: string; agentId: string; agentName: string; expectedState: string }> = [
      { order: 1, stageName: 'SALES_ONBOARDING', label: 'Sales Onboarding', agentId: 'agent_sales', agentName: 'Sales Agent', expectedState: 'PROFILE_CREATED' },
      { order: 2, stageName: 'KYC_VERIFICATION', label: 'KYC Verification', agentId: 'agent_kyc', agentName: 'KYC Agent', expectedState: 'KYC_APPROVED' },
      { order: 3, stageName: 'RISK_ASSESSMENT', label: 'Risk Assessment', agentId: 'agent_risk', agentName: 'Risk Agent', expectedState: 'RISK_CLEARED' },
      { order: 4, stageName: 'OPERATIONS_ACTIVATION', label: 'Operations Activation', agentId: 'agent_ops', agentName: 'Operations Agent', expectedState: 'ACTIVATED' },
    ];

    for (const d of stgBase) {
      let sStatus: JourneyStage['status'] = 'NOT_STARTED';
      let vStatus: JourneyStage['validationStatus'] = 'PENDING';
      let actualState: string | null = null;
      let reportedState: string | null = null;
      let sBlocked: string | null = null;
      let lat: number | null = null;

      if (d.order === 1) {
        sStatus = scenario === 'API_TIMEOUT' ? 'FAILED' : 'VERIFIED';
        vStatus = scenario === 'API_TIMEOUT' ? 'FAIL' : 'PASS';
        actualState = scenario === 'API_TIMEOUT' ? 'PENDING' : 'PROFILE_CREATED';
        reportedState = scenario === 'API_TIMEOUT' ? 'PENDING' : 'COMPLETED';
        lat = salesHop + verifyBase;
      } else if (d.order === 2 && scenario !== 'API_TIMEOUT') {
        if (scenario === 'FALSE_COMPLETION') {
          sStatus = 'BLOCKED';
          vStatus = 'MISMATCH';
          actualState = 'KYC_PENDING';
          reportedState = 'KYC_APPROVED';
          sBlocked = 'AI claimed KYC_APPROVED while Bank KYC shows KYC_PENDING.';
        } else if (scenario === 'SOURCE_UNAVAILABLE') {
          sStatus = 'VERIFICATION_PENDING';
          vStatus = 'UNAVAILABLE';
          actualState = 'SOURCE_503_UNAVAILABLE';
          reportedState = 'KYC_APPROVED';
          sBlocked = 'Authoritative KYC API returned 503.';
        } else {
          sStatus = 'VERIFIED';
          vStatus = 'PASS';
          actualState = 'KYC_APPROVED';
          reportedState = 'KYC_APPROVED';
        }
        lat = kycHop + verifyBase;
      } else if (d.order === 3 && (scenario === 'NORMAL' || scenario === 'HUMAN_APPROVAL')) {
        if (scenario === 'HUMAN_APPROVAL') {
          sStatus = 'NEEDS_HUMAN';
          vStatus = 'MISMATCH';
          actualState = 'RISK_REVIEW_REQUIRED';
          reportedState = 'FLAGGED';
          sBlocked = 'High-risk MCC requires Compliance Officer sign-off.';
        } else {
          sStatus = 'VERIFIED';
          vStatus = 'PASS';
          actualState = 'RISK_CLEARED';
          reportedState = 'RISK_CLEARED';
        }
        lat = riskHop + verifyBase;
      } else if (d.order === 4 && status === 'VERIFIED') {
        sStatus = 'VERIFIED';
        vStatus = 'PASS';
        actualState = 'ACTIVATED';
        reportedState = 'ACTIVATED';
        lat = opsHop + verifyBase;
      }

      const stageId = `stg_${seq}_${d.order}`;
      newStages.push({
        id: stageId,
        journeyId,
        order: d.order,
        stageName: d.stageName,
        label: d.label,
        agentId: d.agentId,
        agentName: d.agentName,
        status: sStatus,
        validationStatus: vStatus,
        expectedState: d.expectedState,
        actualState,
        reportedState,
        retryCount: 0,
        maxRetries: 3,
        latencyMs: lat,
        startedAt: lat ? startedAt : null,
        completedAt: sStatus === 'VERIFIED' ? updatedAt : null,
        blockedReason: sBlocked,
      });

      // Keep detailed ValidationCheck/AgentRun caps manageable when generating 10,000 items so Analytics & Inspector remain instant
      if (lat && (i < 400 || d.stageName === currentStage)) {
        newRuns.push({
          id: `run_${seq}_${d.order}`,
          journeyId,
          stageId,
          agentId: d.agentId,
          requestId: `req_${seq}_${d.order}`,
          idempotencyKey: `idem_${journeyId}_${d.stageName.toLowerCase()}`,
          toolName: d.stageName.toLowerCase(),
          inputSummary: `merchantReference="${extRef}"`,
          outputSummary: `${d.agentName} processed ${d.label}`,
          reportedStatus: reportedState ?? 'COMPLETED',
          executionStatus: scenario === 'API_TIMEOUT' && d.order === 1 ? 'TIMEOUT' : 'SUCCESS',
          latencyMs: lat,
          startedAt,
          completedAt: updatedAt,
        });
      }

      if (vStatus !== 'PENDING' && (i < 400 || vStatus !== 'PASS')) {
        newChecks.push({
          id: `chk_${seq}_${d.order}`,
          journeyId,
          stageId,
          stageName: d.stageName,
          validationType: 'BUSINESS_OUTCOME',
          checkName: `Authoritative ${d.label} Gate`,
          expectedValue: d.expectedState,
          actualValue: actualState ?? 'PENDING',
          result: vStatus,
          reason: sBlocked ?? 'Verified cleanly against authoritative source.',
          evidenceId: null,
          checkedAt: updatedAt,
        });
      }
    }

    if (scenario === 'HUMAN_APPROVAL') {
      newApprovals.push({
        id: `apr_${seq}`,
        journeyId,
        merchantName: name,
        stageId: `stg_${seq}_3`,
        stageName: 'RISK_ASSESSMENT',
        reason: 'Risk score 81/100 exceeds automated activation threshold (65).',
        riskLevel: 'HIGH',
        requestedAction: 'Approve Risk Clearance & Resume Operations Activation',
        status: 'PENDING',
        requestedBy: 'agent_risk',
        assignedReviewer: assignedTo ?? 'Compliance Ops Lead',
        reviewedBy: null,
        decisionReason: null,
        createdAt: startedAt,
        deadlineAt: new Date(startMs + 3600 * 1000).toISOString(),
        resolvedAt: null,
      });
    }

    // Record compact hash-chained audit event per synthetic journey (keeps global verifyAuditChain 100% intact)
    state.counters.auditSeq += 1;
    const aSeq = state.counters.auditSeq;
    const evt = createAuditEvent({
      id: `evt_${String(aSeq).padStart(5, '0')}`,
      sequence: aSeq,
      journeyId,
      correlationId: `corr_${88400 + seq}_sim`,
      actorType: status === 'VERIFIED' ? 'VERIFIER' : 'WORKFLOW',
      actorId: status === 'VERIFIED' ? 'outcome-engine' : 'orchestrator',
      eventType:
        status === 'VERIFIED'
          ? 'JOURNEY_VERIFIED'
          : status === 'BLOCKED'
            ? 'OUTCOME_VERIFICATION_FAILED'
            : status === 'NEEDS_HUMAN'
              ? 'APPROVAL_REQUESTED'
              : 'RETRY_SCHEDULED',
      previousState: 'RUNNING',
      newState: status,
      metadata: { batchSimulation: true, scenario },
      previousHash: prevHash,
      createdAt: updatedAt,
    });
    prevHash = evt.eventHash;
    newAuditEvents.push(evt);
  }

  // Newest first for journeys, approvals, runs, checks; chronological for auditEvents
  state.journeys = [...newJourneys.reverse(), ...state.journeys];
  state.stages.push(...newStages);
  state.agentRuns = [...newRuns.reverse(), ...state.agentRuns];
  state.validationChecks = [...newChecks.reverse(), ...state.validationChecks];
  state.approvalRequests = [...newApprovals.reverse(), ...state.approvalRequests];
  state.auditEvents.push(...newAuditEvents);

  store.persist();

  return {
    createdCount: count,
    summary: { verified, mismatches, timeouts, highRisk },
    elapsedMs: Date.now() - t0,
  };
}

export function probeProtocolConnections() {
  const state = store.getState();
  const nowIso = new Date().toISOString();
  const baseline: Record<string, number> = {
    int_pi_rpc: 14,
    int_pi_sdk: 8,
    int_a2a_bus: 26,
    int_mcp_server: 21,
    int_acp_gate: 6,
    int_merchant_api: 38,
    int_kyc_api: 64,
    int_risk_api: 52,
    int_activation_api: 47,
    int_otel_collector: 9,
  };

  for (const int of state.integrations) {
    int.lastCheckedAt = nowIso;
    if (int.status === 'HEALTHY') {
      const base = baseline[int.id] ?? int.latencyMs;
      const jitter = Math.floor(Math.random() * 7) - 3;
      int.latencyMs = Math.max(3, base + jitter);
    }
  }

  store.persist();

  const healthyCount = state.integrations.filter((i) => i.status === 'HEALTHY').length;
  return {
    integrations: state.integrations,
    healthyCount,
    totalCount: state.integrations.length,
  };
}
