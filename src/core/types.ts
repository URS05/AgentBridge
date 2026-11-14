export type JourneyScenario =
  | 'FALSE_COMPLETION'
  | 'NORMAL'
  | 'API_TIMEOUT'
  | 'DUPLICATE_ATTEMPT'
  | 'DELAYED_CONSISTENCY'
  | 'SOURCE_UNAVAILABLE'
  | 'HUMAN_APPROVAL';

export type StageName = 'SALES_ONBOARDING' | 'KYC_VERIFICATION' | 'RISK_ASSESSMENT' | 'OPERATIONS_ACTIVATION';

export type StageStatus =
  | 'NOT_STARTED'
  | 'RUNNING'
  | 'REPORTED_SUCCESS'
  | 'VERIFYING'
  | 'VERIFIED'
  | 'MISMATCH'
  | 'BLOCKED'
  | 'SOURCE_UNAVAILABLE'
  | 'VERIFICATION_PENDING'
  | 'NEEDS_HUMAN'
  | 'FAILED'
  | 'CANCELLED'
  | 'COMPLETED';

export type JourneyStatus =
  | 'RUNNING'
  | 'BLOCKED'
  | 'VERIFICATION_PENDING'
  | 'NEEDS_HUMAN'
  | 'VERIFIED'
  | 'FAILED'
  | 'CANCELLED';

export type VerificationStatus = 'PENDING' | 'VERIFIED' | 'MISMATCH' | 'UNAVAILABLE' | 'NEEDS_HUMAN' | 'FAILED';

export type ValidationType = 'AI_RESPONSE' | 'EXECUTION' | 'BUSINESS_OUTCOME';
export type ValidationResult = 'PASS' | 'FAIL' | 'MISMATCH' | 'UNAVAILABLE';

export type AuditEventType =
  | 'JOURNEY_CREATED'
  | 'AGENT_STARTED'
  | 'AGENT_COMPLETED'
  | 'AGENT_FAILED'
  | 'EXECUTION_VALIDATED'
  | 'RESPONSE_VALIDATED'
  | 'OUTCOME_VERIFICATION_STARTED'
  | 'OUTCOME_VERIFICATION_PASSED'
  | 'OUTCOME_VERIFICATION_FAILED'
  | 'WORKFLOW_BLOCKED'
  | 'RETRY_SCHEDULED'
  | 'RETRY_EXECUTED'
  | 'DUPLICATE_BLOCKED'
  | 'APPROVAL_REQUESTED'
  | 'APPROVAL_GRANTED'
  | 'APPROVAL_REJECTED'
  | 'SOURCE_SYSTEM_UPDATED'
  | 'JOURNEY_VERIFIED'
  | 'JOURNEY_FAILED'
  | 'JOURNEY_CANCELLED';

export const TEAM_ROSTER = [
  'Priya Nair',
  'Rohan Mehta',
  'Ananya Iyer',
  'Vikram Singh',
  'Kavita Joshi',
  'Arjun Patel',
  'Neha Verma',
] as const;

export type TeamMember = (typeof TEAM_ROSTER)[number];

export interface A2AHandoff {
  id: string;
  journeyId: string;
  sequence: number;
  fromAgent: string;
  toAgent: string;
  stageName: StageName;
  payloadSummary: string;
  passedFields: string[];
  flaggedFields: string[];
  a2aHopMs: number;
  officialVerifyMs: number;
  outcome: 'VERIFIED' | 'MISMATCH' | 'TIMEOUT' | 'ESCALATED' | 'PENDING';
  timestamp: string;
}

export interface Journey {
  id: string;
  externalReference: string;
  merchantName: string;
  journeyType: 'MERCHANT_ONBOARDING';
  scenario: JourneyScenario;
  status: JourneyStatus;
  verificationStatus: VerificationStatus;
  currentStage: StageName;
  environment: 'SIMULATED';
  correlationId: string;
  workflowId: string;
  startedAt: string;
  completedAt: string | null;
  updatedAt: string;
  durationMs: number | null;
  blockedReason: string | null;
  assignedTo?: string | null;
  slaDeadlineAt?: string;
  clusterKey?: string;
  handoffs?: A2AHandoff[];
}

export interface IssueCluster {
  clusterKey: string;
  title: string;
  plainSummary: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  stageName: StageName;
  affectedCount: number;
  oldestStartedAt: string;
  oldestAgeMinutes: number;
  primaryJourneyId: string;
  primaryMerchantName: string;
  primaryExternalReference: string;
  primaryAssignedTo: string | null;
  sampleJourneys: Array<{
    id: string;
    merchantName: string;
    externalReference: string;
    status: JourneyStatus;
    assignedTo: string | null;
    startedAt: string;
  }>;
  actionType: 'CONFIRM_KYC_BULK' | 'OPEN_APPROVALS' | 'RECHECK_BULK' | 'INSPECT_JOURNEY';
  actionLabel: string;
}

export interface LatencyPercentiles {
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  count: number;
}

export interface BatchSimulationConfig {
  count: number;
  mismatchRatePct: number;
  timeoutRatePct: number;
  highRiskRatePct: number;
  spreadHours: number;
}

export interface JourneyStage {
  id: string;
  journeyId: string;
  order: number;
  stageName: StageName;
  label: string;
  agentId: string;
  agentName: string;
  status: StageStatus;
  validationStatus: ValidationResult | 'PENDING';
  expectedState: string;
  actualState: string | null;
  reportedState: string | null;
  retryCount: number;
  maxRetries: number;
  latencyMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  blockedReason: string | null;
}

export interface AgentDefinition {
  id: string;
  name: string;
  type: 'SALES' | 'KYC' | 'RISK' | 'OPERATIONS';
  version: string;
  endpoint: string;
  capabilities: string[];
  permissions: string[];
  health: 'HEALTHY' | 'DEGRADED' | 'OFFLINE';
  description: string;
  lastActiveAt: string | null;
}

export interface AgentRun {
  id: string;
  journeyId: string;
  stageId: string;
  agentId: string;
  requestId: string;
  idempotencyKey: string;
  toolName: string;
  inputSummary: string;
  outputSummary: string;
  reportedStatus: string;
  executionStatus: 'SUCCESS' | 'TIMEOUT' | 'FAILED' | 'BLOCKED';
  latencyMs: number;
  startedAt: string;
  completedAt: string;
}

export interface ValidationCheck {
  id: string;
  journeyId: string;
  stageId: string;
  stageName: StageName;
  validationType: ValidationType;
  checkName: string;
  expectedValue: string;
  actualValue: string;
  result: ValidationResult;
  reason: string;
  evidenceId: string | null;
  checkedAt: string;
}

export interface EvidenceRecord {
  id: string;
  journeyId: string;
  validationId: string;
  sourceSystem: string;
  evidenceType: string;
  referenceId: string;
  payloadHash: string;
  redactedPayload: Record<string, unknown>;
  capturedAt: string;
}

export interface IdempotencyRecord {
  key: string;
  operationType: string;
  journeyId: string;
  status: 'IN_PROGRESS' | 'COMMITTED' | 'BLOCKED_DUPLICATE';
  responseReference: string;
  attemptCount: number;
  createdAt: string;
  lastAttemptAt: string;
}

export interface AuditEvent {
  id: string;
  sequence: number;
  journeyId: string;
  correlationId: string;
  actorType: 'AGENT' | 'VERIFIER' | 'WORKFLOW' | 'HUMAN' | 'SYSTEM';
  actorId: string;
  eventType: AuditEventType;
  previousState: string;
  newState: string;
  evidenceReference: string | null;
  metadata: Record<string, unknown>;
  previousHash: string;
  eventHash: string;
  createdAt: string;
}

export interface ApprovalRequest {
  id: string;
  journeyId: string;
  merchantName: string;
  stageId: string;
  stageName: StageName;
  reason: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  requestedAction: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EVIDENCE_REQUESTED' | 'ESCALATED';
  requestedBy: string;
  assignedReviewer: string;
  reviewedBy: string | null;
  decisionReason: string | null;
  createdAt: string;
  deadlineAt: string;
  resolvedAt: string | null;
}

export type IntegrationCategory =
  | 'PI_RUNTIME'
  | 'AGENT_PROTOCOL'
  | 'TOOL_PROTOCOL'
  | 'SOURCE_SYSTEM'
  | 'AGENT_ENDPOINT'
  | 'OBSERVABILITY';

export type IntegrationProtocol =
  | 'JSONL_RPC'
  | 'TS_SDK'
  | 'A2A_JSON_RPC'
  | 'MCP_HTTP'
  | 'ACP_POLICY'
  | 'REST_HTTPS'
  | 'OTLP_HTTP'
  | 'SSE_STREAM';

export interface SystemIntegration {
  id: string;
  name: string;
  category: IntegrationCategory;
  protocol?: IntegrationProtocol;
  protocolLabel?: string;
  transport?: string;
  pipelineOrder?: 1 | 2 | 3 | 4 | 5;
  details?: string;
  endpoint: string;
  apiVersion: string;
  status: 'HEALTHY' | 'OUTAGE' | 'DEGRADED';
  permissions: string[];
  capabilities: string[];
  lastCheckedAt: string;
  latencyMs: number;
}

export interface DepartmentHealth {
  stageName: StageName;
  departmentName: string;
  roleLabel: string;
  readiness: 'GOOD_TO_GO' | 'ATTENTION_NEEDED' | 'WAITING_UPSTREAM' | 'OFFLINE';
  readinessLabel: string;
  blockedCount: number;
  waitingApprovalCount: number;
  waitingUpstreamCount: number;
  verifiedCount: number;
  gatewayName: string;
  gatewayStatus: 'HEALTHY' | 'OUTAGE' | 'DEGRADED';
  gatewayLatencyMs: number;
  protocolHealthy: boolean;
  summary: string;
  targetPath: string;
}

export interface PolicySettings {
  blockOnOutcomeMismatch: boolean;
  enforceIdempotency: boolean;
  requireHumanForHighRisk: boolean;
  maxBackoffRetries: number;
  baseBackoffMs: number;
  allowLlmOverride: false; // Strictly immutable safety invariant
}

export interface EventEnvelope {
  eventId: string;
  journeyId: string;
  eventType: AuditEventType;
  source: string;
  timestamp: string;
  correlationId: string;
  payload: Record<string, unknown>;
}

export interface OutcomeVerificationInput {
  journeyId: string;
  merchantReference: string;
  expectedState: string;
  operationId: string;
}

export interface OutcomeVerificationResult {
  verified: boolean;
  unavailable?: boolean;
  actualState: string;
  sourceSystem: string;
  evidenceReference: string;
  payloadHash: string;
  redactedPayload: Record<string, unknown>;
  checkedAt: string;
  reason?: string;
}

export interface OutcomeVerifier {
  verify(input: OutcomeVerificationInput): Promise<OutcomeVerificationResult>;
}
