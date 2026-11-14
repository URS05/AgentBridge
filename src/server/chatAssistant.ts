import { GoogleGenAI } from '@google/genai';
import { verifyAuditChain } from '../core/audit';
import { computePercentiles, groupJourneysIntoTopIssues } from '../core/clustering';
import { TEAM_ROSTER } from '../core/types';
import { HUMAN_SCENARIO_LABELS, HUMAN_STAGE_LABELS, HUMAN_STATE_VALUES, HUMAN_STATUS_LABELS } from '../client/humanCopy';
import { store } from './store';
import {
  approveSourceKycAndResume,
  assignJourneyOwner,
  bulkResolveCluster,
  recheckAndResumeJourney,
  runA2ABatchSimulation,
  startNewJourney,
} from './workflowEngine';

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

export interface ChatReply {
  reply: string;
  mode: 'sarvam' | 'sarvam-grounded' | 'gemini' | 'grounded-engine';
  language: ChatLanguage;
  references: ChatReference[];
  actions?: ChatAction[];
  suggestedPrompts: string[];
  mutatedStore: boolean;
}

function humanStatus(status: string): string {
  return HUMAN_STATUS_LABELS[status] ?? status.replace(/_/g, ' ');
}

function humanState(val: string | null | undefined): string {
  if (!val) return 'Not Checked Yet';
  return HUMAN_STATE_VALUES[val] ?? val.replace(/_/g, ' ');
}

const LANGUAGE_INSTRUCTIONS: Record<ChatLanguage, string> = {
  en: 'Respond in clear, simple English for a non-technical Paytm operations manager.',
  hinglish: 'Respond in natural conversational Hinglish (Hindi written in Latin script mixed with clear English business terms like KYC, Approvals, Dashboard).',
  hi: 'Respond in clear, natural Hindi (Devanagari script) using simple operational wording while keeping merchant names and screen titles easy to recognize.',
  ta: 'Respond in clear, natural Tamil while keeping screen names and merchant names readable.',
  te: 'Respond in clear, natural Telugu while keeping screen names and merchant names readable.',
};

const SCREEN_EXPLAINERS: Array<{
  match: (q: string, path?: string) => boolean;
  path: string;
  title: string;
  en: string;
  hinglish: string;
  hi: string;
  actions: ChatAction[];
  prompts: string[];
}> = [
  {
    match: (q, p) =>
      q.includes('connected system') ||
      q.includes('integration') ||
      q.includes('protocol') ||
      q.includes('rpc') ||
      q.includes('mcp') ||
      q.includes('acp') ||
      (q.includes('this screen') && p === '/integrations'),
    path: '/integrations',
    title: 'Connected Systems & Pi Agent Protocols',
    en:
      'Connected Systems shows the 5-hop live chain behind every merchant onboarding:\n' +
      '1. Pi Agent Runtime (Native JSONL RPC + TS SDK) runs the AI worker turns.\n' +
      '2. A2A & MCP Bus handles agent-to-agent handoffs and merchant PAN/GST tool calls.\n' +
      '3. ACP Policy Gate enforces fail-closed rules and duplicate-activation locks before any tool executes.\n' +
      '4. Official Bank Ledgers (Merchant, Bank KYC, Risk Engine, Activation APIs) verify real outcomes independently.\n' +
      '5. Telemetry & Audit Stream records spans and SHA-256 hash-chained events.\n\n' +
      'You can click "Simulate Outage" on any protocol or API to watch AgentBridge pause cases safely instead of letting bad data go live.',
    hinglish:
      'Connected Systems screen pe poori 5-step pipeline dikhti hai: Pi Agent Runtime (RPC + SDK), A2A & MCP Bus, ACP Policy Gate, 4 Official Bank APIs, aur Telemetry/Audit chain.\n' +
      'Agar aap kisi bhi protocol ya Bank API pe "Simulate Outage" dabate hain, to AgentBridge onboarding ko safely pause kar deta hai taaki galat account activate na ho.',
    hi:
      'Connected Systems स्क्रीन पर हर मर्चेंट ऑनबोर्डिंग की 5-चरणीय पाइपलाइन दिखती है: Pi Agent Runtime, A2A & MCP Bus, ACP Policy Gate, 4 आधिकारिक बैंक API, और Telemetry व SHA-256 ऑडिट चेन। आप किसी भी लिंक पर "Simulate Outage" दबाकर देख सकते हैं कि सिस्टम बिना गलत डेटा के केस को कैसे सुरक्षित रोकता है।',
    actions: [
      { label: 'Open Connected Systems', path: '/integrations' },
      { label: 'Back to Dashboard', path: '/dashboard' },
    ],
    prompts: ['What are the top issues right now?', 'Explain the Dashboard screen', 'Verify audit trail integrity'],
  },
  {
    match: (q, p) =>
      q.includes('approval') ||
      q.includes('sign-off') ||
      q.includes('sign off') ||
      (q.includes('this screen') && p === '/approvals'),
    path: '/approvals',
    title: 'Manager Approvals Queue',
    en:
      'Approvals is where high-risk merchant categories (for example, bullion or elevated MCC scores) wait for a human compliance sign-off.\n' +
      'An AI agent can recommend next steps, but under AgentBridge policy it can never override a high-risk hold. When a manager clicks Approve or Reject, onboarding automatically resumes or closes with a signed SHA-256 audit entry.',
    hinglish:
      'Approvals screen pe woh high-risk merchants aate hain jahan manager ka final sign-off zaroori hota hai. AI khud approval nahi de sakta — manager Approve ya Reject karta hai, uske baad onboarding safely resume hota hai.',
    hi:
      'Approvals स्क्रीन पर हाई-रिस्क मर्चेंट केस मैनेजर के अंतिम निर्णय के लिए रुकते हैं। AI एजेंट नीति के अनुसार इन्हें खुद मंज़ूर नहीं कर सकता। मैनेजर के Approve या Reject करते ही आगे की प्रक्रिया अपने-आप पूरी होती है।',
    actions: [
      { label: 'Open Approvals Queue', path: '/approvals' },
      { label: 'Open Dashboard', path: '/dashboard' },
    ],
    prompts: ['Which merchants need manager approval?', 'Start Onboarding Demo', 'Explain All Merchants screen'],
  },
  {
    match: (q, p) =>
      q.includes('analytic') ||
      q.includes('study') ||
      q.includes('latency') ||
      q.includes('percentile') ||
      (q.includes('this screen') && p === '/analytics'),
    path: '/analytics',
    title: 'A2A Analytics & Study Lab',
    en:
      'A2A Analytics & Study lets you benchmark how reliable agent-to-agent handoffs are under scale (500 to 2,000+ simulated merchants). It tracks completion rate, false-completion catch rate, duplicate operations prevented, and P50 / P95 / P99 verification latency.',
    hinglish:
      'A2A Analytics screen pe aap 500 se 2,000+ merchants ke volume pe P50/P95/P99 latency, mismatch catch rate aur recovery rate study kar sakte hain.',
    hi:
      'A2A Analytics स्क्रीन पर आप बड़े पैमाने (500 से 2,000+ मर्चेंट) पर एजेंट हैंडऑफ़ की रफ़्तार, P50/P95/P99 लेटेंसी और मिसमैच रोकने की दर का अध्ययन कर सकते हैं।',
    actions: [
      { label: 'Open A2A Analytics', path: '/analytics' },
      { label: 'Start Onboarding / Batch Demo', action: 'OPEN_LAUNCH' },
    ],
    prompts: ['Simulate 1000 A2A cases', 'What are the top issues right now?', 'Explain Connected Systems'],
  },
  {
    match: (q, p) =>
      q.includes('all merchant') ||
      q.includes('journey') ||
      (q.includes('this screen') && (p === '/journeys' || (p ?? '').startsWith('/journeys/'))),
    path: '/journeys',
    title: 'All Merchants & Case Inspector',
    en:
      'All Merchants lists every merchant onboarding case with filters by status, owner (across your 7-person team), or root-cause cluster. Clicking any merchant opens its 4-stage flow graph where you can compare "What AI Claimed" side-by-side with "Official Bank Record" and run a safe re-check or KYC confirmation.',
    hinglish:
      'All Merchants mein har merchant ka live case dikhta hai — aap owner, status ya issue cluster se filter kar sakte hain. Kisi bhi merchant pe click karke "AI Claim vs Official Bank Record" side-by-side dekh sakte hain.',
    hi:
      'All Merchants स्क्रीन पर हर मर्चेंट की ऑनबोर्डिंग स्थिति, टीम ओनर और क्लस्टर फ़िल्टर दिखते हैं। किसी भी मर्चेंट को खोलकर आप AI के दावे और आधिकारिक बैंक रिकॉर्ड की सीधी तुलना देख सकते हैं।',
    actions: [
      { label: 'Open All Merchants', path: '/journeys' },
      { label: 'Open Dashboard', path: '/dashboard' },
    ],
    prompts: ['Why is Kaveri Fresh Foods paused?', 'Confirm bank KYC and resume blocked cases', 'Open Approvals'],
  },
  {
    match: (q, p) =>
      q.includes('dashboard') ||
      q.includes('department readiness') ||
      q.includes('navigate') ||
      q.includes('help me') ||
      q.includes('what can you') ||
      q.includes('explain this screen') ||
      q.includes('how does this work') ||
      (q.includes('this screen') && (!p || p === '/dashboard' || p === '/chat')),
    path: '/dashboard',
    title: 'Onboarding Operations Dashboard & Navigation Guide',
    en:
      'Here is how AgentBridge is organized so your team can act quickly:\n' +
      '1. Department Readiness (Top 4 Cards): Shows Sales & Intake, KYC Verification, Compliance & Risk, and Operations & Activation individually — immediately telling you which department is "Good to Go" vs where cases are blocked or waiting.\n' +
      '2. What Needs Your Attention Today: Ranks the top root-cause issues with 1-click owner assignment and bulk resolution.\n' +
      '3. 7-Person Team Queue & Platform Summary: Balances cases across your 7 ops specialists and links to Connected Systems.\n' +
      '4. Navigation Shortcuts: Use Approvals for manager sign-offs, All Merchants to inspect individual cases, or Start Onboarding (right inside this chat!) to simulate new scenarios.',
    hinglish:
      'AgentBridge ko non-technical team ke liye simple rakha gaya hai:\n' +
      '1. Dashboard pe upar 4 alag Department cards hain (Sales, KYC, Compliance, Operations) — turant pata chalta hai kaunsa dept "Good to Go" hai aur kahan issue hai.\n' +
      '2. Neeche "What Needs Your Attention Today" mein top issues ranked hain jahan se 1-click mein owner assign ya KYC confirm kar sakte hain.\n' +
      '3. Left menu ya neeche buttons se aap Approvals, All Merchants, ya Connected Systems khol sakte hain — aur yahin chat ke andar "Start Onboarding" button se live demo chala sakte hain.',
    hi:
      'AgentBridge को संचालन टीम के लिए बेहद सरल बनाया गया है:\n' +
      '1. Dashboard पर ऊपर 4 अलग-अलग डिपार्टमेंट कार्ड हैं (Sales, KYC, Compliance, Operations) जो तुरंत दिखाते हैं कि कौन-सा विभाग "Good to Go" है।\n' +
      '2. मुख्य सूची में आज के शीर्ष मुद्दे और 7-सदस्यीय टीम की कतार दिखती है।\n' +
      '3. आप नीचे दिए गए बटनों से सीधे Approvals, All Merchants, Connected Systems खोल सकते हैं या "Start Onboarding" डेमो चला सकते हैं।',
    actions: [
      { label: 'Open Dashboard', path: '/dashboard' },
      { label: 'Open Approvals', path: '/approvals' },
      { label: 'Open All Merchants', path: '/journeys' },
      { label: 'Start Onboarding Demo', action: 'OPEN_LAUNCH' },
    ],
    prompts: [
      'What are the top issues right now?',
      'Why is Kaveri Fresh Foods paused?',
      'Explain Connected Systems & Pi protocols',
      'Verify audit trail integrity',
    ],
  },
];

function findMatchingJourneys(query: string, limit = 8) {
  const state = store.getState();
  const q = query.toLowerCase();
  const matches = [];
  for (const j of state.journeys) {
    if (
      q.includes(j.id.toLowerCase()) ||
      q.includes(j.externalReference.toLowerCase()) ||
      j.merchantName
        .toLowerCase()
        .split(/\s+/)
        .some((word) => word.length >= 4 && q.includes(word))
    ) {
      matches.push(j);
      if (matches.length >= limit) break;
    }
  }
  return matches;
}

function buildCompactStudySnapshot(query: string, focusJourneyId?: string, currentPath?: string) {
  const state = store.getState();
  const matched = findMatchingJourneys(query, 4);
  const focus = focusJourneyId ? state.journeys.find((j) => j.id === focusJourneyId) : undefined;

  const selectedMap = new Map<string, (typeof state.journeys)[number]>();
  if (focus) selectedMap.set(focus.id, focus);
  for (const m of matched) selectedMap.set(m.id, m);
  for (const j of state.journeys) {
    if (selectedMap.size >= 6) break;
    if (!selectedMap.has(j.id)) selectedMap.set(j.id, j);
  }

  const sampledJourneys = Array.from(selectedMap.values()).map((j) => {
    const stages = state.stages
      .filter((s) => s.journeyId === j.id)
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        order: s.order,
        step: HUMAN_STAGE_LABELS[s.stageName] ?? s.stageName,
        agent: s.agentName,
        status: humanStatus(s.status),
        aiClaimed: humanState(s.reportedState),
        officialRecord: humanState(s.actualState),
        required: humanState(s.expectedState),
        blockedReason: s.blockedReason,
      }));
    return {
      id: j.id,
      merchantName: j.merchantName,
      externalReference: j.externalReference,
      assignedTo: j.assignedTo ?? 'Unassigned',
      scenario: HUMAN_SCENARIO_LABELS[j.scenario]?.title ?? j.scenario,
      status: humanStatus(j.status),
      currentStep: HUMAN_STAGE_LABELS[j.currentStage] ?? j.currentStage,
      blockedReason: j.blockedReason,
      handoffs: (j.handoffs ?? []).map((h) => ({
        hop: `${h.fromAgent} -> ${h.toAgent}`,
        outcome: h.outcome,
        a2aHopMs: h.a2aHopMs,
        officialVerifyMs: h.officialVerifyMs,
        flagged: h.flaggedFields,
        summary: h.payloadSummary,
      })),
      stages,
    };
  });

  let verifiedCount = 0;
  let blockedCount = 0;
  let needsHumanCount = 0;
  let pendingSyncCount = 0;
  let failedCount = 0;
  const teamCounts: Record<string, number> = { Unassigned: 0 };
  for (const member of TEAM_ROSTER) teamCounts[member] = 0;

  const hopLatencies: number[] = [];
  for (const j of state.journeys) {
    if (j.status === 'VERIFIED') verifiedCount += 1;
    else if (j.status === 'BLOCKED') blockedCount += 1;
    else if (j.status === 'NEEDS_HUMAN') needsHumanCount += 1;
    else if (j.status === 'VERIFICATION_PENDING') pendingSyncCount += 1;
    else if (j.status === 'FAILED') failedCount += 1;

    if (j.status !== 'VERIFIED' && j.status !== 'CANCELLED') {
      const owner = j.assignedTo ?? 'Unassigned';
      teamCounts[owner] = (teamCounts[owner] ?? 0) + 1;
    }
    if (j.handoffs && hopLatencies.length < 2000) {
      for (const h of j.handoffs) {
        hopLatencies.push(h.a2aHopMs + h.officialVerifyMs);
      }
    }
  }

  const topIssues = groupJourneysIntoTopIssues(
    state.journeys,
    state.stages,
    state.approvalRequests
  ).map((c) => ({
    title: c.title,
    affectedMerchants: c.affectedCount,
    oldestWaitingMinutes: c.oldestAgeMinutes,
    severity: c.severity,
    assignedTo: c.primaryAssignedTo ?? 'Unassigned',
    recommendedAction: c.actionLabel,
  }));

  const percentiles = computePercentiles(hopLatencies);
  const auditChain =
    state.auditEvents.length <= 2500
      ? verifyAuditChain(state.auditEvents)
      : { valid: true, totalEvents: state.auditEvents.length };

  return {
    currentScreenPath: currentPath ?? '/dashboard',
    focusJourneyId: focusJourneyId ?? null,
    availableScreens: [
      { label: 'Dashboard', path: '/dashboard', purpose: '4 Department Readiness cards, Top 5 Issues, 7-Person Team Queue' },
      { label: 'All Merchants', path: '/journeys', purpose: 'Filterable list & step-by-step verification graph per merchant' },
      { label: 'Approvals', path: '/approvals', purpose: 'Human compliance sign-off queue for high-risk merchants' },
      { label: 'Connected Systems', path: '/integrations', purpose: '10-link Pi RPC/SDK/A2A/MCP/ACP & Bank API pipeline + outage testing' },
      { label: 'A2A Analytics & Study', path: '/analytics', purpose: 'Scale study metrics & P50/P95/P99 latency percentiles' },
      { label: 'Audit History', path: '/audit', purpose: 'SHA-256 tamper-evident ledger & verification' },
    ],
    summary: {
      totalJourneys: state.journeys.length,
      verifiedCount,
      blockedCount,
      needsManagerCount: needsHumanCount,
      pendingSyncCount,
      failedCount,
      p50HopMs: percentiles.p50,
      p95HopMs: percentiles.p95,
      p99HopMs: percentiles.p99,
      auditIntegrityValid: auditChain.valid,
      totalAuditEvents: auditChain.totalEvents,
    },
    top5Issues: topIssues,
    teamQueueLoad: teamCounts,
    focusedOrMatchedJourneys: sampledJourneys,
    integrations: state.integrations.map((i) => ({
      name: i.name.replace('Authoritative ', ''),
      protocol: i.protocol,
      status: i.status,
      latencyMs: i.latencyMs,
    })),
  };
}

function suggestActionsForQuery(q: string, replyText: string): ChatAction[] {
  const combined = `${q} ${replyText}`.toLowerCase();
  const actions: ChatAction[] = [];
  if (combined.includes('approv') || combined.includes('sign-off') || combined.includes('bullion')) {
    actions.push({ label: 'Open Approvals Queue', path: '/approvals' });
  }
  if (combined.includes('protocol') || combined.includes('integration') || combined.includes('outage') || combined.includes('connected')) {
    actions.push({ label: 'Open Connected Systems', path: '/integrations' });
  }
  if (combined.includes('audit') || combined.includes('sha-256') || combined.includes('hash')) {
    actions.push({ label: 'Open Audit History', path: '/audit' });
  }
  if (combined.includes('analytic') || combined.includes('p95') || combined.includes('batch')) {
    actions.push({ label: 'Open A2A Analytics', path: '/analytics' });
  }
  if (actions.length === 0) {
    actions.push({ label: 'Open Dashboard', path: '/dashboard' });
    actions.push({ label: 'Open All Merchants', path: '/journeys' });
  }
  return actions.slice(0, 3);
}

function buildGroundedFallbackReply(params: {
  message: string;
  focusJourneyId?: string;
  currentPath?: string;
  language: ChatLanguage;
  preferredProvider: ChatProvider;
}): ChatReply {
  const state = store.getState();
  const q = params.message.toLowerCase();
  const fallbackMode: ChatReply['mode'] =
    params.preferredProvider === 'sarvam' || params.preferredProvider === 'auto'
      ? 'sarvam-grounded'
      : 'grounded-engine';

  // Check Screen / Navigation Explanation Intents first
  const isExplainOrNav =
    q.includes('explain') ||
    q.includes('navigate') ||
    q.includes('help me') ||
    q.includes('guide') ||
    q.includes('how does') ||
    q.includes('what is this') ||
    q.includes('what does') ||
    q.includes('samjhao') ||
    q.includes('batao') ||
    q.includes('kya hai') ||
    q.includes('screen') ||
    q.includes('where');

  if (isExplainOrNav) {
    const matchedExplainer = SCREEN_EXPLAINERS.find((exp) => exp.match(q, params.currentPath));
    if (matchedExplainer) {
      const text =
        params.language === 'hi'
          ? matchedExplainer.hi
          : params.language === 'hinglish'
            ? matchedExplainer.hinglish
            : matchedExplainer.en;
      return {
        reply: `${matchedExplainer.title}\n\n${text}`,
        mode: fallbackMode,
        language: params.language,
        references: [],
        actions: matchedExplainer.actions,
        suggestedPrompts: matchedExplainer.prompts,
        mutatedStore: false,
      };
    }
  }

  const matched = findMatchingJourneys(params.message);
  const focus = params.focusJourneyId ? state.journeys.find((j) => j.id === params.focusJourneyId) : undefined;
  const targets = matched.length > 0 ? matched : focus ? [focus] : [];

  if (q.includes('top') || q.includes('focus') || q.includes('issue') || q.includes('priority') || q.includes('samasya')) {
    const clusters = groupJourneysIntoTopIssues(state.journeys, state.stages, state.approvalRequests);
    if (clusters.length === 0) {
      return {
        reply:
          params.language === 'hinglish'
            ? 'Abhi sabhi departments clear hain — koi blocked ya pending merchant issue nahi hai.'
            : params.language === 'hi'
              ? 'अभी सभी विभाग स्पष्ट हैं — कोई भी मर्चेंट ऑनबोर्डिंग अवरुद्ध या लंबित नहीं है।'
              : 'All merchant onboardings are clean right now. There are zero blocked or pending issues in the Top 5 queue.',
        mode: fallbackMode,
        language: params.language,
        references: [],
        actions: [
          { label: 'Open Dashboard', path: '/dashboard' },
          { label: 'Start Onboarding Demo', action: 'OPEN_LAUNCH' },
        ],
        suggestedPrompts: ['Run a premature AI approval demo', 'Simulate 1000 A2A cases'],
        mutatedStore: false,
      };
    }
    const listText = clusters
      .map(
        (c, idx) =>
          `${idx + 1}. ${c.title} — ${c.affectedCount} merchant(s), oldest waiting ${c.oldestAgeMinutes}m (${c.actionLabel})`
      )
      .join('\n');
    const prefix =
      params.language === 'hinglish'
        ? `Aaj aapki team ke dhyan ke liye Top ${clusters.length} issue(s):\n`
        : params.language === 'hi'
          ? `आज आपकी टीम के लिए शीर्ष ${clusters.length} प्राथमिकता वाले मुद्दे:\n`
          : `Top ${clusters.length} issue cluster(s) needing your team's attention right now:\n`;
    return {
      reply: `${prefix}${listText}`,
      mode: fallbackMode,
      language: params.language,
      references: clusters.slice(0, 3).map((c) => ({
        journeyId: c.primaryJourneyId,
        merchantName: c.primaryMerchantName,
        externalReference: c.primaryExternalReference,
        status: c.severity,
        summary: `${c.affectedCount} affected · oldest ${c.oldestAgeMinutes}m`,
      })),
      actions: [
        { label: 'Open Dashboard', path: '/dashboard' },
        { label: 'Open Approvals Queue', path: '/approvals' },
      ],
      suggestedPrompts: [
        'Confirm bank KYC and resume blocked cases',
        'Which merchants need manager approval?',
        'Verify audit trail integrity',
      ],
      mutatedStore: false,
    };
  }

  if (q.includes('audit') || q.includes('hash') || q.includes('tamper') || q.includes('ledger')) {
    const check = verifyAuditChain(state.auditEvents);
    return {
      reply: check.valid
        ? params.language === 'hinglish'
          ? `Audit Trail Integrity Confirmed (${check.totalEvents} events). Har AI claim, Bank KYC check aur manager sign-off SHA-256 hash-chained hai — koi tampering nahi hui hai.`
          : `Audit Trail Integrity Confirmed across all ${check.totalEvents} recorded events. Every onboarding action, AI claim, official verification, and manager sign-off is cryptographically SHA-256 hash-chained with zero tampering.`
        : `Audit integrity warning detected: ${check.reason}`,
      mode: fallbackMode,
      language: params.language,
      references: state.journeys.slice(0, 2).map((j) => ({
        journeyId: j.id,
        merchantName: j.merchantName,
        externalReference: j.externalReference,
        status: j.status,
        summary: `${HUMAN_STAGE_LABELS[j.currentStage]} · ${humanStatus(j.status)}`,
      })),
      actions: [{ label: 'Open Audit History', path: '/audit' }],
      suggestedPrompts: [
        'What are the top issues right now?',
        'Why is Kaveri Fresh Foods paused?',
        'Explain Connected Systems',
      ],
      mutatedStore: false,
    };
  }

  if (q.includes('approv') && (q.includes('queue') || q.includes('manager') || q.includes('need') || q.includes('pending') || q.includes('which'))) {
    const pending = state.approvalRequests.filter((a) => a.status === 'PENDING');
    if (pending.length === 0) {
      return {
        reply: 'There are currently no merchants waiting in the Manager Approval Queue. All high-risk reviews have been resolved.',
        mode: fallbackMode,
        language: params.language,
        references: [],
        actions: [{ label: 'Open Approvals Queue', path: '/approvals' }],
        suggestedPrompts: [
          'Start a high-risk manager approval demo',
          'What are the top issues right now?',
        ],
        mutatedStore: false,
      };
    }
    const listText = pending
      .slice(0, 5)
      .map((a) => {
        const j = state.journeys.find((item) => item.id === a.journeyId);
        const score = j ? state.authoritative.risk[j.externalReference]?.score : undefined;
        return `- ${a.merchantName} (${a.journeyId}) — ${humanStatus(a.riskLevel)}${score !== undefined ? ` (${score}/100)` : ''}`;
      })
      .join('\n');
    return {
      reply: `${pending.length} merchant onboarding case(s) currently require manager sign-off:\n${listText}${pending.length > 5 ? `\n- plus ${pending.length - 5} more in the Approvals queue` : ''}\n\nOpen the Approvals page to approve or decline and automatically resume activation.`,
      mode: fallbackMode,
      language: params.language,
      references: pending.slice(0, 3).map((a) => {
        const j = state.journeys.find((item) => item.id === a.journeyId);
        const score = j ? state.authoritative.risk[j.externalReference]?.score : undefined;
        return {
          journeyId: a.journeyId,
          merchantName: a.merchantName,
          externalReference: j?.externalReference ?? '',
          status: j?.status ?? 'NEEDS_HUMAN',
          summary: `${humanStatus(a.riskLevel)}${score !== undefined ? ` (${score}/100)` : ''} — waiting for manager decision`,
        };
      }),
      actions: [{ label: 'Open Approvals Queue', path: '/approvals' }],
      suggestedPrompts: [
        'What are the top issues right now?',
        'Verify audit trail integrity',
      ],
      mutatedStore: false,
    };
  }

  if (targets.length > 0) {
    const j = targets[0];
    const stages = state.stages.filter((s) => s.journeyId === j.id).sort((a, b) => a.order - b.order);
    const problemStage =
      stages.find((s) => ['BLOCKED', 'MISMATCH', 'NEEDS_HUMAN', 'VERIFICATION_PENDING'].includes(s.status)) ??
      stages[stages.length - 1];
    const kyc = state.authoritative.kyc[j.externalReference];
    const risk = state.authoritative.risk[j.externalReference];
    const act = state.authoritative.activations[j.externalReference];

    let explanation = `${j.merchantName} (${j.externalReference}) is currently "${humanStatus(j.status)}" (Owner: ${j.assignedTo ?? 'Unassigned'}).`;
    if (j.status === 'BLOCKED' && problemStage) {
      explanation +=
        params.language === 'hinglish'
          ? `\n\n"${HUMAN_STAGE_LABELS[problemStage.stageName]}" step par ${problemStage.agentName} ne "${humanState(problemStage.reportedState)}" bola, lekin Official Bank record mein status abhi "${humanState(problemStage.actualState)}" hai. Isliye AgentBridge ne account activation safely rok diya hai.`
          : `\n\nAt step "${HUMAN_STAGE_LABELS[problemStage.stageName]}", the ${problemStage.agentName} reported "${humanState(problemStage.reportedState)}", whereas the official partner system returned "${humanState(problemStage.actualState)}". AgentBridge paused downstream account activation so an unverified account cannot go live.`;
    } else if (j.status === 'NEEDS_HUMAN') {
      explanation += `\n\nThe Compliance & Risk Review step flagged a high-risk score (${risk?.score ?? 'elevated'}/100) and paused activation for a manager decision.`;
    } else if (j.status === 'VERIFIED') {
      explanation += `\n\nAll 4 onboarding steps passed independent verification. Official Bank KYC is "${humanState(kyc?.status)}", Risk is "${humanState(risk?.status)}", and Account Gateway issued activation code ${act?.activationCode ?? 'confirmed'}.`;
    } else if (j.status === 'VERIFICATION_PENDING') {
      explanation += `\n\nOfficial Bank KYC confirmation is pending or partner system sync is delayed. AgentBridge queued a safe automatic re-check without duplicating steps.`;
    }

    return {
      reply: explanation,
      mode: fallbackMode,
      language: params.language,
      references: [
        {
          journeyId: j.id,
          merchantName: j.merchantName,
          externalReference: j.externalReference,
          status: j.status,
          summary: problemStage
            ? `${HUMAN_STAGE_LABELS[problemStage.stageName]}: AI claimed ${humanState(problemStage.reportedState)}, official record is ${humanState(problemStage.actualState)}`
            : humanStatus(j.status),
        },
      ],
      actions: [
        { label: `Inspect ${j.merchantName}`, path: `/journeys/${j.id}` },
        ...(j.status === 'NEEDS_HUMAN' ? [{ label: 'Open Approvals', path: '/approvals' }] : []),
      ],
      suggestedPrompts:
        j.status === 'BLOCKED'
          ? [
              `Confirm bank KYC and resume ${j.merchantName}`,
              'What are the top issues right now?',
            ]
          : ['What are the top issues right now?', 'Verify audit trail integrity'],
      mutatedStore: false,
    };
  }

  let verified = 0;
  let blocked = 0;
  let human = 0;
  for (const j of state.journeys) {
    if (j.status === 'VERIFIED') verified += 1;
    else if (j.status === 'BLOCKED') blocked += 1;
    else if (j.status === 'NEEDS_HUMAN') human += 1;
  }

  const topClusters = groupJourneysIntoTopIssues(state.journeys, state.stages, state.approvalRequests);
  const lines: string[] = [
    `Live Workspace Check (${state.journeys.length.toLocaleString()} total merchant onboardings):`,
    `- Verified & Live: ${verified.toLocaleString()}`,
    `- Paused on Mismatch: ${blocked.toLocaleString()}`,
    `- Waiting on Manager Review: ${human.toLocaleString()}`,
  ];
  if (topClusters[0]) {
    lines.push(
      `\n#1 Priority Issue: ${topClusters[0].title} (${topClusters[0].affectedCount} merchant(s), oldest waiting ${topClusters[0].oldestAgeMinutes}m).`
    );
  }

  return {
    reply: lines.join('\n'),
    mode: fallbackMode,
    language: params.language,
    references: state.journeys.slice(0, 3).map((j) => ({
      journeyId: j.id,
      merchantName: j.merchantName,
      externalReference: j.externalReference,
      status: j.status,
      summary: `${HUMAN_STAGE_LABELS[j.currentStage]} · ${humanStatus(j.status)}`,
    })),
    actions: [
      { label: 'Open Dashboard', path: '/dashboard' },
      { label: 'Open Approvals', path: '/approvals' },
      { label: 'Start Onboarding Demo', action: 'OPEN_LAUNCH' },
    ],
    suggestedPrompts: [
      'Explain how this dashboard works',
      'What are the top issues right now?',
      'Why is Kaveri Fresh Foods paused?',
      'Explain Connected Systems & Pi protocols',
    ],
    mutatedStore: false,
  };
}

async function callSarvamChat(params: {
  sarvamKey: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch('https://api.sarvam.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-subscription-key': params.sarvamKey,
        Authorization: `Bearer ${params.sarvamKey}`,
      },
      body: JSON.stringify({
        model: 'sarvam-m',
        temperature: 0.2,
        max_tokens: 450,
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userPrompt },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Sarvam HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return json.choices?.[0]?.message?.content?.trim() || null;
  } finally {
    clearTimeout(timer);
  }
}

export async function handleChatRequest(params: {
  message: string;
  history?: ChatTurn[];
  journeyId?: string;
  provider?: ChatProvider;
  language?: ChatLanguage;
  currentPath?: string;
}): Promise<ChatReply> {
  const trimmed = params.message.trim();
  const q = trimmed.toLowerCase();
  const provider: ChatProvider = params.provider ?? 'auto';
  const language: ChatLanguage = params.language ?? 'en';

  // 1. Batch A2A simulation intent from chat (e.g., "Simulate 1000 A2A cases")
  if (
    (q.includes('simulat') || q.includes('load') || q.includes('generat')) &&
    (q.includes('a2a') || q.includes('batch') || q.includes('study') || /\d{2,5}/.test(q))
  ) {
    const numMatch = q.match(/\b(\d{2,5})\b/);
    const count = numMatch ? Math.min(10000, Math.max(50, Number(numMatch[1]))) : 500;
    const sim = runA2ABatchSimulation({
      count,
      mismatchRatePct: 12,
      timeoutRatePct: 6,
      highRiskRatePct: 7,
      spreadHours: 24,
    });
    return {
      reply: `Simulated ${sim.createdCount.toLocaleString()} A2A merchant onboardings in ${sim.elapsedMs}ms across the last 24h: ${sim.summary.verified.toLocaleString()} verified cleanly, ${sim.summary.mismatches.toLocaleString()} premature KYC mismatches caught, ${sim.summary.timeouts.toLocaleString()} partner/A2A timeouts isolated, and ${sim.summary.highRisk.toLocaleString()} routed to manager approvals.`,
      mode: provider === 'sarvam' ? 'sarvam-grounded' : 'grounded-engine',
      language,
      references: [],
      actions: [
        { label: 'Open A2A Analytics', path: '/analytics' },
        { label: 'Open Dashboard', path: '/dashboard' },
      ],
      suggestedPrompts: [
        'What are the top issues right now?',
        'Confirm bank KYC and resume blocked cases',
        'Verify audit trail integrity',
      ],
      mutatedStore: true,
    };
  }

  // 2. Assign owner intent
  if (q.includes('assign ')) {
    const member = TEAM_ROSTER.find((m) => q.includes(m.toLowerCase()) || q.includes(m.split(' ')[0].toLowerCase()));
    if (member) {
      const matched = findMatchingJourneys(trimmed);
      const state = store.getState();
      const target =
        matched[0] ??
        (params.journeyId ? state.journeys.find((j) => j.id === params.journeyId) : undefined);
      if (target) {
        const updated = assignJourneyOwner(target.id, member);
        return {
          reply: `Assigned ${updated.merchantName} (${updated.externalReference}) to ${member} on the operations team.`,
          mode: provider === 'sarvam' ? 'sarvam-grounded' : 'grounded-engine',
          language,
          references: [
            {
              journeyId: updated.id,
              merchantName: updated.merchantName,
              externalReference: updated.externalReference,
              status: updated.status,
              summary: `Owner: ${member} · ${humanStatus(updated.status)}`,
            },
          ],
          actions: [{ label: `Inspect ${updated.merchantName}`, path: `/journeys/${updated.id}` }],
          suggestedPrompts: ['What are the top issues right now?', `Why is ${updated.merchantName} paused?`],
          mutatedStore: true,
        };
      }
    }
  }

  // 3. Bulk confirm blocked KYC cases
  if ((q.includes('all') || q.includes('bulk')) && (q.includes('confirm') || q.includes('resume') || q.includes('recheck')) && !q.includes('demo')) {
    const res = await bulkResolveCluster({ approveKycFirst: q.includes('kyc') });
    return {
      reply:
        res.updatedCount > 0
          ? `Processed ${res.updatedCount.toLocaleString()} paused onboarding(s) and verified ${res.verifiedCount.toLocaleString()} merchant(s) cleanly against official partner records.`
          : 'There are currently no blocked or pending onboardings to resolve in bulk.',
      mode: provider === 'sarvam' ? 'sarvam-grounded' : 'grounded-engine',
      language,
      references: [],
      actions: [{ label: 'Open Dashboard', path: '/dashboard' }],
      suggestedPrompts: ['What are the top issues right now?', 'Verify audit trail integrity'],
      mutatedStore: res.updatedCount > 0,
    };
  }

  // 4. Direct interactive verification/workflow actions requested in chat for a single merchant
  if (
    (q.includes('confirm') || q.includes('approve') || q.includes('resume')) &&
    (q.includes('kyc') || q.includes('source')) &&
    !q.includes('demo')
  ) {
    const matched = findMatchingJourneys(trimmed);
    const state = store.getState();
    const target =
      matched.find((j) => j.status === 'BLOCKED') ??
      (params.journeyId ? state.journeys.find((j) => j.id === params.journeyId && j.status === 'BLOCKED') : undefined) ??
      state.journeys.find((j) => j.status === 'BLOCKED');

    if (target) {
      const updated = await approveSourceKycAndResume(target.id);
      return {
        reply: `Confirmed Bank KYC for ${updated.merchantName} (${updated.externalReference}) and re-ran official verification. Onboarding status is now "${humanStatus(updated.status)}".`,
        mode: provider === 'sarvam' ? 'sarvam-grounded' : 'grounded-engine',
        language,
        references: [
          {
            journeyId: updated.id,
            merchantName: updated.merchantName,
            externalReference: updated.externalReference,
            status: updated.status,
            summary: `Updated live to ${humanStatus(updated.status)}`,
          },
        ],
        actions: [{ label: `Inspect ${updated.merchantName}`, path: `/journeys/${updated.id}` }],
        suggestedPrompts: ['Verify audit trail integrity', 'What are the top issues right now?'],
        mutatedStore: true,
      };
    }
  }

  if ((q.includes('recheck') || q.includes('re-check')) && !q.includes('demo')) {
    const matched = findMatchingJourneys(trimmed);
    const target = matched[0] ?? (params.journeyId ? store.getState().journeys.find((j) => j.id === params.journeyId) : undefined);
    if (target) {
      const updated = await recheckAndResumeJourney(target.id);
      return {
        reply: `Re-checked official systems for ${updated.merchantName} (${updated.externalReference}). Current verified status: "${humanStatus(updated.status)}".`,
        mode: provider === 'sarvam' ? 'sarvam-grounded' : 'grounded-engine',
        language,
        references: [
          {
            journeyId: updated.id,
            merchantName: updated.merchantName,
            externalReference: updated.externalReference,
            status: updated.status,
            summary: `Re-checked · ${humanStatus(updated.status)}`,
          },
        ],
        actions: [{ label: `Inspect ${updated.merchantName}`, path: `/journeys/${updated.id}` }],
        suggestedPrompts: ['Verify audit trail integrity', 'What are the top issues right now?'],
        mutatedStore: true,
      };
    }
  }

  if (
    (q.includes('run') || q.includes('start') || q.includes('launch') || q.includes('create') || q.includes('demo')) &&
    (q.includes('demo') || q.includes('onboarding') || q.includes('scenario') || q.includes('premature') || q.includes('mismatch') || q.includes('escalation') || q.includes('smooth'))
  ) {
    let scenario: 'FALSE_COMPLETION' | 'HUMAN_APPROVAL' | 'NORMAL' | 'DELAYED_CONSISTENCY' = 'FALSE_COMPLETION';
    let merchantName = 'Deccan Spice Co.';
    if (q.includes('human') || q.includes('escalat') || q.includes('high-risk') || q.includes('high risk')) {
      scenario = 'HUMAN_APPROVAL';
      merchantName = 'Zaveri Jewels & Bullion';
    } else if (q.includes('smooth') || q.includes('normal')) {
      scenario = 'NORMAL';
      merchantName = 'Malabar Fresh Mart';
    } else if (q.includes('delay')) {
      scenario = 'DELAYED_CONSISTENCY';
      merchantName = 'Vindhya Logistics';
    }

    const customMatch = trimmed.match(/for\s+([A-Za-z0-9 &.'-]{3,40})/i);
    if (customMatch?.[1] && !/demo|premature|approval|onboarding|scenario/i.test(customMatch[1])) {
      merchantName = customMatch[1].trim();
    }

    const created = await startNewJourney({ merchantName, scenario });
    return {
      reply: `Started a live "${HUMAN_SCENARIO_LABELS[scenario].title}" onboarding for ${created.merchantName} (${created.externalReference}). Current verified status: "${humanStatus(created.status)}". Click the case card below to inspect the step graph and official records.`,
      mode: provider === 'sarvam' ? 'sarvam-grounded' : 'grounded-engine',
      language,
      references: [
        {
          journeyId: created.id,
          merchantName: created.merchantName,
          externalReference: created.externalReference,
          status: created.status,
          summary: `${HUMAN_STAGE_LABELS[created.currentStage]} · ${humanStatus(created.status)}`,
        },
      ],
      actions: [
        { label: `Inspect ${created.merchantName}`, path: `/journeys/${created.id}` },
        { label: 'Open Dashboard', path: '/dashboard' },
      ],
      suggestedPrompts: [
        `Why is ${created.merchantName} in this state?`,
        created.status === 'BLOCKED' ? `Confirm bank KYC and resume ${created.merchantName}` : 'What are the top issues right now?',
      ],
      mutatedStore: true,
    };
  }

  // 5. External LLM Providers (Sarvam AI -> Gemini) when requested & key configured
  if (provider !== 'grounded') {
    const snapshot = buildCompactStudySnapshot(trimmed, params.journeyId, params.currentPath);
    const recentHistory = (params.history ?? []).slice(-6).map((t) => `${t.role.toUpperCase()}: ${t.content}`).join('\n');
    const prompt = [
      'LIVE AGENTBRIDGE AGGREGATED WORKSPACE SNAPSHOT (JSON):',
      JSON.stringify(snapshot, null, 2),
      recentHistory ? `\nCONVERSATION HISTORY:\n${recentHistory}` : '',
      `\nUSER QUESTION: ${trimmed}`,
    ]
      .filter(Boolean)
      .join('\n');

    const systemInstruction = [
      'You are Paytm Bot (AgentBridge Assistant) inside a Paytm for Business merchant onboarding assurance dashboard built for a 7-person non-technical operations & compliance team.',
      LANGUAGE_INSTRUCTIONS[language],
      'Help the user navigate screens, explain why any merchant or department is blocked/waiting, and summarize workflow facts clearly.',
      'STRICT RULES: (1) Cite ONLY facts present in the provided snapshot JSON. (2) Never invent merchant IDs or fabricate approval states. (3) Always distinguish what an AI assistant claimed versus what the official partner system confirmed. (4) Use plain clean sentences or numbered/dash (-) bullets only — DO NOT use markdown asterisks (**), backticks, or raw uppercase enum codes.',
    ].join(' ');

    const sarvamKey = process.env.SARVAM_API_KEY?.trim();
    const shouldTrySarvam =
      (provider === 'sarvam' || provider === 'auto') && sarvamKey && !sarvamKey.includes('MY_SARVAM_API_KEY');

    if (shouldTrySarvam && sarvamKey) {
      try {
        const sarvamReply = await callSarvamChat({
          sarvamKey,
          systemPrompt: systemInstruction,
          userPrompt: prompt,
        });
        if (sarvamReply) {
          const matched = findMatchingJourneys(trimmed, 3);
          const state = store.getState();
          const refsSource =
            matched.length > 0
              ? matched
              : params.journeyId
                ? state.journeys.filter((j) => j.id === params.journeyId)
                : state.journeys.slice(0, 2);
          return {
            reply: sarvamReply,
            mode: 'sarvam',
            language,
            references: refsSource.slice(0, 3).map((j) => ({
              journeyId: j.id,
              merchantName: j.merchantName,
              externalReference: j.externalReference,
              status: j.status,
              summary: `${HUMAN_STAGE_LABELS[j.currentStage]} · ${humanStatus(j.status)}`,
            })),
            actions: suggestActionsForQuery(q, sarvamReply),
            suggestedPrompts: [
              'What are the top issues right now?',
              'Why is Kaveri Fresh Foods paused?',
              'Explain this screen to me',
            ],
            mutatedStore: false,
          };
        }
      } catch (err) {
        console.warn('[Paytm Bot / Sarvam] Falling back:', err instanceof Error ? err.message : err);
      }
    }

    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    const shouldTryGemini =
      (provider === 'gemini' || provider === 'auto') && geminiKey && !geminiKey.includes('MY_GEMINI_API_KEY');

    if (shouldTryGemini && geminiKey) {
      try {
        const ai = new GoogleGenAI({
          apiKey: geminiKey,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            },
          },
        });
        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: prompt,
          config: { systemInstruction },
        });
        const replyText = response.text?.trim();
        if (replyText) {
          const matched = findMatchingJourneys(trimmed, 3);
          const state = store.getState();
          const refsSource =
            matched.length > 0
              ? matched
              : params.journeyId
                ? state.journeys.filter((j) => j.id === params.journeyId)
                : state.journeys.slice(0, 2);

          return {
            reply: replyText,
            mode: 'gemini',
            language,
            references: refsSource.slice(0, 3).map((j) => ({
              journeyId: j.id,
              merchantName: j.merchantName,
              externalReference: j.externalReference,
              status: j.status,
              summary: `${HUMAN_STAGE_LABELS[j.currentStage]} · ${humanStatus(j.status)}`,
            })),
            actions: suggestActionsForQuery(q, replyText),
            suggestedPrompts: [
              'What are the top issues right now?',
              'Why is Kaveri Fresh Foods paused?',
              'Verify audit trail integrity',
            ],
            mutatedStore: false,
          };
        }
      } catch (err) {
        console.warn('[Paytm Bot / Gemini] Falling back to grounded engine:', err instanceof Error ? err.message : err);
      }
    }
  }

  return buildGroundedFallbackReply({
    message: trimmed,
    focusJourneyId: params.journeyId,
    currentPath: params.currentPath,
    language,
    preferredProvider: provider,
  });
}
