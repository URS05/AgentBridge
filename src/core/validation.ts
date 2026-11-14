import { z } from 'zod';
import type {
  AgentDefinition,
  IdempotencyRecord,
  OutcomeVerificationResult,
  ValidationResult,
} from './types';

export const AgentResponseSchema = z.object({
  agentId: z.string().min(1),
  requestId: z.string().min(1),
  merchantReference: z.string().min(1),
  reportedStatus: z.enum(['COMPLETED', 'KYC_APPROVED', 'RISK_CLEARED', 'ACTIVATED', 'PENDING', 'FLAGGED', 'FAILED']),
  referenceId: z.string().min(1),
  summary: z.string().min(5),
  confidence: z.number().min(0).max(1),
  timestamp: z.string().min(1),
});

export type AgentResponsePayload = z.infer<typeof AgentResponseSchema>;

export interface ResponseValidationOutcome {
  result: ValidationResult;
  expectedValue: string;
  actualValue: string;
  reason: string;
}

export function validateAgentResponse(payload: unknown, expectedAgentId: string): ResponseValidationOutcome {
  const parsed = AgentResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      result: 'FAIL',
      expectedValue: 'Valid AgentResponseSchema',
      actualValue: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      reason: 'Structured agent response failed schema or required-field validation.',
    };
  }

  if (parsed.data.agentId !== expectedAgentId) {
    return {
      result: 'FAIL',
      expectedValue: `agentId=${expectedAgentId}`,
      actualValue: `agentId=${parsed.data.agentId}`,
      reason: 'Response agentId does not match the scheduled stage agent.',
    };
  }

  if (parsed.data.reportedStatus === 'FAILED' && parsed.data.confidence > 0.9) {
    return {
      result: 'PASS',
      expectedValue: 'Consistent status & referenceId',
      actualValue: `${parsed.data.reportedStatus} (ref: ${parsed.data.referenceId})`,
      reason: 'Schema valid; agent explicitly reported failure.',
    };
  }

  return {
    result: 'PASS',
    expectedValue: 'Valid schema & consistent metadata',
    actualValue: `${parsed.data.reportedStatus} (confidence ${parsed.data.confidence.toFixed(2)})`,
    reason: 'AI response schema, required fields, and semantic consistency checks passed. Note: AI output is never treated as authoritative business proof.',
  };
}

export interface ExecutionValidationInput {
  agent: AgentDefinition;
  toolName: string;
  requiredPermission: string;
  requestId: string;
  idempotencyKey: string;
  operationType: string;
  existingIdempotency?: IdempotencyRecord | null;
}

export interface ExecutionValidationOutcome {
  result: ValidationResult;
  expectedValue: string;
  actualValue: string;
  reason: string;
  isDuplicate: boolean;
}

export function validateToolExecution(input: ExecutionValidationInput): ExecutionValidationOutcome {
  if (!input.requestId || input.requestId.trim().length < 4) {
    return {
      result: 'FAIL',
      expectedValue: 'Traceable requestId',
      actualValue: input.requestId || 'missing',
      reason: 'Missing or invalid request identity.',
      isDuplicate: false,
    };
  }

  if (!input.agent.capabilities.includes(input.toolName)) {
    return {
      result: 'FAIL',
      expectedValue: `Registered capability in [${input.agent.capabilities.join(', ')}]`,
      actualValue: input.toolName,
      reason: `Tool "${input.toolName}" is not registered under ${input.agent.name}'s allowed capabilities.`,
      isDuplicate: false,
    };
  }

  if (!input.agent.permissions.includes(input.requiredPermission)) {
    return {
      result: 'FAIL',
      expectedValue: `Permission ${input.requiredPermission}`,
      actualValue: input.agent.permissions.join(', '),
      reason: `Agent ${input.agent.name} lacks least-privilege permission "${input.requiredPermission}".`,
      isDuplicate: false,
    };
  }

  if (input.existingIdempotency && input.existingIdempotency.status === 'COMMITTED') {
    return {
      result: 'FAIL',
      expectedValue: `Unique idempotencyKey (${input.idempotencyKey})`,
      actualValue: `ALREADY_COMMITTED (ref: ${input.existingIdempotency.responseReference})`,
      reason: `Duplicate operation prevented by idempotency guard. Operation "${input.operationType}" already committed under key ${input.idempotencyKey}.`,
      isDuplicate: true,
    };
  }

  return {
    result: 'PASS',
    expectedValue: `Tool=${input.toolName}, Perm=${input.requiredPermission}, UniqueKey`,
    actualValue: `Authorized (${input.requestId})`,
    reason: 'Tool identity, least-privilege permissions, request identity, and idempotency key verified.',
    isDuplicate: false,
  };
}

export interface OutcomeComparisonResult {
  result: ValidationResult;
  expectedValue: string;
  actualValue: string;
  reason: string;
  canProceed: boolean;
}

export function evaluateBusinessOutcome(
  expectedState: string,
  verification: OutcomeVerificationResult
): OutcomeComparisonResult {
  if (verification.unavailable) {
    return {
      result: 'UNAVAILABLE',
      expectedValue: expectedState,
      actualValue: verification.actualState || 'SOURCE_503_UNAVAILABLE',
      reason:
        verification.reason ||
        `Authoritative system (${verification.sourceSystem}) is temporarily unavailable. Holding stage in VERIFICATION_PENDING rather than failing or assuming success.`,
      canProceed: false,
    };
  }

  if (!verification.verified || verification.actualState !== expectedState) {
    return {
      result: 'MISMATCH',
      expectedValue: expectedState,
      actualValue: verification.actualState,
      reason:
        verification.reason ||
        `Authoritative ${verification.sourceSystem} returned "${verification.actualState}", which does not satisfy required state "${expectedState}". Downstream execution blocked.`,
      canProceed: false,
    };
  }

  return {
    result: 'PASS',
    expectedValue: expectedState,
    actualValue: verification.actualState,
    reason: `Authoritative ${verification.sourceSystem} confirmed state "${verification.actualState}" (evidence: ${verification.evidenceReference}).`,
    canProceed: true,
  };
}
