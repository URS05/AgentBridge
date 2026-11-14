import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  ShieldAlert,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { humanizeStatus } from '../humanCopy';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

function resolveTone(status: string): Tone {
  const s = status.toUpperCase();
  if (['VERIFIED', 'PASS', 'COMPLETED', 'APPROVED', 'HEALTHY', 'SUCCESS', 'COMMITTED', 'GOOD_TO_GO'].includes(s)) {
    return 'success';
  }
  if (['BLOCKED', 'MISMATCH', 'FAIL', 'FAILED', 'REJECTED', 'OUTAGE', 'CRITICAL', 'HIGH', 'OFFLINE'].includes(s)) {
    return 'danger';
  }
  if (
    [
      'NEEDS_HUMAN',
      'VERIFICATION_PENDING',
      'SOURCE_UNAVAILABLE',
      'UNAVAILABLE',
      'PENDING',
      'DEGRADED',
      'TIMEOUT',
      'EVIDENCE_REQUESTED',
      'ESCALATED',
      'MEDIUM',
      'ATTENTION_NEEDED',
    ].includes(s)
  ) {
    return 'warning';
  }
  if (['RUNNING', 'VERIFYING', 'REPORTED_SUCCESS', 'IN_PROGRESS'].includes(s)) {
    return 'info';
  }
  return 'neutral';
}

function StatusIcon({ tone, status }: { tone: Tone; status: string }) {
  const s = status.toUpperCase();
  const cls = 'w-3.5 h-3.5 shrink-0';
  if (s === 'RUNNING' || s === 'VERIFYING') return <Loader2 className={`${cls} animate-spin`} />;
  if (s === 'NEEDS_HUMAN') return <UserCheck className={cls} />;
  if (tone === 'success') return <CheckCircle2 className={cls} />;
  if (tone === 'danger') return <ShieldAlert className={cls} />;
  if (tone === 'warning') return <AlertTriangle className={cls} />;
  if (s === 'CANCELLED') return <XCircle className={cls} />;
  return <Clock className={cls} />;
}

const TONE_CLASSES: Record<Tone, string> = {
  success:
    'border-[#00B074]/25 bg-[#00B074]/10 text-[#047857] dark:border-[#2DD4A4]/30 dark:bg-[#2DD4A4]/15 dark:text-[#2DD4A4]',
  danger:
    'border-[#DC2626]/25 bg-[#DC2626]/10 text-[#B91C1C] dark:border-[#F16C70]/30 dark:bg-[#F16C70]/15 dark:text-[#F16C70]',
  warning:
    'border-[#D97706]/25 bg-[#D97706]/10 text-[#B45309] dark:border-[#F5B84B]/30 dark:bg-[#F5B84B]/15 dark:text-[#F5B84B]',
  info:
    'border-[#0095D9]/25 bg-[#E6F7FD] text-[#002E6E] dark:border-[#00B9F1]/30 dark:bg-[#00B9F1]/15 dark:text-[#00B9F1]',
  neutral:
    'border-border bg-secondary text-muted-foreground',
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const tone = resolveTone(status);
  const display = label ?? humanizeStatus(status);
  return (
    <Badge
      variant="outline"
      className={`gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium whitespace-nowrap shrink-0 ${TONE_CLASSES[tone]}`}
    >
      <StatusIcon tone={tone} status={status} />
      <span>{display}</span>
    </Badge>
  );
}
