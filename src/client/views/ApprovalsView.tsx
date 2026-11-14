import { useEffect, useState } from 'react';
import { ArrowRight, Check, FileQuestion, ShieldAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import type { ApprovalRequest } from '../../core/types';
import { api } from '../api';
import { HUMAN_STAGE_LABELS } from '../humanCopy';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

export function ApprovalsView({
  refreshKey,
  onNavigate,
  onChanged,
}: {
  refreshKey: number;
  onNavigate: (path: string) => void;
  onChanged: () => void;
}) {
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api
      .getApprovals()
      .then((res) => setApprovals(res.approvals))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [refreshKey]);

  async function handleDecision(
    approvalId: string,
    decision: 'APPROVED' | 'REJECTED' | 'EVIDENCE_REQUESTED' | 'ESCALATED'
  ) {
    const reason = (reasons[approvalId] ?? '').trim();
    if (reason.length < 5) {
      toast.error('Please enter a short note explaining your decision (at least 5 characters).');
      return;
    }

    setBusyId(approvalId);
    try {
      await api.decideApproval(approvalId, {
        decision,
        reviewer: 'Compliance Ops Lead',
        reason,
      });
      toast.success(`Decision saved: ${decision.replace(/_/g, ' ')}`);
      load();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to record decision');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Manager Approval Queue</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          High-risk merchants pause here for human sign-off before account activation proceeds.
        </p>
      </div>

      {loading ? (
        <Skeleton className="h-44 rounded-xl" />
      ) : approvals.length === 0 ? (
        <Card className="p-10 text-center text-xs text-muted-foreground shadow-none">
          No merchants are waiting for approval right now.
        </Card>
      ) : (
        <div className="space-y-4">
          {approvals.map((apr) => {
            const isPending =
              apr.status === 'PENDING' || apr.status === 'EVIDENCE_REQUESTED' || apr.status === 'ESCALATED';
            return (
              <Card key={apr.id} className="py-5 gap-4 shadow-none">
                <CardContent className="px-5 py-0 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2.5">
                        <h2 className="text-base font-semibold text-foreground">{apr.merchantName}</h2>
                        <StatusBadge status={apr.status} />
                        <StatusBadge status={apr.riskLevel} />
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Step: {HUMAN_STAGE_LABELS[apr.stageName] ?? apr.stageName} · Assigned to {apr.assignedReviewer}
                      </div>
                    </div>
                    <Button size="xs" variant="outline" onClick={() => onNavigate(`/journeys/${apr.journeyId}`)}>
                      <span>View Case</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Button>
                  </div>

                  <div className="rounded-lg bg-background border border-border p-3.5 text-xs space-y-1">
                    <div className="font-medium text-foreground">{apr.requestedAction}</div>
                    <div className="text-muted-foreground">{apr.reason}</div>
                  </div>

                  {isPending ? (
                    <div className="space-y-3 pt-1">
                      <div className="space-y-1.5">
                        <Label htmlFor={`reason-${apr.id}`} className="text-xs font-medium">
                          Decision Note (Required)
                        </Label>
                        <Input
                          id={`reason-${apr.id}`}
                          value={reasons[apr.id] ?? ''}
                          onChange={(e) => setReasons((prev) => ({ ...prev, [apr.id]: e.target.value }))}
                          placeholder="e.g. Verified GST certificate and storefront photos."
                          className="bg-background"
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          disabled={busyId === apr.id}
                          onClick={() => handleDecision(apr.id, 'APPROVED')}
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Approve &amp; Continue Onboarding</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={busyId === apr.id}
                          onClick={() => handleDecision(apr.id, 'REJECTED')}
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>Decline</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === apr.id}
                          onClick={() => handleDecision(apr.id, 'EVIDENCE_REQUESTED')}
                        >
                          <FileQuestion className="w-3.5 h-3.5" />
                          <span>Request Documents</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === apr.id}
                          onClick={() => handleDecision(apr.id, 'ESCALATED')}
                        >
                          <ShieldAlert className="w-3.5 h-3.5" />
                          <span>Escalate</span>
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="pt-2 border-t border-border text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-2">
                      <span>
                        Reviewed by <strong className="text-foreground">{apr.reviewedBy}</strong>: {apr.decisionReason}
                      </span>
                      <span className="tabular-nums text-[11px]">
                        {apr.resolvedAt ? new Date(apr.resolvedAt).toLocaleString() : ''}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
