import type {
  ApprovalRequest,
  IssueCluster,
  Journey,
  JourneyStage,
  LatencyPercentiles,
  StageName,
} from './types';

export function deriveClusterKey(journey: Journey): string {
  if (journey.clusterKey) return journey.clusterKey;
  if (journey.status === 'NEEDS_HUMAN' || journey.scenario === 'HUMAN_APPROVAL') {
    return 'HIGH_RISK_COMPLIANCE_APPROVAL';
  }
  if (journey.status === 'VERIFICATION_PENDING') {
    if (journey.scenario === 'SOURCE_UNAVAILABLE') {
      return 'PARTNER_KYC_OUTAGE';
    }
    return 'DELAYED_BANK_SYNC';
  }
  if (journey.status === 'BLOCKED') {
    if (journey.currentStage === 'KYC_VERIFICATION' || journey.scenario === 'FALSE_COMPLETION') {
      return 'KYC_PREMATURE_CLAIM';
    }
    if (journey.currentStage === 'OPERATIONS_ACTIVATION') {
      return 'DUPLICATE_ACTIVATION_LOCK';
    }
    return `BLOCKED_${journey.currentStage}`;
  }
  if (journey.status === 'FAILED') {
    if (journey.scenario === 'API_TIMEOUT') {
      return 'A2A_GATEWAY_TIMEOUT';
    }
    return `FAILED_${journey.currentStage}`;
  }
  return `ACTIVE_${journey.currentStage}`;
}

interface ClusterMeta {
  title: string;
  plainSummary: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  stageName: StageName;
  actionType: IssueCluster['actionType'];
  actionLabel: string;
}

function getClusterMeta(key: string, journey: Journey): ClusterMeta {
  switch (key) {
    case 'KYC_PREMATURE_CLAIM':
      return {
        title: 'AI Assistant claimed KYC Approved while Bank KYC is Pending',
        plainSummary:
          'Account activation is safely paused until the official Bank KYC ledger confirms approval.',
        severity: 'CRITICAL',
        stageName: 'KYC_VERIFICATION',
        actionType: 'CONFIRM_KYC_BULK',
        actionLabel: 'Confirm Bank KYC & Resume',
      };
    case 'HIGH_RISK_COMPLIANCE_APPROVAL':
      return {
        title: 'High-Risk Category Needs Manager Sign-Off',
        plainSummary:
          'Risk score exceeded automated threshold; waiting on a compliance manager decision.',
        severity: 'HIGH',
        stageName: 'RISK_ASSESSMENT',
        actionType: 'OPEN_APPROVALS',
        actionLabel: 'Review in Approvals',
      };
    case 'PARTNER_KYC_OUTAGE':
      return {
        title: 'Partner Bank KYC API Temporarily Unavailable',
        plainSummary:
          'Official KYC check returned 503 offline; onboarding is paused cleanly for safe retry.',
        severity: 'HIGH',
        stageName: 'KYC_VERIFICATION',
        actionType: 'RECHECK_BULK',
        actionLabel: 'Re-check Partner Status',
      };
    case 'DELAYED_BANK_SYNC':
      return {
        title: 'Delayed Partner Ledger Confirmation',
        plainSummary:
          'KYC submission succeeded, waiting for bank registry eventual consistency.',
        severity: 'MEDIUM',
        stageName: 'KYC_VERIFICATION',
        actionType: 'RECHECK_BULK',
        actionLabel: 'Re-check Official Sync',
      };
    case 'A2A_GATEWAY_TIMEOUT':
      return {
        title: 'Agent-to-Agent Gateway Timeout During Handoff',
        plainSummary:
          'Upstream partner API timed out before acknowledgement; checking official state before retrying.',
        severity: 'HIGH',
        stageName: journey.currentStage,
        actionType: 'RECHECK_BULK',
        actionLabel: 'Verify & Retry Safely',
      };
    default:
      return {
        title: `${journey.currentStage.replace(/_/g, ' ')} Needs Attention`,
        plainSummary: journey.blockedReason ?? 'Requires manager verification before continuing.',
        severity: journey.status === 'FAILED' ? 'CRITICAL' : 'MEDIUM',
        stageName: journey.currentStage,
        actionType: 'INSPECT_JOURNEY',
        actionLabel: 'Inspect Merchant',
      };
  }
}

export function groupJourneysIntoTopIssues(
  journeys: Journey[],
  _stages: JourneyStage[],
  approvals: ApprovalRequest[],
  nowMs = Date.now(),
  limit = 5
): IssueCluster[] {
  const actionableStatuses = new Set(['BLOCKED', 'NEEDS_HUMAN', 'VERIFICATION_PENDING', 'FAILED']);
  const actionable = journeys.filter((j) => actionableStatuses.has(j.status));
  if (actionable.length === 0) return [];

  const pendingApprovalByJourney = new Map<string, ApprovalRequest>();
  for (const apr of approvals) {
    if (apr.status === 'PENDING') {
      pendingApprovalByJourney.set(apr.journeyId, apr);
    }
  }

  const buckets = new Map<string, Journey[]>();
  for (const j of actionable) {
    const key = deriveClusterKey(j);
    const list = buckets.get(key);
    if (list) {
      list.push(j);
    } else {
      buckets.set(key, [j]);
    }
  }

  const severityWeight: Record<IssueCluster['severity'], number> = {
    CRITICAL: 3,
    HIGH: 2,
    MEDIUM: 1,
  };

  const clusters: IssueCluster[] = [];

  for (const [clusterKey, items] of buckets.entries()) {
    const sorted = [...items].sort(
      (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
    );
    const oldest = sorted[0];
    const newest = sorted[sorted.length - 1];
    const meta = getClusterMeta(clusterKey, oldest);
    const oldestMs = new Date(oldest.startedAt).getTime();
    const oldestAgeMinutes = Math.max(1, Math.round((nowMs - oldestMs) / 60000));

    // Check if an approval exists with an assigned reviewer or journey has assignedTo
    const primaryApr = pendingApprovalByJourney.get(oldest.id);
    const primaryOwner = oldest.assignedTo ?? (primaryApr?.assignedReviewer && primaryApr.assignedReviewer !== 'Compliance Ops Lead' ? primaryApr.assignedReviewer : null);

    clusters.push({
      clusterKey,
      title: meta.title,
      plainSummary: meta.plainSummary,
      severity: meta.severity,
      stageName: meta.stageName,
      affectedCount: items.length,
      oldestStartedAt: oldest.startedAt,
      oldestAgeMinutes,
      primaryJourneyId: newest.id, // newest or most representative
      primaryMerchantName: items.length === 1 ? oldest.merchantName : `${newest.merchantName} (+${items.length - 1} more)`,
      primaryExternalReference: oldest.externalReference,
      primaryAssignedTo: primaryOwner ?? null,
      sampleJourneys: sorted.slice(0, 5).map((j) => ({
        id: j.id,
        merchantName: j.merchantName,
        externalReference: j.externalReference,
        status: j.status,
        assignedTo: j.assignedTo ?? null,
        startedAt: j.startedAt,
      })),
      actionType: meta.actionType,
      actionLabel: items.length > 1 && meta.actionType === 'CONFIRM_KYC_BULK'
        ? `Confirm Bank KYC & Resume (${items.length})`
        : items.length > 1 && meta.actionType === 'RECHECK_BULK'
          ? `Re-check All (${items.length})`
          : meta.actionLabel,
    });
  }

  clusters.sort((a, b) => {
    const scoreA = severityWeight[a.severity] * 1000 + a.affectedCount * 10 + Math.min(a.oldestAgeMinutes, 500);
    const scoreB = severityWeight[b.severity] * 1000 + b.affectedCount * 10 + Math.min(b.oldestAgeMinutes, 500);
    return scoreB - scoreA;
  });

  return clusters.slice(0, limit);
}

export function computePercentiles(values: number[]): LatencyPercentiles {
  if (values.length === 0) {
    return { p50: 0, p95: 0, p99: 0, avg: 0, count: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (pct: number) => {
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
    return Math.round(sorted[idx]);
  };
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    p50: pick(50),
    p95: pick(95),
    p99: pick(99),
    avg: Math.round(sum / sorted.length),
    count: sorted.length,
  };
}

export interface TimeSeriesBucket {
  bucketLabel: string;
  timestamp: string;
  total: number;
  verified: number;
  mismatches: number;
  timeoutsOrBlocked: number;
  avgLatencyMs: number;
}

export function buildTimeSeriesBuckets(
  journeys: Journey[],
  windowKey: '15m' | '1h' | '24h' | '7d',
  nowMs = Date.now()
): TimeSeriesBucket[] {
  const windowConfig: Record<'15m' | '1h' | '24h' | '7d', { spanMs: number; bucketCount: number; format: 'time' | 'day' }> = {
    '15m': { spanMs: 15 * 60 * 1000, bucketCount: 6, format: 'time' },
    '1h': { spanMs: 60 * 60 * 1000, bucketCount: 8, format: 'time' },
    '24h': { spanMs: 24 * 60 * 60 * 1000, bucketCount: 12, format: 'time' },
    '7d': { spanMs: 7 * 24 * 60 * 60 * 1000, bucketCount: 7, format: 'day' },
  };

  const cfg = windowConfig[windowKey];
  const startMs = nowMs - cfg.spanMs;
  const bucketMs = cfg.spanMs / cfg.bucketCount;

  const buckets = Array.from({ length: cfg.bucketCount }, (_, idx) => {
    const bStart = startMs + idx * bucketMs;
    const d = new Date(bStart);
    const label =
      cfg.format === 'day'
        ? d.toLocaleDateString([], { month: 'short', day: 'numeric' })
        : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return {
      bucketLabel: label,
      timestamp: d.toISOString(),
      total: 0,
      verified: 0,
      mismatches: 0,
      timeoutsOrBlocked: 0,
      latencySum: 0,
      latencyCount: 0,
    };
  });

  for (const j of journeys) {
    const t = new Date(j.startedAt).getTime();
    if (Number.isNaN(t) || t < startMs || t > nowMs + 60000) continue;
    const rawIdx = Math.floor((t - startMs) / bucketMs);
    const idx = Math.min(cfg.bucketCount - 1, Math.max(0, rawIdx));
    const b = buckets[idx];
    b.total += 1;
    if (j.status === 'VERIFIED') b.verified += 1;
    if (j.verificationStatus === 'MISMATCH') b.mismatches += 1;
    if (['BLOCKED', 'FAILED', 'VERIFICATION_PENDING', 'NEEDS_HUMAN'].includes(j.status)) {
      b.timeoutsOrBlocked += 1;
    }
    const lat = j.handoffs?.reduce((s, h) => s + h.a2aHopMs + h.officialVerifyMs, 0) ?? j.durationMs ?? 0;
    if (lat > 0) {
      b.latencySum += lat;
      b.latencyCount += 1;
    }
  }

  return buckets.map((b) => ({
    bucketLabel: b.bucketLabel,
    timestamp: b.timestamp,
    total: b.total,
    verified: b.verified,
    mismatches: b.mismatches,
    timeoutsOrBlocked: b.timeoutsOrBlocked,
    avgLatencyMs: b.latencyCount ? Math.round(b.latencySum / b.latencyCount) : 0,
  }));
}
