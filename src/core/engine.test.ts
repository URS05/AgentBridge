import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAgentResponse,
  validateToolExecution,
  evaluateBusinessOutcome,
} from './validation';
import {
  canTransitionStage,
  transitionStageStatus,
  calculateBackoffDelayMs,
  deriveJourneyStatus,
} from './stateMachine';
import { GENESIS_HASH, createAuditEvent, verifyAuditChain, verifyJourneyAuditChain } from './audit';
import { buildTimeSeriesBuckets, computePercentiles, groupJourneysIntoTopIssues } from './clustering';
import type { AgentDefinition, IdempotencyRecord, Journey } from './types';

const sampleAgent: AgentDefinition = {
  id: 'agent_kyc',
  name: 'KYC Agent',
  type: 'KYC',
  version: '1.4.0',
  endpoint: 'sim://agents/kyc',
  capabilities: ['submit_kyc_application', 'fetch_kyc_status'],
  permissions: ['kyc:submit', 'kyc:read'],
  health: 'HEALTHY',
  description: 'Submits KYC verification requests.',
  lastActiveAt: null,
};

test('Level 1: validateAgentResponse passes valid schema and rejects missing fields', () => {
  const ok = validateAgentResponse(
    {
      agentId: 'agent_kyc',
      requestId: 'req_101',
      merchantReference: 'MRC-9001',
      reportedStatus: 'KYC_APPROVED',
      referenceId: 'kyc_ref_101',
      summary: 'KYC documents submitted and approved.',
      confidence: 0.94,
      timestamp: '2026-11-14T10:00:00Z',
    },
    'agent_kyc'
  );
  assert.equal(ok.result, 'PASS');

  const bad = validateAgentResponse({ agentId: 'agent_kyc' }, 'agent_kyc');
  assert.equal(bad.result, 'FAIL');
});

test('Level 2: validateToolExecution enforces permissions and blocks duplicate idempotency keys', () => {
  const denied = validateToolExecution({
    agent: sampleAgent,
    toolName: 'submit_kyc_application',
    requiredPermission: 'merchant:activate',
    requestId: 'req_102',
    idempotencyKey: 'idem_102',
    operationType: 'KYC_SUBMIT',
  });
  assert.equal(denied.result, 'FAIL');
  assert.equal(denied.isDuplicate, false);

  const existing: IdempotencyRecord = {
    key: 'idem_dup_1',
    operationType: 'MERCHANT_ACTIVATE',
    journeyId: 'jrn_1',
    status: 'COMMITTED',
    responseReference: 'act_99',
    attemptCount: 1,
    createdAt: '2026-11-14T10:00:00Z',
    lastAttemptAt: '2026-11-14T10:00:00Z',
  };

  const duplicate = validateToolExecution({
    agent: sampleAgent,
    toolName: 'submit_kyc_application',
    requiredPermission: 'kyc:submit',
    requestId: 'req_103',
    idempotencyKey: 'idem_dup_1',
    operationType: 'MERCHANT_ACTIVATE',
    existingIdempotency: existing,
  });
  assert.equal(duplicate.result, 'FAIL');
  assert.equal(duplicate.isDuplicate, true);
});

test('Level 3: evaluateBusinessOutcome blocks mismatch even when agent reported success', () => {
  const mismatch = evaluateBusinessOutcome('KYC_APPROVED', {
    verified: false,
    actualState: 'KYC_PENDING',
    sourceSystem: 'Authoritative KYC API',
    evidenceReference: 'evd_001',
    payloadHash: 'abc123',
    redactedPayload: { status: 'KYC_PENDING' },
    checkedAt: '2026-11-14T10:01:00Z',
  });
  assert.equal(mismatch.result, 'MISMATCH');
  assert.equal(mismatch.canProceed, false);

  const unavailable = evaluateBusinessOutcome('KYC_APPROVED', {
    verified: false,
    unavailable: true,
    actualState: 'SOURCE_503_UNAVAILABLE',
    sourceSystem: 'Authoritative KYC API',
    evidenceReference: 'evd_002',
    payloadHash: 'abc124',
    redactedPayload: { error: '503' },
    checkedAt: '2026-11-14T10:01:30Z',
  });
  assert.equal(unavailable.result, 'UNAVAILABLE');
  assert.equal(unavailable.canProceed, false);

  const verified = evaluateBusinessOutcome('KYC_APPROVED', {
    verified: true,
    actualState: 'KYC_APPROVED',
    sourceSystem: 'Authoritative KYC API',
    evidenceReference: 'evd_003',
    payloadHash: 'abc125',
    redactedPayload: { status: 'KYC_APPROVED' },
    checkedAt: '2026-11-14T10:02:00Z',
  });
  assert.equal(verified.result, 'PASS');
  assert.equal(verified.canProceed, true);
});

test('State machine enforces transitions, backoff, and journey derivation', () => {
  assert.equal(canTransitionStage('NOT_STARTED', 'RUNNING'), true);
  assert.equal(canTransitionStage('NOT_STARTED', 'COMPLETED'), false);
  assert.throws(() => transitionStageStatus('NOT_STARTED', 'COMPLETED'));

  assert.equal(calculateBackoffDelayMs(0, 500, 10000), 500);
  assert.equal(calculateBackoffDelayMs(2, 500, 10000), 2000);
  assert.equal(calculateBackoffDelayMs(10, 500, 10000), 10000);

  assert.equal(
    deriveJourneyStatus([{ status: 'VERIFIED' }, { status: 'BLOCKED' }, { status: 'NOT_STARTED' }]),
    'BLOCKED'
  );
  assert.equal(
    deriveJourneyStatus([{ status: 'VERIFIED' }, { status: 'VERIFIED' }]),
    'VERIFIED'
  );
});

test('Audit hash chain verifies intact chain, per-journey slice, and detects tampering', () => {
  const e1 = createAuditEvent({
    id: 'evt_1',
    sequence: 1,
    journeyId: 'jrn_1',
    correlationId: 'corr_1',
    actorType: 'WORKFLOW',
    actorId: 'orchestrator',
    eventType: 'JOURNEY_CREATED',
    previousState: 'NONE',
    newState: 'RUNNING',
    previousHash: GENESIS_HASH,
  });

  const e2 = createAuditEvent({
    id: 'evt_2',
    sequence: 2,
    journeyId: 'jrn_1',
    correlationId: 'corr_1',
    actorType: 'VERIFIER',
    actorId: 'outcome-engine',
    eventType: 'OUTCOME_VERIFICATION_FAILED',
    previousState: 'KYC_APPROVED (CLAIM)',
    newState: 'BLOCKED (SOURCE: KYC_PENDING)',
    previousHash: e1.eventHash,
  });

  assert.equal(verifyAuditChain([e1, e2]).valid, true);
  assert.equal(verifyJourneyAuditChain([e1, e2], 'jrn_1').valid, true);

  const tampered = { ...e2, newState: 'VERIFIED' };
  const check = verifyAuditChain([e1, tampered]);
  assert.equal(check.valid, false);
  assert.equal(check.brokenAtEventId, 'evt_2');

  const journeyCheck = verifyJourneyAuditChain([e1, tampered], 'jrn_1');
  assert.equal(journeyCheck.valid, false);
});

test('Clustering, percentile math, and time-series bucketing summarize high-volume issues accurately', () => {
  const now = Date.now();
  const mkJourney = (id: string, status: Journey['status'], scenario: Journey['scenario'], ageMin: number): Journey => ({
    id,
    externalReference: `MRC-${id}`,
    merchantName: `Merchant ${id}`,
    journeyType: 'MERCHANT_ONBOARDING',
    scenario,
    status,
    verificationStatus: status === 'VERIFIED' ? 'VERIFIED' : status === 'BLOCKED' ? 'MISMATCH' : 'NEEDS_HUMAN',
    currentStage: status === 'BLOCKED' ? 'KYC_VERIFICATION' : status === 'NEEDS_HUMAN' ? 'RISK_ASSESSMENT' : 'OPERATIONS_ACTIVATION',
    environment: 'SIMULATED',
    correlationId: `corr_${id}`,
    workflowId: `wf_${id}`,
    startedAt: new Date(now - ageMin * 60000).toISOString(),
    completedAt: status === 'VERIFIED' ? new Date(now).toISOString() : null,
    updatedAt: new Date(now).toISOString(),
    durationMs: status === 'VERIFIED' ? 1200 : null,
    blockedReason: null,
    assignedTo: 'Priya Nair',
  });

  const journeys: Journey[] = [
    mkJourney('1', 'BLOCKED', 'FALSE_COMPLETION', 90),
    mkJourney('2', 'BLOCKED', 'FALSE_COMPLETION', 30),
    mkJourney('3', 'NEEDS_HUMAN', 'HUMAN_APPROVAL', 45),
    mkJourney('4', 'VERIFIED', 'NORMAL', 15),
  ];

  const clusters = groupJourneysIntoTopIssues(journeys, [], [], now, 5);
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].clusterKey, 'KYC_PREMATURE_CLAIM');
  assert.equal(clusters[0].affectedCount, 2);
  assert.equal(clusters[0].oldestAgeMinutes, 90);
  assert.equal(clusters[1].clusterKey, 'HIGH_RISK_COMPLIANCE_APPROVAL');

  const pct = computePercentiles([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  assert.equal(pct.p50, 50);
  assert.equal(pct.p95, 100);
  assert.equal(pct.avg, 55);
  assert.equal(pct.count, 10);

  const series = buildTimeSeriesBuckets(journeys, '24h', now);
  assert.equal(series.length, 12);
  assert.equal(series.reduce((acc, b) => acc + b.total, 0), 4);
});
