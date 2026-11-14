import { createHash } from 'node:crypto';
import type { OutcomeVerificationInput, OutcomeVerificationResult, OutcomeVerifier } from '../core/types';
import { store } from './store';

function makeEvidenceId(prefix: string): string {
  return `evd_${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function shaShort(obj: unknown): string {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
}

export class MerchantSystemVerifier implements OutcomeVerifier {
  async verify(input: OutcomeVerificationInput): Promise<OutcomeVerificationResult> {
    const state = store.getState();
    const integration = state.integrations.find((i) => i.id === 'int_merchant_api');
    const checkedAt = new Date().toISOString();

    if (integration?.status === 'OUTAGE') {
      return {
        verified: false,
        unavailable: true,
        actualState: 'SOURCE_503_UNAVAILABLE',
        sourceSystem: 'Authoritative Merchant API',
        evidenceReference: makeEvidenceId('mrc_err'),
        payloadHash: shaShort({ error: 503, merchantReference: input.merchantReference }),
        redactedPayload: { status: 503, error: 'UPSTREAM_TIMEOUT' },
        checkedAt,
        reason: 'Authoritative Merchant API returned 503 Service Unavailable.',
      };
    }

    const record = state.authoritative.merchants[input.merchantReference];
    const actualState = record ? record.status : 'NOT_FOUND';
    const verified = actualState === input.expectedState;
    const payload = {
      merchantReference: input.merchantReference,
      status: actualState,
      updatedAt: record?.updatedAt ?? checkedAt,
    };

    return {
      verified,
      actualState,
      sourceSystem: 'Authoritative Merchant API',
      evidenceReference: makeEvidenceId('mrc'),
      payloadHash: shaShort(payload),
      redactedPayload: payload,
      checkedAt,
    };
  }
}

export class KycSystemVerifier implements OutcomeVerifier {
  async verify(input: OutcomeVerificationInput): Promise<OutcomeVerificationResult> {
    const state = store.getState();
    const integration = state.integrations.find((i) => i.id === 'int_kyc_api');
    const checkedAt = new Date().toISOString();

    if (integration?.status === 'OUTAGE') {
      return {
        verified: false,
        unavailable: true,
        actualState: 'SOURCE_503_UNAVAILABLE',
        sourceSystem: 'Authoritative KYC API',
        evidenceReference: makeEvidenceId('kyc_err'),
        payloadHash: shaShort({ error: 503, merchantReference: input.merchantReference }),
        redactedPayload: { status: 503, error: 'KYC_GATEWAY_UNAVAILABLE' },
        checkedAt,
        reason: 'Authoritative KYC API is unreachable (503). Holding verification pending recovery.',
      };
    }

    const record = state.authoritative.kyc[input.merchantReference];
    if (record) {
      record.checkCount += 1;
      if (
        record.status === 'KYC_PENDING' &&
        record.autoApproveAfterChecks !== null &&
        record.checkCount >= record.autoApproveAfterChecks
      ) {
        record.status = 'KYC_APPROVED';
        record.updatedAt = checkedAt;
        store.persist();
      }
    }

    const actualState = record ? record.status : 'KYC_NOT_FOUND';
    const verified = actualState === input.expectedState;
    const payload = {
      merchantReference: input.merchantReference,
      status: actualState,
      checkCount: record?.checkCount ?? 0,
      updatedAt: record?.updatedAt ?? checkedAt,
    };

    return {
      verified,
      actualState,
      sourceSystem: 'Authoritative KYC API',
      evidenceReference: makeEvidenceId('kyc'),
      payloadHash: shaShort(payload),
      redactedPayload: payload,
      checkedAt,
      reason: verified
        ? undefined
        : `Authoritative KYC API reports ${actualState}; required state is ${input.expectedState}.`,
    };
  }
}

export class RiskSystemVerifier implements OutcomeVerifier {
  async verify(input: OutcomeVerificationInput): Promise<OutcomeVerificationResult> {
    const state = store.getState();
    const integration = state.integrations.find((i) => i.id === 'int_risk_api');
    const checkedAt = new Date().toISOString();

    if (integration?.status === 'OUTAGE') {
      return {
        verified: false,
        unavailable: true,
        actualState: 'SOURCE_503_UNAVAILABLE',
        sourceSystem: 'Authoritative Risk Engine API',
        evidenceReference: makeEvidenceId('rsk_err'),
        payloadHash: shaShort({ error: 503 }),
        redactedPayload: { status: 503, error: 'RISK_ENGINE_TIMEOUT' },
        checkedAt,
      };
    }

    const record = state.authoritative.risk[input.merchantReference];
    const actualState = record ? record.status : 'RISK_PENDING';
    const verified = actualState === input.expectedState;
    const payload = {
      merchantReference: input.merchantReference,
      status: actualState,
      score: record?.score ?? null,
      updatedAt: record?.updatedAt ?? checkedAt,
    };

    return {
      verified,
      actualState,
      sourceSystem: 'Authoritative Risk Engine API',
      evidenceReference: makeEvidenceId('rsk'),
      payloadHash: shaShort(payload),
      redactedPayload: payload,
      checkedAt,
    };
  }
}

export class ActivationSystemVerifier implements OutcomeVerifier {
  async verify(input: OutcomeVerificationInput): Promise<OutcomeVerificationResult> {
    const state = store.getState();
    const integration = state.integrations.find((i) => i.id === 'int_activation_api');
    const checkedAt = new Date().toISOString();

    if (integration?.status === 'OUTAGE') {
      return {
        verified: false,
        unavailable: true,
        actualState: 'SOURCE_503_UNAVAILABLE',
        sourceSystem: 'Authoritative Activation API',
        evidenceReference: makeEvidenceId('act_err'),
        payloadHash: shaShort({ error: 503 }),
        redactedPayload: { status: 503, error: 'ACTIVATION_GATEWAY_DOWN' },
        checkedAt,
      };
    }

    const record = state.authoritative.activations[input.merchantReference];
    const actualState = record ? record.status : 'NOT_ACTIVATED';
    const verified = actualState === input.expectedState;
    const payload = {
      merchantReference: input.merchantReference,
      status: actualState,
      activationCode: record?.activationCode ?? null,
      idempotencyKey: record?.idempotencyKey ?? null,
      updatedAt: record?.updatedAt ?? checkedAt,
    };

    return {
      verified,
      actualState,
      sourceSystem: 'Authoritative Activation API',
      evidenceReference: makeEvidenceId('act'),
      payloadHash: shaShort(payload),
      redactedPayload: payload,
      checkedAt,
    };
  }
}

export const verifiers = {
  merchant: new MerchantSystemVerifier(),
  kyc: new KycSystemVerifier(),
  risk: new RiskSystemVerifier(),
  activation: new ActivationSystemVerifier(),
};
