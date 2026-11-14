import { AlertTriangle, ArrowRight, CheckCircle2, Clock, ShieldAlert } from 'lucide-react';
import type { A2AHandoff } from '../../core/types';
import { HUMAN_STAGE_LABELS } from '../humanCopy';
import { Badge } from '@/components/ui/badge';

function OutcomePill({ outcome }: { outcome: A2AHandoff['outcome'] }) {
  if (outcome === 'VERIFIED') {
    return (
      <Badge variant="outline" className="gap-1 text-[10px] border-[#00B074]/30 bg-[#00B074]/10 text-[#047857] dark:text-[#2DD4A4]">
        <CheckCircle2 className="w-3 h-3" />
        Verified
      </Badge>
    );
  }
  if (outcome === 'MISMATCH') {
    return (
      <Badge variant="outline" className="gap-1 text-[10px] border-[#DC2626]/30 bg-[#DC2626]/10 text-[#B91C1C] dark:text-[#F16C70]">
        <ShieldAlert className="w-3 h-3" />
        Mismatch
      </Badge>
    );
  }
  if (outcome === 'TIMEOUT') {
    return (
      <Badge variant="outline" className="gap-1 text-[10px] border-[#D97706]/30 bg-[#D97706]/10 text-[#B45309] dark:text-[#F5B84B]">
        <Clock className="w-3 h-3" />
        Timeout / 503
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-[10px] border-[#D97706]/30 bg-[#D97706]/10 text-[#B45309] dark:text-[#F5B84B]">
      <AlertTriangle className="w-3 h-3" />
      {outcome === 'ESCALATED' ? 'Escalated' : 'Pending'}
    </Badge>
  );
}

export function A2AHandoffWaterfall({ handoffs }: { handoffs: A2AHandoff[] }) {
  if (!handoffs || handoffs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
        No Agent-to-Agent handoffs recorded yet for this onboarding.
      </div>
    );
  }

  const maxSpan = Math.max(
    120,
    ...handoffs.map((h) => h.a2aHopMs + h.officialVerifyMs)
  );

  return (
    <div className="space-y-3">
      {handoffs.map((hop) => {
        const totalMs = hop.a2aHopMs + hop.officialVerifyMs;
        const a2aWidth = Math.max(8, Math.round((hop.a2aHopMs / maxSpan) * 100));
        const verifyWidth = Math.max(6, Math.round((hop.officialVerifyMs / maxSpan) * 100));

        return (
          <div
            key={hop.id}
            className="rounded-lg border border-border bg-background p-3 space-y-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground min-w-0">
                <span>{hop.fromAgent}</span>
                <ArrowRight className="w-3.5 h-3.5 text-[#0095D9] shrink-0" />
                <span>{hop.toAgent}</span>
                <span className="text-[11px] font-normal text-muted-foreground hidden sm:inline">
                  · {HUMAN_STAGE_LABELS[hop.stageName] ?? hop.stageName}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] font-mono tabular-nums text-muted-foreground">
                  {totalMs} ms
                </span>
                <OutcomePill outcome={hop.outcome} />
              </div>
            </div>

            {/* Proportional timing bar: A2A Handoff vs Official Verification Gate */}
            <div className="space-y-1">
              <div className="h-2 w-full rounded-full bg-secondary overflow-hidden flex">
                <div
                  className="h-full bg-[#0095D9]"
                  style={{ width: `${Math.min(70, a2aWidth)}%` }}
                  title={`A2A Agent Handoff: ${hop.a2aHopMs}ms`}
                />
                <div
                  className={`h-full ${
                    hop.outcome === 'MISMATCH'
                      ? 'bg-[#DC2626]'
                      : hop.outcome === 'TIMEOUT' || hop.outcome === 'ESCALATED'
                        ? 'bg-[#D97706]'
                        : 'bg-[#002E6E] dark:bg-[#00B9F1]'
                  }`}
                  style={{ width: `${Math.min(50, verifyWidth)}%` }}
                  title={`Official System Check: ${hop.officialVerifyMs}ms`}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
                <span>A2A Handoff: {hop.a2aHopMs} ms</span>
                <span>Official Gate Check: {hop.officialVerifyMs} ms</span>
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">{hop.payloadSummary}</p>

            {(hop.passedFields.length > 0 || hop.flaggedFields.length > 0) && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {hop.passedFields.map((field) => (
                  <span
                    key={field}
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-secondary text-muted-foreground"
                  >
                    {field}
                  </span>
                ))}
                {hop.flaggedFields.map((field) => (
                  <span
                    key={field}
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#DC2626]/10 text-[#B91C1C] dark:text-[#F16C70]"
                  >
                    {field}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
