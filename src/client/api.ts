import type {
  A2AHandoff,
  AgentDefinition,
  AgentRun,
  ApprovalRequest,
  AuditEvent,
  BatchSimulationConfig,
  DepartmentHealth,
  EventEnvelope,
  EvidenceRecord,
  IdempotencyRecord,
  IssueCluster,
  Journey,
  JourneyScenario,
  JourneyStage,
  LatencyPercentiles,
  PolicySettings,
  SystemIntegration,
  ValidationCheck,
} from '../core/types';

export interface OverviewResponse {
  environment: 'SIMULATED';
  kpis: {
    activeJourneys: number;
    verifiedJourneys: number;
    blockedJourneys: number;
    pendingVerification: number;
    failedJourneys: number;
    humanEscalations: number;
    totalJourneys: number;
  };
  pulse: {
    needsActionNow: number;
    verifiedToday: number;
    systemsHealthy: number;
    systemsTotal: number;
    systemsOutage: number;
    systemsDegraded: number;
    piProtocolsHealthy: number;
    piProtocolsTotal: number;
    gatewaysHealthy: number;
    gatewaysTotal: number;
  };
  departments: DepartmentHealth[];
  topIssues: IssueCluster[];
  teamLoad: Array<{ name: string; activeCount: number }>;
  teamRoster: string[];
  mismatches: Array<
    ValidationCheck & {
      merchantName: string;
      externalReference: string;
      journeyStatus: string;
      reportedState: string | null;
      evidence: EvidenceRecord | null;
    }
  >;
  recentAuditEvents: AuditEvent[];
  recentRuns: Array<AgentRun & { agentName: string; merchantName: string }>;
  integrations: SystemIntegration[];
  agents: AgentDefinition[];
  journeys: Journey[];
}

export interface JourneyDetailResponse {
  journey: Journey;
  stages: JourneyStage[];
  handoffs: A2AHandoff[];
  agentRuns: AgentRun[];
  validationChecks: ValidationCheck[];
  evidenceRecords: EvidenceRecord[];
  auditEvents: AuditEvent[];
  auditVerification?: {
    valid: boolean;
    totalEvents: number;
    reason: string;
  };
  approvalRequests: ApprovalRequest[];
  idempotencyKeys: IdempotencyRecord[];
  authoritativeState: {
    merchant: { status: string; updatedAt: string } | null;
    kyc: { status: string; checkCount: number; updatedAt: string } | null;
    risk: { status: string; score: number; updatedAt: string } | null;
    activation: { status: string; activationCode: string; idempotencyKey: string; updatedAt: string } | null;
  };
}

export interface TimeSeriesPoint {
  bucketLabel: string;
  timestamp: string;
  total: number;
  verified: number;
  mismatches: number;
  timeoutsOrBlocked: number;
  avgLatencyMs: number;
}

export interface AnalyticsResponse {
  window: '15m' | '1h' | '24h' | '7d';
  metrics: {
    totalJourneys: number;
    allTimeJourneys: number;
    journeyCompletionRate: number;
    verifiedOutcomeRate: number;
    falseCompletionDetections: number;
    duplicateOperationsPrevented: number;
    recoverySuccessRate: number;
    avgVerificationLatencyMs: number;
    avgJourneyDurationMs: number;
    humanEscalationRate: number;
  };
  latencyPercentiles: {
    a2aHop: LatencyPercentiles;
    officialVerify: LatencyPercentiles;
    endToEnd: LatencyPercentiles;
  };
  timeSeries: TimeSeriesPoint[];
  agentBreakdown: Array<{
    agentId: string;
    agentName: string;
    totalRuns: number;
    executionFailures: number;
    outcomeMismatches: number;
    failureRate: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
  }>;
  scenarioBreakdown: Array<{
    scenario: JourneyScenario;
    total: number;
    verified: number;
    blockedOrPending: number;
  }>;
}

export type ChatProvider = 'auto' | 'sarvam' | 'gemini' | 'grounded';
export type ChatLanguage = 'en' | 'hi' | 'hinglish' | 'ta' | 'te';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatReference {
  journeyId: string;
  merchantName: string;
  externalReference: string;
  status: string;
  summary: string;
}

export interface ChatAction {
  label: string;
  path?: string;
  action?: 'OPEN_LAUNCH';
}

export interface ChatResponse {
  reply: string;
  mode: 'sarvam' | 'sarvam-grounded' | 'gemini' | 'grounded-engine';
  language: ChatLanguage;
  references: ChatReference[];
  actions?: ChatAction[];
  suggestedPrompts: string[];
  mutatedStore: boolean;
}

export interface VoiceCapabilities {
  sarvamConfigured: boolean;
  chatModel: string;
  sttModel: string;
  ttsModel: string;
  defaultSpeaker: string;
  supportedLocales: string[];
}

export interface SttResponse {
  available: boolean;
  transcript: string;
  locale: string;
  mode: 'sarvam-stt' | 'browser-speech-recognition';
  reason?: string;
}

export interface TtsResponse {
  available: boolean;
  audioBase64?: string;
  mimeType?: string;
  cleanText: string;
  locale: string;
  mode: 'sarvam-tts' | 'browser-speech-synthesis';
  reason?: string;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  getOverview: () => request<OverviewResponse>('/api/v1/overview'),

  getJourneys: (params?: {
    status?: string;
    scenario?: string;
    verification?: string;
    assignedTo?: string;
    clusterKey?: string;
    q?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const sp = new URLSearchParams();
    if (params?.status) sp.set('status', params.status);
    if (params?.scenario) sp.set('scenario', params.scenario);
    if (params?.verification) sp.set('verification', params.verification);
    if (params?.assignedTo) sp.set('assignedTo', params.assignedTo);
    if (params?.clusterKey) sp.set('clusterKey', params.clusterKey);
    if (params?.q) sp.set('q', params.q);
    if (params?.page) sp.set('page', String(params.page));
    if (params?.pageSize) sp.set('pageSize', String(params.pageSize));
    const qs = sp.toString();
    return request<{
      journeys: Array<Journey & { stages: JourneyStage[] }>;
      total: number;
      page: number;
      pageSize: number;
    }>(`/api/v1/journeys${qs ? `?${qs}` : ''}`);
  },

  startJourney: (body: { merchantName: string; scenario: JourneyScenario }) =>
    request<{ journey: Journey }>('/api/v1/journeys', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getJourneyDetail: (id: string) => request<JourneyDetailResponse>(`/api/v1/journeys/${encodeURIComponent(id)}`),

  assignJourneyOwner: (id: string, owner: string | null) =>
    request<{ journey: Journey }>(`/api/v1/journeys/${encodeURIComponent(id)}/assign`, {
      method: 'POST',
      body: JSON.stringify({ owner }),
    }),

  assignClusterOwner: (clusterKey: string, owner: string | null) =>
    request<{ ok: boolean; updatedCount: number }>('/api/v1/issues/assign', {
      method: 'POST',
      body: JSON.stringify({ clusterKey, owner }),
    }),

  bulkResolveCluster: (body: { clusterKey?: string; approveKycFirst?: boolean }) =>
    request<{ updatedCount: number; verifiedCount: number }>('/api/v1/issues/bulk-resolve', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  simulateBatch: (config: BatchSimulationConfig) =>
    request<{
      createdCount: number;
      summary: { verified: number; mismatches: number; timeouts: number; highRisk: number };
      elapsedMs: number;
    }>('/api/v1/simulator/batch', {
      method: 'POST',
      body: JSON.stringify(config),
    }),

  recheckJourney: (id: string) =>
    request<{ journey: Journey }>(`/api/v1/journeys/${encodeURIComponent(id)}/recheck`, { method: 'POST' }),

  approveSourceKyc: (id: string) =>
    request<{ journey: Journey }>(`/api/v1/journeys/${encodeURIComponent(id)}/approve-source-kyc`, {
      method: 'POST',
    }),

  simulateDuplicate: (id: string) =>
    request<{ blocked: boolean; message: string }>(`/api/v1/journeys/${encodeURIComponent(id)}/simulate-duplicate`, {
      method: 'POST',
    }),

  cancelJourney: (id: string) =>
    request<{ journey: Journey }>(`/api/v1/journeys/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),

  getValidations: (params?: { type?: string; result?: string }) => {
    const sp = new URLSearchParams();
    if (params?.type) sp.set('type', params.type);
    if (params?.result) sp.set('result', params.result);
    const qs = sp.toString();
    return request<{
      checks: Array<
        ValidationCheck & {
          merchantName: string;
          externalReference: string;
          reportedState: string | null;
          evidence: EvidenceRecord | null;
        }
      >;
      totalChecks?: number;
      idempotencyKeys: IdempotencyRecord[];
    }>(`/api/v1/validations${qs ? `?${qs}` : ''}`);
  },

  getAgents: () =>
    request<{
      agents: Array<
        AgentDefinition & {
          totalRuns: number;
          failureRate: number;
          avgLatencyMs: number;
          recentRuns: AgentRun[];
        }
      >;
    }>('/api/v1/agents'),

  getApprovals: () =>
    request<{ approvals: ApprovalRequest[]; totalApprovals?: number; pendingCount?: number }>('/api/v1/approvals'),

  decideApproval: (
    id: string,
    body: { decision: 'APPROVED' | 'REJECTED' | 'EVIDENCE_REQUESTED' | 'ESCALATED'; reviewer: string; reason: string }
  ) =>
    request<{ approval: ApprovalRequest }>(`/api/v1/approvals/${encodeURIComponent(id)}/decide`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getAnalytics: (window: '15m' | '1h' | '24h' | '7d' = '24h') =>
    request<AnalyticsResponse>(`/api/v1/analytics?window=${window}`),

  getAuditLogs: (params?: { eventType?: string; q?: string }) => {
    const sp = new URLSearchParams();
    if (params?.eventType) sp.set('eventType', params.eventType);
    if (params?.q) sp.set('q', params.q);
    const qs = sp.toString();
    return request<{ events: AuditEvent[]; totalEvents?: number }>(`/api/v1/audit${qs ? `?${qs}` : ''}`);
  },

  verifyAuditChain: () =>
    request<{
      valid: boolean;
      totalEvents: number;
      brokenAtEventId: string | null;
      brokenSequence: number | null;
      reason: string;
    }>('/api/v1/audit/verify'),

  getIntegrations: () => request<{ integrations: SystemIntegration[] }>('/api/v1/integrations'),

  probeIntegrations: () =>
    request<{ integrations: SystemIntegration[]; healthyCount: number; totalCount: number }>('/api/v1/integrations/probe', {
      method: 'POST',
    }),

  toggleIntegrationStatus: (id: string) =>
    request<{ integration: SystemIntegration }>(`/api/v1/integrations/${encodeURIComponent(id)}/toggle-status`, {
      method: 'POST',
    }),

  getSettings: () => request<{ policies: PolicySettings; environment: 'SIMULATED' }>('/api/v1/settings'),

  updatePolicies: (policies: Omit<PolicySettings, 'allowLlmOverride'>) =>
    request<{ policies: PolicySettings }>('/api/v1/settings/policies', {
      method: 'PUT',
      body: JSON.stringify(policies),
    }),

  resetDemo: () => request<{ ok: boolean }>('/api/v1/demo/reset', { method: 'POST' }),

  chat: (body: {
    message: string;
    journeyId?: string;
    provider?: ChatProvider;
    language?: ChatLanguage;
    currentPath?: string;
    history?: ChatTurn[];
  }) =>
    request<ChatResponse>('/api/v1/chat', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getVoiceCapabilities: () => request<VoiceCapabilities>('/api/v1/voice/capabilities'),

  speechToText: (body: { audioBase64: string; mimeType?: string; language?: ChatLanguage }) =>
    request<SttResponse>('/api/v1/voice/stt', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  textToSpeech: (body: { text: string; language?: ChatLanguage; speaker?: string }) =>
    request<TtsResponse>('/api/v1/voice/tts', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

export function subscribeWorkflowEvents(onEvent: (evt: EventEnvelope) => void): () => void {
  const es = new EventSource('/api/v1/events/stream');
  es.addEventListener('workflow_event', (msg) => {
    try {
      const parsed = JSON.parse((msg as MessageEvent).data) as EventEnvelope;
      onEvent(parsed);
    } catch {
      // Ignore malformed SSE payload
    }
  });
  return () => es.close();
}

export const SCENARIO_META: Record<
  JourneyScenario,
  { label: string; shortLabel: string; description: string }
> = {
  FALSE_COMPLETION: {
    label: 'False Completion (KYC Mismatch)',
    shortLabel: 'False Completion',
    description: 'KYC Agent reports APPROVED while Authoritative KYC API remains PENDING. Downstream Ops is blocked until verified.',
  },
  NORMAL: {
    label: 'Standard Verified Onboarding',
    shortLabel: 'Standard Verified',
    description: 'All four agents execute cleanly and every authoritative source gate passes on first verification.',
  },
  API_TIMEOUT: {
    label: 'API Timeout After Committed Side-Effect',
    shortLabel: 'API Timeout',
    description: 'Sales API response times out after commit; AgentBridge queries authoritative state instead of duplicating.',
  },
  DUPLICATE_ATTEMPT: {
    label: 'Duplicate Activation Guard',
    shortLabel: 'Duplicate Guard',
    description: 'Completes onboarding and tests a duplicate activation attempt, blocked deterministically by idempotency key.',
  },
  DELAYED_CONSISTENCY: {
    label: 'Delayed Eventual Consistency',
    shortLabel: 'Delayed Consistency',
    description: 'Authoritative KYC takes 3 verification checks to converge; bounded exponential backoff recovers automatically.',
  },
  SOURCE_UNAVAILABLE: {
    label: 'Source System Outage (503)',
    shortLabel: 'Source Outage',
    description: 'Authoritative KYC API returns 503; journey enters VERIFICATION_PENDING instead of failing falsely.',
  },
  HUMAN_APPROVAL: {
    label: 'Human Compliance Escalation',
    shortLabel: 'Human Escalation',
    description: 'Risk Agent flags high-value MCC and pauses workflow at NEEDS_HUMAN until reviewer decides in Approval Queue.',
  },
};
