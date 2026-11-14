import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type {
  A2AHandoff,
  AgentDefinition,
  AgentRun,
  ApprovalRequest,
  AuditEvent,
  EvidenceRecord,
  IdempotencyRecord,
  Journey,
  JourneyStage,
  PolicySettings,
  SystemIntegration,
  ValidationCheck,
} from '../core/types';
import { GENESIS_HASH, createAuditEvent } from '../core/audit';

export interface AuthoritativeMerchantRecord {
  merchantReference: string;
  merchantName: string;
  status: 'PROFILE_CREATED' | 'PENDING';
  updatedAt: string;
}

export interface AuthoritativeKycRecord {
  merchantReference: string;
  status: 'KYC_PENDING' | 'KYC_APPROVED' | 'KYC_REJECTED';
  checkCount: number;
  autoApproveAfterChecks: number | null;
  updatedAt: string;
}

export interface AuthoritativeRiskRecord {
  merchantReference: string;
  status: 'RISK_CLEARED' | 'RISK_REVIEW_REQUIRED' | 'RISK_PENDING';
  score: number;
  updatedAt: string;
}

export interface AuthoritativeActivationRecord {
  merchantReference: string;
  status: 'ACTIVATED' | 'PENDING';
  idempotencyKey: string;
  activationCode: string;
  updatedAt: string;
}

export interface StoreState {
  journeys: Journey[];
  stages: JourneyStage[];
  agents: AgentDefinition[];
  agentRuns: AgentRun[];
  validationChecks: ValidationCheck[];
  evidenceRecords: EvidenceRecord[];
  idempotencyKeys: IdempotencyRecord[];
  auditEvents: AuditEvent[];
  approvalRequests: ApprovalRequest[];
  integrations: SystemIntegration[];
  policies: PolicySettings;
  authoritative: {
    merchants: Record<string, AuthoritativeMerchantRecord>;
    kyc: Record<string, AuthoritativeKycRecord>;
    risk: Record<string, AuthoritativeRiskRecord>;
    activations: Record<string, AuthoritativeActivationRecord>;
  };
  counters: {
    journeySeq: number;
    auditSeq: number;
  };
}

const DATA_DIR = path.resolve(process.cwd(), '.data');
const STORE_FILE = path.join(DATA_DIR, 'agentbridge-store.json');

function hashPayload(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16);
}

export function createSeedIntegrations(
  iso: (offsetSec: number) => string = (offsetSec) => new Date(Date.now() + offsetSec * 1000).toISOString()
): SystemIntegration[] {
  return [
    {
      id: 'int_pi_rpc',
      name: 'Pi Agent Native RPC',
      category: 'PI_RUNTIME',
      protocol: 'JSONL_RPC',
      protocolLabel: 'Pi RPC (JSONL stdio)',
      transport: 'stdin / stdout LF-JSONL',
      pipelineOrder: 1,
      details: 'Headless Pi worker (--mode rpc) driving rule, ML scorer, and LLM execution turns.',
      endpoint: 'sim://pi-agent/rpc-worker',
      apiVersion: '1.0.4',
      status: 'HEALTHY',
      permissions: ['worker:spawn', 'events:stream'],
      capabilities: ['prompt_dispatch', 'jsonl_event_stream', 'rule_ml_llm_loop'],
      lastCheckedAt: iso(-4),
      latencyMs: 14,
    },
    {
      id: 'int_pi_sdk',
      name: 'Pi TypeScript SDK Runtime',
      category: 'PI_RUNTIME',
      protocol: 'TS_SDK',
      protocolLabel: 'Pi SDK (pi-agent-core)',
      transport: 'In-Process TypeScript SDK',
      pipelineOrder: 1,
      details: 'Embedded Pi agent core runtime managing stateful stage context & structured responses.',
      endpoint: 'sim://pi-agent/sdk-core',
      apiVersion: '1.0.4',
      status: 'HEALTHY',
      permissions: ['agent:invoke', 'context:read'],
      capabilities: ['turn_orchestration', 'schema_serialization'],
      lastCheckedAt: iso(-6),
      latencyMs: 8,
    },
    {
      id: 'int_a2a_bus',
      name: 'Pi-A2A Peer Handoff Bus',
      category: 'AGENT_PROTOCOL',
      protocol: 'A2A_JSON_RPC',
      protocolLabel: 'A2A v1.0 (JSON-RPC 2.0)',
      transport: 'Agent Cards + HTTPS JSON-RPC / SSE',
      pipelineOrder: 2,
      details: 'Agent Card discovery (.well-known/agent-card.json) and peer task delegation across 4 agents.',
      endpoint: 'sim://a2a/.well-known/agent-card.json',
      apiVersion: '1.0.0',
      status: 'HEALTHY',
      permissions: ['a2a:discover', 'a2a:delegate'],
      capabilities: ['agent_card_discovery', 'cross_agent_handoff', 'async_task_sse'],
      lastCheckedAt: iso(-7),
      latencyMs: 26,
    },
    {
      id: 'int_mcp_server',
      name: 'Pi-MCP Merchant Tool Adapter',
      category: 'TOOL_PROTOCOL',
      protocol: 'MCP_HTTP',
      protocolLabel: 'MCP (Streamable HTTP)',
      transport: 'Streamable HTTP + Codemode Sandbox',
      pipelineOrder: 2,
      details: 'Model Context Protocol bridge exposing PAN/GST, registry, and risk tools via tools/list.',
      endpoint: 'sim://mcp/merchant-tools/v1',
      apiVersion: '2025-06-18',
      status: 'HEALTHY',
      permissions: ['mcp:tools:list', 'mcp:tools:call'],
      capabilities: ['tools_list_discovery', 'pan_gst_lookup', 'codemode_sandbox'],
      lastCheckedAt: iso(-9),
      latencyMs: 21,
    },
    {
      id: 'int_acp_gate',
      name: 'ACP Guardrail Policy Gate',
      category: 'AGENT_PROTOCOL',
      protocol: 'ACP_POLICY',
      protocolLabel: 'ACP (Agentic Control Plane)',
      transport: 'Pre-Tool Intercept Hook',
      pipelineOrder: 3,
      details: 'Intercepts Pi tool calls pre-execution to enforce allow/ask/deny & idempotency locks.',
      endpoint: 'sim://agentbridge/acp-policy-gate',
      apiVersion: '1.2.0',
      status: 'HEALTHY',
      permissions: ['policy:enforce', 'execution:block'],
      capabilities: ['schema_guard', 'permission_enforce', 'idempotency_lock'],
      lastCheckedAt: iso(-3),
      latencyMs: 6,
    },
    {
      id: 'int_merchant_api',
      name: 'Authoritative Merchant API',
      category: 'SOURCE_SYSTEM',
      protocol: 'REST_HTTPS',
      protocolLabel: 'REST + Idempotency Key',
      transport: 'mTLS HTTPS JSON',
      pipelineOrder: 4,
      details: 'Authoritative Paytm merchant profile & external reference registry.',
      endpoint: 'sim://source/merchant-registry/v2',
      apiVersion: '2.4.1',
      status: 'HEALTHY',
      permissions: ['merchant:read', 'merchant:write'],
      capabilities: ['profile_lookup', 'reference_verification'],
      lastCheckedAt: iso(-10),
      latencyMs: 38,
    },
    {
      id: 'int_kyc_api',
      name: 'Authoritative KYC API',
      category: 'SOURCE_SYSTEM',
      protocol: 'REST_HTTPS',
      protocolLabel: 'REST + Ledger Webhook',
      transport: 'mTLS HTTPS JSON',
      pipelineOrder: 4,
      details: 'Independent Bank KYC ledger queried before Risk or Account Activation proceeds.',
      endpoint: 'sim://source/kyc-ledger/v3',
      apiVersion: '3.1.0',
      status: 'HEALTHY',
      permissions: ['kyc:read', 'kyc:submit'],
      capabilities: ['authoritative_kyc_status', 'document_hash_check'],
      lastCheckedAt: iso(-8),
      latencyMs: 64,
    },
    {
      id: 'int_risk_api',
      name: 'Authoritative Risk Engine API',
      category: 'SOURCE_SYSTEM',
      protocol: 'REST_HTTPS',
      protocolLabel: 'REST + Rule/ML Scorer',
      transport: 'mTLS HTTPS JSON',
      pipelineOrder: 4,
      details: 'Official MCC policy & fraud threshold verification gateway.',
      endpoint: 'sim://source/risk-scoring/v1',
      apiVersion: '1.9.0',
      status: 'HEALTHY',
      permissions: ['risk:read', 'risk:evaluate'],
      capabilities: ['mcc_screening', 'policy_threshold_check'],
      lastCheckedAt: iso(-12),
      latencyMs: 52,
    },
    {
      id: 'int_activation_api',
      name: 'Authoritative Activation API',
      category: 'SOURCE_SYSTEM',
      protocol: 'REST_HTTPS',
      protocolLabel: 'REST + Idempotency Key',
      transport: 'mTLS HTTPS JSON',
      pipelineOrder: 4,
      details: 'Settlement rail & live merchant account provisioning gateway with duplicate lock.',
      endpoint: 'sim://source/activation-gateway/v2',
      apiVersion: '2.2.0',
      status: 'HEALTHY',
      permissions: ['activation:read', 'merchant:activate'],
      capabilities: ['idempotent_provision', 'rail_status_query'],
      lastCheckedAt: iso(-15),
      latencyMs: 47,
    },
    {
      id: 'int_otel_collector',
      name: 'OTLP Telemetry & Audit Stream',
      category: 'OBSERVABILITY',
      protocol: 'OTLP_HTTP',
      protocolLabel: 'OTLP/HTTP + SSE + SHA-256',
      transport: 'HTTP/Protobuf (:4318) + SSE',
      pipelineOrder: 5,
      details: 'Distributed GenAI span collector, SSE dashboard push, and SHA-256 tamper-evident ledger.',
      endpoint: 'http://localhost:4318/v1/traces',
      apiVersion: '0.104.0',
      status: 'HEALTHY',
      permissions: ['traces:write', 'metrics:write'],
      capabilities: ['genai_spans', 'workflow_correlation', 'sha256_hash_chain'],
      lastCheckedAt: iso(-5),
      latencyMs: 9,
    },
  ];
}

export function createSeedState(): StoreState {
  const now = Date.now();
  const iso = (offsetSec: number) => new Date(now + offsetSec * 1000).toISOString();

  const agents: AgentDefinition[] = [
    {
      id: 'agent_sales',
      name: 'Sales Agent',
      type: 'SALES',
      version: '2.1.0',
      endpoint: 'sim://agents/sales-onboarding',
      capabilities: ['create_merchant_profile', 'assign_merchant_reference'],
      permissions: ['merchant:create', 'merchant:read'],
      health: 'HEALTHY',
      description: 'Creates merchant profile, validates initial business metadata, and issues merchant reference.',
      lastActiveAt: iso(-120),
    },
    {
      id: 'agent_kyc',
      name: 'KYC Agent',
      type: 'KYC',
      version: '1.8.2',
      endpoint: 'sim://agents/kyc-verification',
      capabilities: ['submit_kyc_application', 'fetch_kyc_status'],
      permissions: ['kyc:submit', 'kyc:read'],
      health: 'HEALTHY',
      description: 'Submits merchant PAN/GST documents to KYC registry and collects verification responses.',
      lastActiveAt: iso(-45),
    },
    {
      id: 'agent_risk',
      name: 'Risk Agent',
      type: 'RISK',
      version: '1.5.0',
      endpoint: 'sim://agents/risk-scoring',
      capabilities: ['evaluate_merchant_risk', 'request_human_escalation'],
      permissions: ['risk:evaluate', 'risk:read', 'approval:request'],
      health: 'HEALTHY',
      description: 'Evaluates MCC risk profile, settlement limits, and triggers human approval when thresholds exceed policy.',
      lastActiveAt: iso(-90),
    },
    {
      id: 'agent_ops',
      name: 'Operations Agent',
      type: 'OPERATIONS',
      version: '2.0.4',
      endpoint: 'sim://agents/merchant-operations',
      capabilities: ['activate_merchant_account', 'check_activation_prerequisites'],
      permissions: ['merchant:activate', 'activation:read'],
      health: 'HEALTHY',
      description: 'Verifies upstream gates and provisions live settlement rails for verified merchants.',
      lastActiveAt: iso(-180),
    },
  ];

  const integrations: SystemIntegration[] = createSeedIntegrations(iso);

  // Seed 3 rich journeys representing real operational states:
  // 1) jrn_1001: BLOCKED due to False Completion (KYC Agent claimed KYC_APPROVED, Authoritative KYC API is KYC_PENDING)
  // 2) jrn_1002: VERIFIED full successful journey
  // 3) jrn_1003: NEEDS_HUMAN waiting in Approval Queue
  const journeys: Journey[] = [
    {
      id: 'jrn_1001',
      externalReference: 'MRC-88412',
      merchantName: 'Kaveri Fresh Foods Pvt Ltd',
      journeyType: 'MERCHANT_ONBOARDING',
      scenario: 'FALSE_COMPLETION',
      status: 'BLOCKED',
      verificationStatus: 'MISMATCH',
      currentStage: 'KYC_VERIFICATION',
      environment: 'SIMULATED',
      correlationId: 'corr_88412_fc',
      workflowId: 'wf-onboard-mrc-88412',
      startedAt: iso(-5400),
      completedAt: null,
      updatedAt: iso(-45),
      durationMs: null,
      blockedReason: 'Agent claimed KYC_APPROVED while Authoritative KYC API reports KYC_PENDING. Operations stage blocked.',
      assignedTo: 'Priya Nair',
      slaDeadlineAt: iso(1800),
      clusterKey: 'KYC_PREMATURE_CLAIM',
      handoffs: [
        {
          id: 'hop_1001_1',
          journeyId: 'jrn_1001',
          sequence: 1,
          fromAgent: 'Merchant Intake',
          toAgent: 'Sales Agent',
          stageName: 'SALES_ONBOARDING',
          payloadSummary: 'Created merchant profile MRC-88412 and passed GSTIN/MCC intake bundle.',
          passedFields: ['merchantName', 'externalReference', 'mcc=5411', 'gstinHash'],
          flaggedFields: [],
          a2aHopMs: 42,
          officialVerifyMs: 38,
          outcome: 'VERIFIED',
          timestamp: iso(-5390),
        },
        {
          id: 'hop_1001_2',
          journeyId: 'jrn_1001',
          sequence: 2,
          fromAgent: 'Sales Agent',
          toAgent: 'KYC Agent',
          stageName: 'KYC_VERIFICATION',
          payloadSummary: 'KYC Agent reported KYC_APPROVED immediately upon document upload; Bank KYC API still shows KYC_PENDING.',
          passedFields: ['merchantReference', 'panToken', 'gstinToken'],
          flaggedFields: ['kycStatusMismatch (AI=Approved vs Bank=Pending)'],
          a2aHopMs: 84,
          officialVerifyMs: 64,
          outcome: 'MISMATCH',
          timestamp: iso(-5200),
        },
      ],
    },
    {
      id: 'jrn_1002',
      externalReference: 'MRC-88409',
      merchantName: 'Deccan Mobility Electronics',
      journeyType: 'MERCHANT_ONBOARDING',
      scenario: 'NORMAL',
      status: 'VERIFIED',
      verificationStatus: 'VERIFIED',
      currentStage: 'OPERATIONS_ACTIVATION',
      environment: 'SIMULATED',
      correlationId: 'corr_88409_ok',
      workflowId: 'wf-onboard-mrc-88409',
      startedAt: iso(-940),
      completedAt: iso(-880),
      updatedAt: iso(-880),
      durationMs: 60000,
      blockedReason: null,
      assignedTo: 'Rohan Mehta',
      slaDeadlineAt: iso(3600),
      clusterKey: 'VERIFIED',
      handoffs: [
        {
          id: 'hop_1002_1',
          journeyId: 'jrn_1002',
          sequence: 1,
          fromAgent: 'Merchant Intake',
          toAgent: 'Sales Agent',
          stageName: 'SALES_ONBOARDING',
          payloadSummary: 'Merchant profile MRC-88409 registered cleanly.',
          passedFields: ['merchantName', 'externalReference', 'mcc=5732'],
          flaggedFields: [],
          a2aHopMs: 35,
          officialVerifyMs: 36,
          outcome: 'VERIFIED',
          timestamp: iso(-930),
        },
        {
          id: 'hop_1002_2',
          journeyId: 'jrn_1002',
          sequence: 2,
          fromAgent: 'Sales Agent',
          toAgent: 'KYC Agent',
          stageName: 'KYC_VERIFICATION',
          payloadSummary: 'PAN/GST documents matched Bank KYC ledger.',
          passedFields: ['panToken', 'gstinToken', 'bankLedgerId'],
          flaggedFields: [],
          a2aHopMs: 78,
          officialVerifyMs: 62,
          outcome: 'VERIFIED',
          timestamp: iso(-912),
        },
        {
          id: 'hop_1002_3',
          journeyId: 'jrn_1002',
          sequence: 3,
          fromAgent: 'KYC Agent',
          toAgent: 'Risk Agent',
          stageName: 'RISK_ASSESSMENT',
          payloadSummary: 'MCC risk score 22/100 cleared policy gate.',
          passedFields: ['riskScore=22', 'settlementTier=STANDARD'],
          flaggedFields: [],
          a2aHopMs: 54,
          officialVerifyMs: 49,
          outcome: 'VERIFIED',
          timestamp: iso(-898),
        },
        {
          id: 'hop_1002_4',
          journeyId: 'jrn_1002',
          sequence: 4,
          fromAgent: 'Risk Agent',
          toAgent: 'Operations Agent',
          stageName: 'OPERATIONS_ACTIVATION',
          payloadSummary: 'UPI & Card rails provisioned under ACT-88409.',
          passedFields: ['activationCode=ACT-88409', 'idempotencyKey'],
          flaggedFields: [],
          a2aHopMs: 61,
          officialVerifyMs: 45,
          outcome: 'VERIFIED',
          timestamp: iso(-880),
        },
      ],
    },
    {
      id: 'jrn_1003',
      externalReference: 'MRC-88415',
      merchantName: 'Sahyadri Bullion & Jewels',
      journeyType: 'MERCHANT_ONBOARDING',
      scenario: 'HUMAN_APPROVAL',
      status: 'NEEDS_HUMAN',
      verificationStatus: 'NEEDS_HUMAN',
      currentStage: 'RISK_ASSESSMENT',
      environment: 'SIMULATED',
      correlationId: 'corr_88415_hr',
      workflowId: 'wf-onboard-mrc-88415',
      startedAt: iso(-2700),
      completedAt: null,
      updatedAt: iso(-90),
      durationMs: null,
      blockedReason: 'High-value MCC 5944 flagged for human compliance sign-off before Operations activation.',
      assignedTo: 'Ananya Iyer',
      slaDeadlineAt: iso(900),
      clusterKey: 'HIGH_RISK_COMPLIANCE_APPROVAL',
      handoffs: [
        {
          id: 'hop_1003_1',
          journeyId: 'jrn_1003',
          sequence: 1,
          fromAgent: 'Merchant Intake',
          toAgent: 'Sales Agent',
          stageName: 'SALES_ONBOARDING',
          payloadSummary: 'Registered merchant profile MRC-88415.',
          passedFields: ['merchantName', 'externalReference', 'mcc=5944'],
          flaggedFields: [],
          a2aHopMs: 41,
          officialVerifyMs: 39,
          outcome: 'VERIFIED',
          timestamp: iso(-2690),
        },
        {
          id: 'hop_1003_2',
          journeyId: 'jrn_1003',
          sequence: 2,
          fromAgent: 'Sales Agent',
          toAgent: 'KYC Agent',
          stageName: 'KYC_VERIFICATION',
          payloadSummary: 'Bank KYC approved for Sahyadri Bullion & Jewels.',
          passedFields: ['panToken', 'gstinToken'],
          flaggedFields: [],
          a2aHopMs: 79,
          officialVerifyMs: 58,
          outcome: 'VERIFIED',
          timestamp: iso(-2620),
        },
        {
          id: 'hop_1003_3',
          journeyId: 'jrn_1003',
          sequence: 3,
          fromAgent: 'KYC Agent',
          toAgent: 'Risk Agent',
          stageName: 'RISK_ASSESSMENT',
          payloadSummary: 'Risk Agent scored MCC 5944 at 78/100 (>65 policy cap) and escalated to human queue.',
          passedFields: ['riskScore=78', 'mcc=5944'],
          flaggedFields: ['highValueThresholdExceeded (78 > 65)'],
          a2aHopMs: 92,
          officialVerifyMs: 54,
          outcome: 'ESCALATED',
          timestamp: iso(-2550),
        },
      ],
    },
  ];

  const stages: JourneyStage[] = [
    // jrn_1001
    {
      id: 'stg_1001_sales',
      journeyId: 'jrn_1001',
      order: 1,
      stageName: 'SALES_ONBOARDING',
      label: 'Sales Onboarding',
      agentId: 'agent_sales',
      agentName: 'Sales Agent',
      status: 'VERIFIED',
      validationStatus: 'PASS',
      expectedState: 'PROFILE_CREATED',
      actualState: 'PROFILE_CREATED',
      reportedState: 'COMPLETED',
      retryCount: 0,
      maxRetries: 3,
      latencyMs: 142,
      startedAt: iso(-320),
      completedAt: iso(-310),
      blockedReason: null,
    },
    {
      id: 'stg_1001_kyc',
      journeyId: 'jrn_1001',
      order: 2,
      stageName: 'KYC_VERIFICATION',
      label: 'KYC Verification',
      agentId: 'agent_kyc',
      agentName: 'KYC Agent',
      status: 'BLOCKED',
      validationStatus: 'MISMATCH',
      expectedState: 'KYC_APPROVED',
      actualState: 'KYC_PENDING',
      reportedState: 'KYC_APPROVED',
      retryCount: 1,
      maxRetries: 3,
      latencyMs: 218,
      startedAt: iso(-305),
      completedAt: null,
      blockedReason: 'Agent claim (KYC_APPROVED) contradicts authoritative KYC state (KYC_PENDING).',
    },
    {
      id: 'stg_1001_risk',
      journeyId: 'jrn_1001',
      order: 3,
      stageName: 'RISK_ASSESSMENT',
      label: 'Risk Assessment',
      agentId: 'agent_risk',
      agentName: 'Risk Agent',
      status: 'NOT_STARTED',
      validationStatus: 'PENDING',
      expectedState: 'RISK_CLEARED',
      actualState: null,
      reportedState: null,
      retryCount: 0,
      maxRetries: 3,
      latencyMs: null,
      startedAt: null,
      completedAt: null,
      blockedReason: 'Waiting on KYC Verification outcome gate.',
    },
    {
      id: 'stg_1001_ops',
      journeyId: 'jrn_1001',
      order: 4,
      stageName: 'OPERATIONS_ACTIVATION',
      label: 'Operations Activation',
      agentId: 'agent_ops',
      agentName: 'Operations Agent',
      status: 'NOT_STARTED',
      validationStatus: 'PENDING',
      expectedState: 'ACTIVATED',
      actualState: null,
      reportedState: null,
      retryCount: 0,
      maxRetries: 3,
      latencyMs: null,
      startedAt: null,
      completedAt: null,
      blockedReason: 'Downstream execution blocked until KYC & Risk gates pass.',
    },
    // jrn_1002
    {
      id: 'stg_1002_sales',
      journeyId: 'jrn_1002',
      order: 1,
      stageName: 'SALES_ONBOARDING',
      label: 'Sales Onboarding',
      agentId: 'agent_sales',
      agentName: 'Sales Agent',
      status: 'VERIFIED',
      validationStatus: 'PASS',
      expectedState: 'PROFILE_CREATED',
      actualState: 'PROFILE_CREATED',
      reportedState: 'COMPLETED',
      retryCount: 0,
      maxRetries: 3,
      latencyMs: 118,
      startedAt: iso(-940),
      completedAt: iso(-930),
      blockedReason: null,
    },
    {
      id: 'stg_1002_kyc',
      journeyId: 'jrn_1002',
      order: 2,
      stageName: 'KYC_VERIFICATION',
      label: 'KYC Verification',
      agentId: 'agent_kyc',
      agentName: 'KYC Agent',
      status: 'VERIFIED',
      validationStatus: 'PASS',
      expectedState: 'KYC_APPROVED',
      actualState: 'KYC_APPROVED',
      reportedState: 'KYC_APPROVED',
      retryCount: 0,
      maxRetries: 3,
      latencyMs: 194,
      startedAt: iso(-928),
      completedAt: iso(-912),
      blockedReason: null,
    },
    {
      id: 'stg_1002_risk',
      journeyId: 'jrn_1002',
      order: 3,
      stageName: 'RISK_ASSESSMENT',
      label: 'Risk Assessment',
      agentId: 'agent_risk',
      agentName: 'Risk Agent',
      status: 'VERIFIED',
      validationStatus: 'PASS',
      expectedState: 'RISK_CLEARED',
      actualState: 'RISK_CLEARED',
      reportedState: 'RISK_CLEARED',
      retryCount: 0,
      maxRetries: 3,
      latencyMs: 156,
      startedAt: iso(-910),
      completedAt: iso(-898),
      blockedReason: null,
    },
    {
      id: 'stg_1002_ops',
      journeyId: 'jrn_1002',
      order: 4,
      stageName: 'OPERATIONS_ACTIVATION',
      label: 'Operations Activation',
      agentId: 'agent_ops',
      agentName: 'Operations Agent',
      status: 'VERIFIED',
      validationStatus: 'PASS',
      expectedState: 'ACTIVATED',
      actualState: 'ACTIVATED',
      reportedState: 'ACTIVATED',
      retryCount: 0,
      maxRetries: 3,
      latencyMs: 175,
      startedAt: iso(-896),
      completedAt: iso(-880),
      blockedReason: null,
    },
    // jrn_1003
    {
      id: 'stg_1003_sales',
      journeyId: 'jrn_1003',
      order: 1,
      stageName: 'SALES_ONBOARDING',
      label: 'Sales Onboarding',
      agentId: 'agent_sales',
      agentName: 'Sales Agent',
      status: 'VERIFIED',
      validationStatus: 'PASS',
      expectedState: 'PROFILE_CREATED',
      actualState: 'PROFILE_CREATED',
      reportedState: 'COMPLETED',
      retryCount: 0,
      maxRetries: 3,
      latencyMs: 132,
      startedAt: iso(-210),
      completedAt: iso(-198),
      blockedReason: null,
    },
    {
      id: 'stg_1003_kyc',
      journeyId: 'jrn_1003',
      order: 2,
      stageName: 'KYC_VERIFICATION',
      label: 'KYC Verification',
      agentId: 'agent_kyc',
      agentName: 'KYC Agent',
      status: 'VERIFIED',
      validationStatus: 'PASS',
      expectedState: 'KYC_APPROVED',
      actualState: 'KYC_APPROVED',
      reportedState: 'KYC_APPROVED',
      retryCount: 0,
      maxRetries: 3,
      latencyMs: 185,
      startedAt: iso(-195),
      completedAt: iso(-178),
      blockedReason: null,
    },
    {
      id: 'stg_1003_risk',
      journeyId: 'jrn_1003',
      order: 3,
      stageName: 'RISK_ASSESSMENT',
      label: 'Risk Assessment',
      agentId: 'agent_risk',
      agentName: 'Risk Agent',
      status: 'NEEDS_HUMAN',
      validationStatus: 'MISMATCH',
      expectedState: 'RISK_CLEARED',
      actualState: 'RISK_REVIEW_REQUIRED',
      reportedState: 'FLAGGED',
      retryCount: 0,
      maxRetries: 3,
      latencyMs: 210,
      startedAt: iso(-175),
      completedAt: null,
      blockedReason: 'Risk policy requires compliance officer approval for high-value MCC 5944.',
    },
    {
      id: 'stg_1003_ops',
      journeyId: 'jrn_1003',
      order: 4,
      stageName: 'OPERATIONS_ACTIVATION',
      label: 'Operations Activation',
      agentId: 'agent_ops',
      agentName: 'Operations Agent',
      status: 'NOT_STARTED',
      validationStatus: 'PENDING',
      expectedState: 'ACTIVATED',
      actualState: null,
      reportedState: null,
      retryCount: 0,
      maxRetries: 3,
      latencyMs: null,
      startedAt: null,
      completedAt: null,
      blockedReason: 'Awaiting Risk Assessment human sign-off.',
    },
  ];

  const agentRuns: AgentRun[] = [
    {
      id: 'run_1001_1',
      journeyId: 'jrn_1001',
      stageId: 'stg_1001_sales',
      agentId: 'agent_sales',
      requestId: 'req_1001_sales',
      idempotencyKey: 'idem_jrn_1001_sales',
      toolName: 'create_merchant_profile',
      inputSummary: 'merchantName="Kaveri Fresh Foods Pvt Ltd", ref="MRC-88412"',
      outputSummary: 'Profile created and merchant reference MRC-88412 assigned.',
      reportedStatus: 'COMPLETED',
      executionStatus: 'SUCCESS',
      latencyMs: 142,
      startedAt: iso(-320),
      completedAt: iso(-310),
    },
    {
      id: 'run_1001_2',
      journeyId: 'jrn_1001',
      stageId: 'stg_1001_kyc',
      agentId: 'agent_kyc',
      requestId: 'req_1001_kyc',
      idempotencyKey: 'idem_jrn_1001_kyc',
      toolName: 'submit_kyc_application',
      inputSummary: 'merchantReference="MRC-88412", docs=["PAN_REDACTED","GST_REDACTED"]',
      outputSummary: 'Agent reported KYC_APPROVED based on submission acknowledgement.',
      reportedStatus: 'KYC_APPROVED',
      executionStatus: 'SUCCESS',
      latencyMs: 218,
      startedAt: iso(-305),
      completedAt: iso(-298),
    },
    {
      id: 'run_1002_4',
      journeyId: 'jrn_1002',
      stageId: 'stg_1002_ops',
      agentId: 'agent_ops',
      requestId: 'req_1002_ops',
      idempotencyKey: 'idem_jrn_1002_ops',
      toolName: 'activate_merchant_account',
      inputSummary: 'merchantReference="MRC-88409", rails=["UPI","CARDS"]',
      outputSummary: 'Settlement account provisioned cleanly under act_88409.',
      reportedStatus: 'ACTIVATED',
      executionStatus: 'SUCCESS',
      latencyMs: 175,
      startedAt: iso(-896),
      completedAt: iso(-880),
    },
  ];

  const evidenceRecords: EvidenceRecord[] = [
    {
      id: 'evd_1001_sales',
      journeyId: 'jrn_1001',
      validationId: 'chk_1001_sales_out',
      sourceSystem: 'Authoritative Merchant API',
      evidenceType: 'MERCHANT_REGISTRY_SNAPSHOT',
      referenceId: 'src_mrc_88412',
      payloadHash: hashPayload({ merchantReference: 'MRC-88412', status: 'PROFILE_CREATED' }),
      redactedPayload: { merchantReference: 'MRC-88412', status: 'PROFILE_CREATED' },
      capturedAt: iso(-310),
    },
    {
      id: 'evd_1001_kyc',
      journeyId: 'jrn_1001',
      validationId: 'chk_1001_kyc_out',
      sourceSystem: 'Authoritative KYC API',
      evidenceType: 'KYC_LEDGER_STATE',
      referenceId: 'src_kyc_88412_v1',
      payloadHash: hashPayload({ merchantReference: 'MRC-88412', status: 'KYC_PENDING' }),
      redactedPayload: { merchantReference: 'MRC-88412', status: 'KYC_PENDING', pendingReason: 'MANUAL_PAN_MATCH_IN_QUEUE' },
      capturedAt: iso(-295),
    },
    {
      id: 'evd_1002_ops',
      journeyId: 'jrn_1002',
      validationId: 'chk_1002_ops_out',
      sourceSystem: 'Authoritative Activation API',
      evidenceType: 'ACTIVATION_RECEIPT',
      referenceId: 'act_88409',
      payloadHash: hashPayload({ merchantReference: 'MRC-88409', status: 'ACTIVATED' }),
      redactedPayload: { merchantReference: 'MRC-88409', status: 'ACTIVATED', activationCode: 'ACT-88409' },
      capturedAt: iso(-880),
    },
  ];

  const validationChecks: ValidationCheck[] = [
    {
      id: 'chk_1001_kyc_resp',
      journeyId: 'jrn_1001',
      stageId: 'stg_1001_kyc',
      stageName: 'KYC_VERIFICATION',
      validationType: 'AI_RESPONSE',
      checkName: 'AgentResponseSchema & Consistency',
      expectedValue: 'Valid schema & consistent metadata',
      actualValue: 'KYC_APPROVED (confidence 0.96)',
      result: 'PASS',
      reason: 'AI response schema passed; note that AI claim is never authoritative business proof.',
      evidenceId: null,
      checkedAt: iso(-298),
    },
    {
      id: 'chk_1001_kyc_exec',
      journeyId: 'jrn_1001',
      stageId: 'stg_1001_kyc',
      stageName: 'KYC_VERIFICATION',
      validationType: 'EXECUTION',
      checkName: 'Tool Identity, Permissions & Idempotency',
      expectedValue: 'Tool=submit_kyc_application, Perm=kyc:submit, UniqueKey',
      actualValue: 'Authorized (req_1001_kyc)',
      result: 'PASS',
      reason: 'Tool identity, least-privilege permissions, request identity, and idempotency key verified.',
      evidenceId: null,
      checkedAt: iso(-297),
    },
    {
      id: 'chk_1001_kyc_out',
      journeyId: 'jrn_1001',
      stageId: 'stg_1001_kyc',
      stageName: 'KYC_VERIFICATION',
      validationType: 'BUSINESS_OUTCOME',
      checkName: 'Authoritative KYC State Gate',
      expectedValue: 'KYC_APPROVED',
      actualValue: 'KYC_PENDING',
      result: 'MISMATCH',
      reason: 'Agent claimed KYC_APPROVED, but Authoritative KYC API reports KYC_PENDING. Operations activation blocked.',
      evidenceId: 'evd_1001_kyc',
      checkedAt: iso(-295),
    },
    {
      id: 'chk_1002_ops_out',
      journeyId: 'jrn_1002',
      stageId: 'stg_1002_ops',
      stageName: 'OPERATIONS_ACTIVATION',
      validationType: 'BUSINESS_OUTCOME',
      checkName: 'Authoritative Activation Gate',
      expectedValue: 'ACTIVATED',
      actualValue: 'ACTIVATED',
      result: 'PASS',
      reason: 'Authoritative Activation API confirmed state ACTIVATED (evidence: evd_1002_ops).',
      evidenceId: 'evd_1002_ops',
      checkedAt: iso(-880),
    },
  ];

  const idempotencyKeys: IdempotencyRecord[] = [
    {
      key: 'idem_jrn_1001_sales',
      operationType: 'CREATE_MERCHANT_PROFILE',
      journeyId: 'jrn_1001',
      status: 'COMMITTED',
      responseReference: 'src_mrc_88412',
      attemptCount: 1,
      createdAt: iso(-320),
      lastAttemptAt: iso(-320),
    },
    {
      key: 'idem_jrn_1002_ops',
      operationType: 'MERCHANT_ACTIVATE',
      journeyId: 'jrn_1002',
      status: 'COMMITTED',
      responseReference: 'act_88409',
      attemptCount: 1,
      createdAt: iso(-896),
      lastAttemptAt: iso(-896),
    },
  ];

  const approvalRequests: ApprovalRequest[] = [
    {
      id: 'apr_1003_risk',
      journeyId: 'jrn_1003',
      merchantName: 'Sahyadri Bullion & Jewels',
      stageId: 'stg_1003_risk',
      stageName: 'RISK_ASSESSMENT',
      reason: 'MCC 5944 (Precious Metals & Jewellery) risk score 78/100 exceeds automated activation threshold (65). Compliance officer review required.',
      riskLevel: 'HIGH',
      requestedAction: 'Approve Risk Clearance & Resume Operations Activation',
      status: 'PENDING',
      requestedBy: 'agent_risk',
      assignedReviewer: 'Compliance Ops Lead',
      reviewedBy: null,
      decisionReason: null,
      createdAt: iso(-175),
      deadlineAt: iso(3600),
      resolvedAt: null,
    },
  ];

  const auditEvents: AuditEvent[] = [];
  let prevHash = GENESIS_HASH;
  const seedAudit = (
    id: string,
    seq: number,
    journeyId: string,
    correlationId: string,
    actorType: AuditEvent['actorType'],
    actorId: string,
    eventType: AuditEvent['eventType'],
    previousState: string,
    newState: string,
    evidenceReference: string | null,
    createdAt: string
  ) => {
    const evt = createAuditEvent({
      id,
      sequence: seq,
      journeyId,
      correlationId,
      actorType,
      actorId,
      eventType,
      previousState,
      newState,
      evidenceReference,
      previousHash: prevHash,
      createdAt,
    });
    prevHash = evt.eventHash;
    auditEvents.push(evt);
  };

  seedAudit('evt_001', 1, 'jrn_1002', 'corr_88409_ok', 'WORKFLOW', 'orchestrator', 'JOURNEY_CREATED', 'NONE', 'RUNNING', null, iso(-940));
  seedAudit('evt_002', 2, 'jrn_1002', 'corr_88409_ok', 'VERIFIER', 'outcome-engine', 'JOURNEY_VERIFIED', 'RUNNING', 'VERIFIED', 'evd_1002_ops', iso(-880));
  seedAudit('evt_003', 3, 'jrn_1001', 'corr_88412_fc', 'WORKFLOW', 'orchestrator', 'JOURNEY_CREATED', 'NONE', 'RUNNING', null, iso(-320));
  seedAudit('evt_004', 4, 'jrn_1001', 'corr_88412_fc', 'AGENT', 'agent_kyc', 'AGENT_COMPLETED', 'RUNNING', 'REPORTED_SUCCESS (KYC_APPROVED)', null, iso(-298));
  seedAudit('evt_005', 5, 'jrn_1001', 'corr_88412_fc', 'VERIFIER', 'outcome-engine', 'OUTCOME_VERIFICATION_FAILED', 'KYC_APPROVED (CLAIM)', 'MISMATCH (SOURCE: KYC_PENDING)', 'evd_1001_kyc', iso(-295));
  seedAudit('evt_006', 6, 'jrn_1001', 'corr_88412_fc', 'WORKFLOW', 'orchestrator', 'WORKFLOW_BLOCKED', 'KYC_VERIFICATION', 'BLOCKED_DOWNSTREAM_OPS', 'evd_1001_kyc', iso(-294));
  seedAudit('evt_007', 7, 'jrn_1003', 'corr_88415_hr', 'WORKFLOW', 'orchestrator', 'JOURNEY_CREATED', 'NONE', 'RUNNING', null, iso(-210));
  seedAudit('evt_008', 8, 'jrn_1003', 'corr_88415_hr', 'AGENT', 'agent_risk', 'APPROVAL_REQUESTED', 'RISK_ASSESSMENT', 'NEEDS_HUMAN', null, iso(-175));

  return {
    journeys,
    stages,
    agents,
    agentRuns,
    validationChecks,
    evidenceRecords,
    idempotencyKeys,
    auditEvents,
    approvalRequests,
    integrations,
    policies: {
      blockOnOutcomeMismatch: true,
      enforceIdempotency: true,
      requireHumanForHighRisk: true,
      maxBackoffRetries: 3,
      baseBackoffMs: 600,
      allowLlmOverride: false,
    },
    authoritative: {
      merchants: {
        'MRC-88412': {
          merchantReference: 'MRC-88412',
          merchantName: 'Kaveri Fresh Foods Pvt Ltd',
          status: 'PROFILE_CREATED',
          updatedAt: iso(-310),
        },
        'MRC-88409': {
          merchantReference: 'MRC-88409',
          merchantName: 'Deccan Mobility Electronics',
          status: 'PROFILE_CREATED',
          updatedAt: iso(-930),
        },
        'MRC-88415': {
          merchantReference: 'MRC-88415',
          merchantName: 'Sahyadri Bullion & Jewels',
          status: 'PROFILE_CREATED',
          updatedAt: iso(-198),
        },
      },
      kyc: {
        'MRC-88412': {
          merchantReference: 'MRC-88412',
          status: 'KYC_PENDING',
          checkCount: 1,
          autoApproveAfterChecks: null,
          updatedAt: iso(-295),
        },
        'MRC-88409': {
          merchantReference: 'MRC-88409',
          status: 'KYC_APPROVED',
          checkCount: 1,
          autoApproveAfterChecks: null,
          updatedAt: iso(-912),
        },
        'MRC-88415': {
          merchantReference: 'MRC-88415',
          status: 'KYC_APPROVED',
          checkCount: 1,
          autoApproveAfterChecks: null,
          updatedAt: iso(-178),
        },
      },
      risk: {
        'MRC-88409': {
          merchantReference: 'MRC-88409',
          status: 'RISK_CLEARED',
          score: 22,
          updatedAt: iso(-898),
        },
        'MRC-88415': {
          merchantReference: 'MRC-88415',
          status: 'RISK_REVIEW_REQUIRED',
          score: 78,
          updatedAt: iso(-175),
        },
      },
      activations: {
        'MRC-88409': {
          merchantReference: 'MRC-88409',
          status: 'ACTIVATED',
          idempotencyKey: 'idem_jrn_1002_ops',
          activationCode: 'ACT-88409',
          updatedAt: iso(-880),
        },
      },
    },
    counters: {
      journeySeq: 1003,
      auditSeq: 8,
    },
  };
}

class PersistentStore {
  private state: StoreState;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private writeInFlight = false;
  private pendingWrite = false;

  constructor() {
    this.state = this.load();
  }

  private load(): StoreState {
    try {
      if (fs.existsSync(STORE_FILE)) {
        const raw = fs.readFileSync(STORE_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as StoreState;
        const seededIntegrations = createSeedIntegrations();
        const existingById = new Map((parsed.integrations ?? []).map((i) => [i.id, i]));
        parsed.integrations = seededIntegrations.map((seedInt) => {
          const existing = existingById.get(seedInt.id);
          return existing
            ? {
                ...seedInt,
                status: existing.status,
                lastCheckedAt: existing.lastCheckedAt,
                latencyMs: existing.latencyMs,
              }
            : seedInt;
        });
        return parsed;
      }
    } catch {
      // Fallback to fresh seed if corrupted
    }
    const seed = createSeedState();
    this.saveSync(seed);
    return seed;
  }

  private serialize(state: StoreState): string {
    return state.journeys.length > 50 ? JSON.stringify(state) : JSON.stringify(state, null, 2);
  }

  private saveSync(state: StoreState): void {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE_FILE, this.serialize(state), 'utf-8');
  }

  private async flushAsync(): Promise<void> {
    if (this.writeInFlight) {
      this.pendingWrite = true;
      return;
    }
    this.writeInFlight = true;
    try {
      await fs.promises.mkdir(DATA_DIR, { recursive: true });
      await fs.promises.writeFile(STORE_FILE, this.serialize(this.state), 'utf-8');
    } catch (err) {
      console.error('[AgentBridge Store] Async persist failed:', err);
    } finally {
      this.writeInFlight = false;
      if (this.pendingWrite) {
        this.pendingWrite = false;
        void this.flushAsync();
      }
    }
  }

  getState(): StoreState {
    return this.state;
  }

  persist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.flushAsync();
    }, 80);
  }

  persistNow(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.saveSync(this.state);
  }

  reset(): StoreState {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.state = createSeedState();
    this.saveSync(this.state);
    return this.state;
  }
}

export const store = new PersistentStore();
