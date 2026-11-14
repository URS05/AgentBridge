import type { JourneyScenario, StageName } from '../core/types';

export const HUMAN_STATUS_LABELS: Record<string, string> = {
  VERIFIED: 'Verified & Live',
  PASS: 'Confirmed',
  COMPLETED: 'Completed',
  APPROVED: 'Approved',
  HEALTHY: 'Online',
  SUCCESS: 'Succeeded',
  COMMITTED: 'Recorded Safely',
  BLOCKED: 'Paused — Mismatch',
  MISMATCH: 'Mismatch Detected',
  FAIL: 'Check Failed',
  FAILED: 'Failed',
  REJECTED: 'Declined',
  OUTAGE: 'System Offline',
  NEEDS_HUMAN: 'Needs Manager Review',
  VERIFICATION_PENDING: 'Waiting on Bank Sync',
  SOURCE_UNAVAILABLE: 'Partner Unavailable',
  UNAVAILABLE: 'Partner Offline',
  PENDING: 'Pending',
  RUNNING: 'In Progress',
  VERIFYING: 'Verifying Official Record',
  NOT_STARTED: 'Waiting',
  CANCELLED: 'Cancelled',
  HIGH: 'High Risk',
  CRITICAL: 'Critical Risk',
  MEDIUM: 'Medium Risk',
  LOW: 'Low Risk',
  EVIDENCE_REQUESTED: 'More Documents Requested',
  ESCALATED: 'Escalated',
};

export const HUMAN_STAGE_LABELS: Record<StageName, string> = {
  SALES_ONBOARDING: 'Merchant Profile Setup',
  KYC_VERIFICATION: 'KYC Document Check',
  RISK_ASSESSMENT: 'Compliance & Risk Review',
  OPERATIONS_ACTIVATION: 'Account Activation',
};

export const HUMAN_STATE_VALUES: Record<string, string> = {
  PROFILE_CREATED: 'Merchant Profile Created',
  COMPLETED: 'Step Marked Complete',
  KYC_APPROVED: 'KYC Approved',
  KYC_PENDING: 'KYC Still Pending',
  KYC_NOT_FOUND: 'No KYC Record Found',
  RISK_CLEARED: 'Risk Check Cleared',
  RISK_REVIEW_REQUIRED: 'Manual Risk Review Needed',
  RISK_PENDING: 'Risk Check Pending',
  FLAGGED: 'Flagged for Review',
  ACTIVATED: 'Account Activated',
  NOT_ACTIVATED: 'Not Activated Yet',
  PENDING: 'Pending',
  SOURCE_503_UNAVAILABLE: 'Partner System Offline',
};

export const HUMAN_SCENARIO_LABELS: Record<JourneyScenario, { title: string; summary: string }> = {
  FALSE_COMPLETION: {
    title: 'Premature AI Approval (KYC Mismatch)',
    summary: 'AI says KYC is approved, while the official bank KYC system still shows Pending.',
  },
  NORMAL: {
    title: 'Standard Smooth Onboarding',
    summary: 'All four steps complete and match official records on the first check.',
  },
  API_TIMEOUT: {
    title: 'Slow Partner Response (Timeout)',
    summary: 'Partner system timed out after saving; AgentBridge checks truth instead of duplicating.',
  },
  DUPLICATE_ATTEMPT: {
    title: 'Duplicate Activation Prevented',
    summary: 'Prevents activating the same merchant twice when a retry occurs.',
  },
  DELAYED_CONSISTENCY: {
    title: 'Delayed Partner Sync',
    summary: 'Bank KYC takes a few seconds to update; AgentBridge re-checks automatically.',
  },
  SOURCE_UNAVAILABLE: {
    title: 'Partner System Outage',
    summary: 'Bank KYC system is offline; onboarding pauses safely without failing falsely.',
  },
  HUMAN_APPROVAL: {
    title: 'High-Risk Manager Sign-Off',
    summary: 'High-risk business category pauses for a compliance manager to approve or decline.',
  },
};

export const HUMAN_EVENT_LABELS: Record<string, string> = {
  JOURNEY_CREATED: 'Onboarding started',
  AGENT_STARTED: 'Assistant began step',
  AGENT_COMPLETED: 'Assistant finished step',
  AGENT_FAILED: 'Assistant hit timeout or error',
  EXECUTION_VALIDATED: 'Action permissions confirmed',
  RESPONSE_VALIDATED: 'Assistant output format verified',
  OUTCOME_VERIFICATION_STARTED: 'Checking official system record',
  OUTCOME_VERIFICATION_PASSED: 'Official record confirmed',
  OUTCOME_VERIFICATION_FAILED: 'Mismatch caught against official record',
  WORKFLOW_BLOCKED: 'Next steps paused for safety',
  RETRY_SCHEDULED: 'Automatic re-check scheduled',
  RETRY_EXECUTED: 'Re-checking official record',
  DUPLICATE_BLOCKED: 'Duplicate activation blocked',
  APPROVAL_REQUESTED: 'Sent to manager approval queue',
  APPROVAL_GRANTED: 'Manager approved & resumed',
  APPROVAL_REJECTED: 'Manager declined onboarding',
  SOURCE_SYSTEM_UPDATED: 'Official bank KYC updated to Approved',
  JOURNEY_VERIFIED: 'Merchant fully verified & live',
  JOURNEY_FAILED: 'Onboarding failed',
  JOURNEY_CANCELLED: 'Onboarding cancelled',
};

export const HUMAN_SCENARIO_SHORT_LABELS: Record<JourneyScenario, string> = {
  FALSE_COMPLETION: 'Mismatch',
  NORMAL: 'Smooth',
  API_TIMEOUT: 'Timeout',
  DUPLICATE_ATTEMPT: 'Duplicate',
  DELAYED_CONSISTENCY: 'Delayed Sync',
  SOURCE_UNAVAILABLE: 'Outage',
  HUMAN_APPROVAL: 'Approval',
};

export function humanizeStatus(status: string): string {
  return HUMAN_STATUS_LABELS[status] ?? status.replace(/_/g, ' ');
}

export function humanizeStateValue(val: string | null | undefined): string {
  if (!val) return 'Not Checked Yet';
  return HUMAN_STATE_VALUES[val] ?? val.replace(/_/g, ' ');
}

export function humanizeStateToken(token: string | null | undefined): string {
  if (!token || token === 'NONE') return 'New Case';
  if (HUMAN_STATUS_LABELS[token]) return HUMAN_STATUS_LABELS[token];
  if (HUMAN_STATE_VALUES[token]) return HUMAN_STATE_VALUES[token];
  return token
    .toLowerCase()
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
    .join(' ');
}

export function humanizeBlockedReason(reason: string): string {
  return reason
    .replace(/KYC_APPROVED/g, 'KYC Approved')
    .replace(/KYC_PENDING/g, 'KYC Still Pending')
    .replace(/KYC_NOT_FOUND/g, 'No KYC Record Found')
    .replace(/RISK_CLEARED/g, 'Risk Check Cleared')
    .replace(/RISK_REVIEW_REQUIRED/g, 'Manual Risk Review Needed')
    .replace(/PROFILE_CREATED/g, 'Merchant Profile Created')
    .replace(/NOT_ACTIVATED/g, 'Not Activated Yet')
    .replace(/ACTIVATED/g, 'Account Activated')
    .replace(/Authoritative KYC API/g, 'Bank KYC System')
    .replace(/Authoritative /g, 'Official ')
    .replace(/Operations stage blocked\./g, 'Account activation has been paused until confirmed.')
    .replace(/Claim \(([^)]+)\) != Source \(([^)]+)\)\./g, 'AI Assistant claimed $1, while the official system shows $2.');
}

