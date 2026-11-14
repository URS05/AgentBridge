import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { store } from './store';
import {
  approveSourceKycAndResume,
  assignClusterOwner,
  bulkResolveCluster,
  decideApprovalRequest,
  probeProtocolConnections,
  runA2ABatchSimulation,
  simulateDuplicateActivation,
  startNewJourney,
} from './workflowEngine';
import { verifyAuditChain } from '../core/audit';
import { handleChatRequest } from './chatAssistant';
import {
  getSarvamLocale,
  getVoiceCapabilities,
  sanitizeTextForSpeech,
  synthesizeSpeechWithSarvam,
  transcribeAudioWithSarvam,
} from './sarvamVoice';

after(() => {
  store.reset();
});

test('End-to-end FALSE_COMPLETION scenario blocks downstream Ops and resumes when Authoritative KYC approves', async () => {
  store.reset();
  const journey = await startNewJourney({
    merchantName: 'Test Merchant False Complete',
    scenario: 'FALSE_COMPLETION',
  });

  const stateBefore = store.getState();
  const jBefore = stateBefore.journeys.find((j) => j.id === journey.id)!;
  assert.equal(jBefore.status, 'BLOCKED');
  assert.equal(jBefore.verificationStatus, 'MISMATCH');

  const opsStageBefore = stateBefore.stages.find(
    (s) => s.journeyId === journey.id && s.stageName === 'OPERATIONS_ACTIVATION'
  )!;
  assert.equal(opsStageBefore.status, 'NOT_STARTED');

  const resumed = await approveSourceKycAndResume(journey.id);
  assert.equal(resumed.status, 'VERIFIED');
  assert.equal(resumed.verificationStatus, 'VERIFIED');

  const opsStageAfter = store.getState().stages.find(
    (s) => s.journeyId === journey.id && s.stageName === 'OPERATIONS_ACTIVATION'
  )!;
  assert.equal(opsStageAfter.status, 'VERIFIED');

  // Verify duplicate activation is caught by idempotency guard
  const dup = await simulateDuplicateActivation(journey.id);
  assert.equal(dup.blocked, true);

  // Verify audit chain stays intact
  const chainCheck = verifyAuditChain(store.getState().auditEvents);
  assert.equal(chainCheck.valid, true);
});

test('End-to-end HUMAN_APPROVAL pauses at Risk and resumes cleanly upon Compliance Approval', async () => {
  store.reset();
  const journey = await startNewJourney({
    merchantName: 'Test Merchant High Risk',
    scenario: 'HUMAN_APPROVAL',
  });

  const state = store.getState();
  assert.equal(journey.status, 'NEEDS_HUMAN');
  const pendingApproval = state.approvalRequests.find((a) => a.journeyId === journey.id && a.status === 'PENDING');
  assert.ok(pendingApproval);

  await decideApprovalRequest({
    approvalId: pendingApproval.id,
    decision: 'APPROVED',
    reviewer: 'Lead Compliance Officer',
    reason: 'Verified physical store registration and GST filings.',
  });

  const updatedJourney = store.getState().journeys.find((j) => j.id === journey.id)!;
  assert.equal(updatedJourney.status, 'VERIFIED');
});

test('Chat assistant answers grounded status checks, runs demo scenarios, and verifies audit chain', async () => {
  store.reset();

  const statusReply = await handleChatRequest({ message: 'Why is Kaveri Fresh Foods paused?' });
  assert.equal(statusReply.references[0]?.journeyId, 'jrn_1001');
  assert.match(statusReply.reply, /Kaveri Fresh Foods/i);

  const auditReply = await handleChatRequest({ message: 'Verify audit trail integrity' });
  assert.match(auditReply.reply, /Integrity Confirmed/i);

  const demoReply = await handleChatRequest({ message: 'Run a premature AI approval demo' });
  assert.equal(demoReply.mutatedStore, true);
  assert.equal(demoReply.references[0]?.status, 'BLOCKED');
});

test('High-volume A2A batch simulation, cluster owner assignment, and bulk resolution stay fast and hash-chain valid', async () => {
  store.reset();
  const sim = runA2ABatchSimulation({
    count: 500,
    mismatchRatePct: 16,
    timeoutRatePct: 8,
    highRiskRatePct: 8,
    spreadHours: 24,
  });

  assert.equal(sim.createdCount, 500);
  assert.ok(sim.summary.mismatches > 10);
  assert.ok(store.getState().journeys.length >= 503);

  // Assign entire KYC premature claim cluster to Kavita Joshi
  const assignedCount = assignClusterOwner('KYC_PREMATURE_CLAIM', 'Kavita Joshi');
  assert.ok(assignedCount >= sim.summary.mismatches);

  // Bulk confirm KYC & resume for the KYC cluster
  const bulkRes = await bulkResolveCluster({
    clusterKey: 'KYC_PREMATURE_CLAIM',
    approveKycFirst: true,
  });
  assert.equal(bulkRes.updatedCount, assignedCount);
  assert.equal(bulkRes.verifiedCount, assignedCount);

  // Audit hash chain remains 100% intact across 500+ synthetic journeys
  const chainCheck = verifyAuditChain(store.getState().auditEvents);
  assert.equal(chainCheck.valid, true);

  // Top issues query works cleanly under volume
  const topReply = await handleChatRequest({ message: 'What are the top issues right now?' });
  assert.match(topReply.reply, /issue cluster/i);
});

test('Pi protocol stack (RPC, SDK, A2A, MCP, ACP) probes cleanly and pauses workflows safely on protocol outage', async () => {
  store.reset();
  const probed = probeProtocolConnections();
  assert.equal(probed.totalCount, 10);
  assert.equal(probed.healthyCount, 10);

  // Toggling ACP Policy Gate offline must fail-closed and block onboarding safely
  const acp = store.getState().integrations.find((i) => i.id === 'int_acp_gate')!;
  acp.status = 'OUTAGE';
  const blockedJourney = await startNewJourney({
    merchantName: 'Protocol Fail-Closed Merchant',
    scenario: 'NORMAL',
  });
  assert.equal(blockedJourney.status, 'BLOCKED');
  assert.match(blockedJourney.blockedReason ?? '', /ACP Guardrail Policy Gate/i);

  // Restore ACP and verify MCP adapter outage pauses safely in VERIFICATION_PENDING
  acp.status = 'HEALTHY';
  const mcp = store.getState().integrations.find((i) => i.id === 'int_mcp_server')!;
  mcp.status = 'OUTAGE';
  const heldJourney = await startNewJourney({
    merchantName: 'MCP Hold Merchant',
    scenario: 'NORMAL',
  });
  assert.equal(heldJourney.status, 'VERIFICATION_PENDING');
  assert.match(heldJourney.blockedReason ?? '', /Pi-MCP Tool Adapter/i);

  // Audit chain stays valid
  const chainCheck = verifyAuditChain(store.getState().auditEvents);
  assert.equal(chainCheck.valid, true);
});

test('Paytm Bot supports Sarvam provider mode, current-screen navigation explainers, and Hinglish replies', async () => {
  store.reset();

  const navReply = await handleChatRequest({
    message: 'Explain how this dashboard works and help me navigate',
    provider: 'sarvam',
    language: 'hinglish',
    currentPath: '/dashboard',
  });
  assert.equal(navReply.mode, 'sarvam-grounded');
  assert.equal(navReply.language, 'hinglish');
  assert.match(navReply.reply, /Department cards/i);
  assert.ok((navReply.actions ?? []).some((a) => a.action === 'OPEN_LAUNCH'));
  assert.ok((navReply.actions ?? []).some((a) => a.path === '/approvals'));

  const sysReply = await handleChatRequest({
    message: 'Explain this screen',
    provider: 'sarvam',
    language: 'en',
    currentPath: '/integrations',
  });
  assert.match(sysReply.reply, /Pi Agent Runtime/i);
  assert.ok((sysReply.actions ?? []).some((a) => a.path === '/integrations'));
});

test('Sarvam Voice STT/TTS maps Indian locales, cleans speech text, and falls back gracefully without SARVAM_API_KEY', async () => {
  assert.equal(getSarvamLocale('en'), 'en-IN');
  assert.equal(getSarvamLocale('hinglish'), 'hi-IN');
  assert.equal(getSarvamLocale('hi'), 'hi-IN');
  assert.equal(getSarvamLocale('ta'), 'ta-IN');
  assert.equal(getSarvamLocale('te'), 'te-IN');

  const cleaned = sanitizeTextForSpeech('**Kaveri Fresh Foods** `KYC_PENDING` • paused safely.');
  assert.equal(cleaned, 'Kaveri Fresh Foods KYC PENDING paused safely.');

  const caps = getVoiceCapabilities();
  assert.equal(caps.sttModel, 'saaras:v3');
  assert.equal(caps.ttsModel, 'bulbul:v3');

  const prevKey = process.env.SARVAM_API_KEY;
  delete process.env.SARVAM_API_KEY;
  try {
    const stt = await transcribeAudioWithSarvam({
      audioBase64: 'AAAA',
      mimeType: 'audio/webm',
      language: 'hinglish',
    });
    assert.equal(stt.available, false);
    assert.equal(stt.mode, 'browser-speech-recognition');
    assert.equal(stt.locale, 'hi-IN');

    const tts = await synthesizeSpeechWithSarvam({
      text: 'Hello manager, Kaveri Fresh Foods is paused.',
      language: 'en',
    });
    assert.equal(tts.available, false);
    assert.equal(tts.mode, 'browser-speech-synthesis');
    assert.equal(tts.locale, 'en-IN');
    assert.match(tts.cleanText, /Kaveri Fresh Foods/);
  } finally {
    if (prevKey !== undefined) process.env.SARVAM_API_KEY = prevKey;
  }
});



