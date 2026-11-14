import { createHash } from 'node:crypto';
import type { AuditEvent, AuditEventType } from './types';

export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

export function computeAuditEventHash(params: {
  sequence: number;
  journeyId: string;
  correlationId: string;
  actorType: string;
  actorId: string;
  eventType: AuditEventType;
  previousState: string;
  newState: string;
  evidenceReference: string | null;
  metadata: Record<string, unknown>;
  previousHash: string;
  createdAt: string;
}): string {
  const canonical = JSON.stringify({
    sequence: params.sequence,
    journeyId: params.journeyId,
    correlationId: params.correlationId,
    actorType: params.actorType,
    actorId: params.actorId,
    eventType: params.eventType,
    previousState: params.previousState,
    newState: params.newState,
    evidenceReference: params.evidenceReference,
    metadata: params.metadata,
    previousHash: params.previousHash,
    createdAt: params.createdAt,
  });

  return createHash('sha256').update(canonical).digest('hex');
}

export function createAuditEvent(params: {
  id: string;
  sequence: number;
  journeyId: string;
  correlationId: string;
  actorType: AuditEvent['actorType'];
  actorId: string;
  eventType: AuditEventType;
  previousState: string;
  newState: string;
  evidenceReference?: string | null;
  metadata?: Record<string, unknown>;
  previousHash: string;
  createdAt?: string;
}): AuditEvent {
  const createdAt = params.createdAt ?? new Date().toISOString();
  const evidenceReference = params.evidenceReference ?? null;
  const metadata = params.metadata ?? {};
  const eventHash = computeAuditEventHash({
    sequence: params.sequence,
    journeyId: params.journeyId,
    correlationId: params.correlationId,
    actorType: params.actorType,
    actorId: params.actorId,
    eventType: params.eventType,
    previousState: params.previousState,
    newState: params.newState,
    evidenceReference,
    metadata,
    previousHash: params.previousHash,
    createdAt,
  });

  return {
    id: params.id,
    sequence: params.sequence,
    journeyId: params.journeyId,
    correlationId: params.correlationId,
    actorType: params.actorType,
    actorId: params.actorId,
    eventType: params.eventType,
    previousState: params.previousState,
    newState: params.newState,
    evidenceReference,
    metadata,
    previousHash: params.previousHash,
    eventHash,
    createdAt,
  };
}

export interface AuditChainVerificationResult {
  valid: boolean;
  totalEvents: number;
  brokenAtEventId: string | null;
  brokenSequence: number | null;
  reason: string;
}

export function verifyAuditChain(events: AuditEvent[]): AuditChainVerificationResult {
  if (events.length === 0) {
    return {
      valid: true,
      totalEvents: 0,
      brokenAtEventId: null,
      brokenSequence: null,
      reason: 'Audit ledger is empty.',
    };
  }

  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  let expectedPrevHash = GENESIS_HASH;

  for (const evt of sorted) {
    if (evt.previousHash !== expectedPrevHash) {
      return {
        valid: false,
        totalEvents: sorted.length,
        brokenAtEventId: evt.id,
        brokenSequence: evt.sequence,
        reason: `Previous hash mismatch at sequence ${evt.sequence} (${evt.id}).`,
      };
    }

    const recomputed = computeAuditEventHash({
      sequence: evt.sequence,
      journeyId: evt.journeyId,
      correlationId: evt.correlationId,
      actorType: evt.actorType,
      actorId: evt.actorId,
      eventType: evt.eventType,
      previousState: evt.previousState,
      newState: evt.newState,
      evidenceReference: evt.evidenceReference,
      metadata: evt.metadata,
      previousHash: evt.previousHash,
      createdAt: evt.createdAt,
    });

    if (recomputed !== evt.eventHash) {
      return {
        valid: false,
        totalEvents: sorted.length,
        brokenAtEventId: evt.id,
        brokenSequence: evt.sequence,
        reason: `Payload digest mismatch at sequence ${evt.sequence} (${evt.id}).`,
      };
    }

    expectedPrevHash = evt.eventHash;
  }

  return {
    valid: true,
    totalEvents: sorted.length,
    brokenAtEventId: null,
    brokenSequence: null,
    reason: `All ${sorted.length} audit events verified cleanly against SHA-256 hash chain.`,
  };
}

export function verifyJourneyAuditChain(
  events: AuditEvent[],
  journeyId: string
): AuditChainVerificationResult {
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  const journeyEvents = sorted.filter((e) => e.journeyId === journeyId);
  if (journeyEvents.length === 0) {
    return {
      valid: true,
      totalEvents: 0,
      brokenAtEventId: null,
      brokenSequence: null,
      reason: `No audit events recorded for journey ${journeyId}.`,
    };
  }

  for (const evt of journeyEvents) {
    const recomputed = computeAuditEventHash({
      sequence: evt.sequence,
      journeyId: evt.journeyId,
      correlationId: evt.correlationId,
      actorType: evt.actorType,
      actorId: evt.actorId,
      eventType: evt.eventType,
      previousState: evt.previousState,
      newState: evt.newState,
      evidenceReference: evt.evidenceReference,
      metadata: evt.metadata,
      previousHash: evt.previousHash,
      createdAt: evt.createdAt,
    });

    if (recomputed !== evt.eventHash) {
      return {
        valid: false,
        totalEvents: journeyEvents.length,
        brokenAtEventId: evt.id,
        brokenSequence: evt.sequence,
        reason: `Payload digest mismatch at sequence ${evt.sequence} (${evt.id}).`,
      };
    }

    const idx = sorted.findIndex((e) => e.id === evt.id);
    const expectedPrev = idx === 0 ? GENESIS_HASH : sorted[idx - 1].eventHash;
    if (evt.previousHash !== expectedPrev) {
      return {
        valid: false,
        totalEvents: journeyEvents.length,
        brokenAtEventId: evt.id,
        brokenSequence: evt.sequence,
        reason: `Previous hash link mismatch at sequence ${evt.sequence} (${evt.id}).`,
      };
    }
  }

  return {
    valid: true,
    totalEvents: journeyEvents.length,
    brokenAtEventId: null,
    brokenSequence: null,
    reason: `All ${journeyEvents.length} events for ${journeyId} verified cleanly against SHA-256 chain.`,
  };
}
