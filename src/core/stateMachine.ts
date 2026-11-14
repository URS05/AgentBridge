import type { JourneyStatus, StageStatus } from './types';

const VALID_STAGE_TRANSITIONS: Record<StageStatus, StageStatus[]> = {
  NOT_STARTED: ['RUNNING', 'BLOCKED', 'CANCELLED'],
  RUNNING: ['REPORTED_SUCCESS', 'VERIFYING', 'FAILED', 'SOURCE_UNAVAILABLE', 'NEEDS_HUMAN', 'CANCELLED'],
  REPORTED_SUCCESS: ['VERIFYING', 'FAILED', 'CANCELLED'],
  VERIFYING: ['VERIFIED', 'MISMATCH', 'SOURCE_UNAVAILABLE', 'NEEDS_HUMAN', 'FAILED'],
  VERIFIED: ['COMPLETED'],
  MISMATCH: ['BLOCKED', 'VERIFYING', 'NEEDS_HUMAN'],
  BLOCKED: ['VERIFYING', 'RUNNING', 'NEEDS_HUMAN', 'CANCELLED', 'FAILED'],
  SOURCE_UNAVAILABLE: ['VERIFICATION_PENDING', 'VERIFYING', 'NEEDS_HUMAN'],
  VERIFICATION_PENDING: ['VERIFYING', 'VERIFIED', 'MISMATCH', 'NEEDS_HUMAN', 'FAILED'],
  NEEDS_HUMAN: ['VERIFYING', 'VERIFIED', 'RUNNING', 'FAILED', 'CANCELLED'],
  FAILED: ['VERIFYING', 'RUNNING'],
  CANCELLED: [],
  COMPLETED: [],
};

export function canTransitionStage(from: StageStatus, to: StageStatus): boolean {
  if (from === to) return true;
  return VALID_STAGE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function transitionStageStatus(from: StageStatus, to: StageStatus): StageStatus {
  if (!canTransitionStage(from, to)) {
    throw new Error(`Invalid stage transition from ${from} to ${to}`);
  }
  return to;
}

export function calculateBackoffDelayMs(attempt: number, baseMs = 500, maxMs = 15000): number {
  const safeAttempt = Math.max(0, attempt);
  const delay = baseMs * Math.pow(2, safeAttempt);
  return Math.min(delay, maxMs);
}

export function deriveJourneyStatus(stages: Array<{ status: StageStatus }>): JourneyStatus {
  if (stages.some((s) => s.status === 'CANCELLED')) return 'CANCELLED';
  if (stages.some((s) => s.status === 'FAILED')) return 'FAILED';
  if (stages.some((s) => s.status === 'NEEDS_HUMAN')) return 'NEEDS_HUMAN';
  if (stages.some((s) => s.status === 'MISMATCH' || s.status === 'BLOCKED')) return 'BLOCKED';
  if (stages.some((s) => s.status === 'SOURCE_UNAVAILABLE' || s.status === 'VERIFICATION_PENDING')) {
    return 'VERIFICATION_PENDING';
  }
  if (stages.every((s) => s.status === 'VERIFIED' || s.status === 'COMPLETED')) {
    return 'VERIFIED';
  }
  return 'RUNNING';
}
