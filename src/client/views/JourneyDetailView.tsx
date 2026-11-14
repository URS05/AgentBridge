import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  CopyCheck,
  MessageSquare,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { TEAM_ROSTER } from '../../core/types';
import { api, type JourneyDetailResponse } from '../api';
import {
  HUMAN_EVENT_LABELS,
  HUMAN_SCENARIO_LABELS,
  HUMAN_STAGE_LABELS,
  humanizeBlockedReason,
  humanizeStateToken,
  humanizeStateValue,
  humanizeStatus,
} from '../humanCopy';
import { A2AHandoffWaterfall } from '../components/A2AHandoffWaterfall';
import { JourneyDag } from '../components/JourneyDag';
import { StatusBadge } from '../components/StatusBadge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

export function JourneyDetailView({
  journeyId,
  refreshKey,
  onNavigate,
  onAskWhy,
  onChanged,
}: {
  journeyId: string;
  refreshKey: number;
  onNavigate: (path: string) => void;
  onAskWhy?: (journeyId: string, question: string) => void;
  onChanged?: () => void;
}) {
  const [detail, setDetail] = useState<JourneyDetailResponse | null>(null);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.getJourneyDetail(journeyId);
      setDetail(res);
      setError(null);
      setSelectedStageId((prev) => {
        if (prev && res.stages.some((s) => s.id === prev)) return prev;
        const notable =
          res.stages.find((s) => ['BLOCKED', 'MISMATCH', 'NEEDS_HUMAN', 'VERIFICATION_PENDING'].includes(s.status)) ??
          res.stages[0];
        return notable?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load merchant onboarding');
    }
  }, [journeyId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function handleApproveSourceKyc() {
    setBusyAction('approve-kyc');
    try {
      const { journey } = await api.approveSourceKyc(journeyId);
      toast.success(`Official bank KYC confirmed. Onboarding is now ${humanizeStatus(journey.status)}.`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update KYC');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRecheck() {
    setBusyAction('recheck');
    try {
      const { journey } = await api.recheckJourney(journeyId);
      toast.info(`Re-check finished. Current status: ${humanizeStatus(journey.status)}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Re-check failed');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSimulateDuplicate() {
    setBusyAction('duplicate');
    try {
      const res = await api.simulateDuplicate(journeyId);
      if (res.blocked) {
        toast.success('Duplicate activation safely blocked.');
      } else {
        toast.info(res.message);
      }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Duplicate check failed');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCancel() {
    setBusyAction('cancel');
    try {
      await api.cancelJourney(journeyId);
      toast.info('Onboarding cancelled.');
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not cancel onboarding');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleAssignOwner(value: string | null) {
    const owner = !value || value === 'UNASSIGNED' ? null : value;
    try {
      await api.assignJourneyOwner(journeyId, owner);
      toast.success(owner ? `Assigned to ${owner}` : 'Owner cleared');
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not assign owner');
    }
  }

  if (error) {
    return (
      <Card className="p-8 text-center shadow-none">
        <p className="text-sm font-semibold text-destructive">{error}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => onNavigate('/journeys')}>
          Back to Merchant Onboardings
        </Button>
      </Card>
    );
  }

  if (!detail) {
    return <Skeleton className="h-72 rounded-xl" />;
  }

  const { journey, stages, validationChecks, evidenceRecords, auditEvents, idempotencyKeys, authoritativeState } =
    detail;
  const selectedStage = stages.find((s) => s.id === selectedStageId) ?? stages[0];
  const stageChecks = validationChecks.filter((c) => c.stageId === selectedStage?.id);
  const kycBlocked =
    journey.status === 'BLOCKED' &&
    stages.some((s) => s.stageName === 'KYC_VERIFICATION' && (s.status === 'BLOCKED' || s.status === 'MISMATCH'));

  return (
    <div className="space-y-6">
      {/* Header & Plain-English Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-5 border-b border-border">
        <div className="space-y-1.5">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => onNavigate('/journeys')}
            className="-ml-2 text-muted-foreground"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Merchant Onboardings</span>
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-bold text-foreground">{journey.merchantName}</h1>
            <StatusBadge status={journey.status} />
            <StatusBadge status={journey.verificationStatus} />
          </div>
          <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-2">
            <span>Merchant Ref {journey.externalReference}</span>
            <span aria-hidden="true">·</span>
            <span>{HUMAN_SCENARIO_LABELS[journey.scenario]?.title ?? journey.scenario}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Select
            value={journey.assignedTo ?? 'UNASSIGNED'}
            onValueChange={(v) => void handleAssignOwner(v)}
          >
            <SelectTrigger
              size="sm"
              className="w-[155px] h-8 text-xs bg-background"
              aria-label="Assign merchant owner"
            >
              <SelectValue>
                {journey.assignedTo ?? 'Assign Owner'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="UNASSIGNED">Unassigned</SelectItem>
              {TEAM_ROSTER.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {onAskWhy && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onAskWhy(
                  journey.id,
                  `Why is ${journey.merchantName} in "${humanizeStatus(journey.status)}" and what do its A2A handoffs show?`
                )
              }
            >
              <MessageSquare className="w-3.5 h-3.5 text-[#0095D9]" />
              <span>Ask Why</span>
            </Button>
          )}

          {kycBlocked && (
            <Button size="sm" disabled={busyAction !== null} onClick={handleApproveSourceKyc}>
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>
                {busyAction === 'approve-kyc'
                  ? 'Confirming Bank KYC...'
                  : 'Confirm Bank KYC & Resume'}
              </span>
            </Button>
          )}
          {['BLOCKED', 'VERIFICATION_PENDING'].includes(journey.status) && (
            <Button size="sm" variant="outline" disabled={busyAction !== null} onClick={handleRecheck}>
              <RefreshCw className={`w-3.5 h-3.5 ${busyAction === 'recheck' ? 'animate-spin' : ''}`} />
              <span>Re-check Official Status</span>
            </Button>
          )}
          {journey.status === 'VERIFIED' && (
            <Button size="sm" variant="outline" disabled={busyAction !== null} onClick={handleSimulateDuplicate}>
              <CopyCheck className="w-3.5 h-3.5 text-[#0095D9] dark:text-[#00B9F1]" />
              <span>Test Duplicate Protection</span>
            </Button>
          )}
          {journey.status === 'NEEDS_HUMAN' && (
            <Button size="sm" onClick={() => onNavigate('/approvals')}>
              <span>Open Manager Approval Queue</span>
            </Button>
          )}
          {['RUNNING', 'BLOCKED', 'VERIFICATION_PENDING', 'NEEDS_HUMAN'].includes(journey.status) && (
            <Button size="sm" variant="outline" disabled={busyAction !== null} onClick={handleCancel}>
              <XCircle className="w-3.5 h-3.5" />
              <span>Cancel</span>
            </Button>
          )}
        </div>
      </div>

      {journey.blockedReason && (
        <Alert variant="destructive" className="bg-destructive/5 border-destructive/30">
          <ShieldAlert className="w-4 h-4" />
          <AlertTitle className="text-xs font-semibold">Onboarding Paused for Safety</AlertTitle>
          <AlertDescription className="text-xs">{humanizeBlockedReason(journey.blockedReason)}</AlertDescription>
        </Alert>
      )}

      {/* Interactive Workflow Graph */}
      <section className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Onboarding Step Flow</h2>
          <span className="text-xs text-muted-foreground">
            Click any step card to inspect what the AI claimed vs what the official system confirmed
          </span>
        </div>
        <JourneyDag
          stages={stages}
          selectedStageId={selectedStage?.id ?? null}
          onSelectStage={setSelectedStageId}
        />
      </section>

      {/* A2A Handoff Waterfall */}
      <Card className="py-0 gap-0 shadow-none overflow-hidden">
        <CardHeader className="px-5 py-4 border-b border-border flex flex-row items-center justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-sm font-semibold">Agent-to-Agent (A2A) Handoff Waterfall</CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Shows exact handoff timing, payload fields passed between agents, and any discrepancies caught
            </CardDescription>
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            {(detail.handoffs ?? []).length} hops
          </span>
        </CardHeader>
        <CardContent className="p-5">
          <A2AHandoffWaterfall handoffs={detail.handoffs ?? []} />
        </CardContent>
      </Card>

      {/* Main Inspector Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: Step Evidence & Checks */}
        <Card className="xl:col-span-7 py-0 gap-0 shadow-none overflow-hidden">
          <CardHeader className="px-5 py-4 border-b border-border flex flex-row items-center justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-sm font-semibold">
                Step Details · {selectedStage ? HUMAN_STAGE_LABELS[selectedStage.stageName] : ''}
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Handled by {selectedStage?.agentName} · Required result: {humanizeStateValue(selectedStage?.expectedState)}
              </CardDescription>
            </div>
            {selectedStage && <StatusBadge status={selectedStage.status} />}
          </CardHeader>

          <CardContent className="p-5 space-y-5">
            {/* Plain English Side-by-Side Comparison */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-lg bg-background border border-border p-3.5">
                <div className="text-[11px] text-muted-foreground">What the AI Assistant Claimed</div>
                <div className="text-sm font-semibold text-foreground mt-1">
                  {humanizeStateValue(selectedStage?.reportedState)}
                </div>
              </div>
              <div className="rounded-lg bg-background border border-border p-3.5">
                <div className="text-[11px] text-muted-foreground">What the Official System Confirmed</div>
                <div
                  className={`text-sm font-semibold mt-1 ${
                    selectedStage?.actualState === selectedStage?.expectedState
                      ? 'text-[#16A34A] dark:text-[#2DD4A4]'
                      : selectedStage?.actualState
                        ? 'text-destructive'
                        : 'text-muted-foreground'
                  }`}
                >
                  {humanizeStateValue(selectedStage?.actualState)}
                </div>
              </div>
            </div>

            {/* Plain Check Summaries */}
            <div className="space-y-2.5">
              <h3 className="text-xs font-semibold text-foreground">
                Safety &amp; Verification Checks ({stageChecks.length})
              </h3>
              {stageChecks.length === 0 ? (
                <div className="text-xs text-muted-foreground py-4 border border-dashed border-border rounded-lg text-center">
                  This step has not started yet because an earlier step is still waiting.
                </div>
              ) : (
                stageChecks.map((chk) => {
                  const ev = chk.evidenceId
                    ? evidenceRecords.find((e) => e.id === chk.evidenceId) ?? null
                    : null;
                  const typeLabel =
                    chk.validationType === 'BUSINESS_OUTCOME'
                      ? 'Official System Check'
                      : chk.validationType === 'EXECUTION'
                        ? 'Permission & Duplicate Guard'
                        : 'AI Response Format Check';
                  return (
                    <div key={chk.id} className="rounded-lg bg-background border border-border p-3.5 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-foreground">{typeLabel}</span>
                        <StatusBadge status={chk.result} />
                      </div>
                      <p className="text-xs text-muted-foreground">{humanizeBlockedReason(chk.reason)}</p>
                      {ev && (
                        <Accordion>
                          <AccordionItem value={chk.id} className="border-t border-border border-b-0 pt-1">
                            <AccordionTrigger className="py-1.5 text-[11px] text-muted-foreground hover:no-underline">
                              Technical Evidence &amp; Record Hash
                            </AccordionTrigger>
                            <AccordionContent className="text-[11px] font-mono text-muted-foreground pb-1">
                              <div>Source: {ev.sourceSystem}</div>
                              <div>Ref: {ev.referenceId} · SHA-256: {ev.payloadHash}</div>
                            </AccordionContent>
                          </AccordionItem>
                        </Accordion>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

        {/* Right: Official System Snapshots + Activity Timeline */}
        <div className="xl:col-span-5 space-y-6">
          <Card className="py-0 gap-0 shadow-none overflow-hidden">
            <CardHeader className="px-5 py-4 border-b border-border">
              <CardTitle className="text-sm font-semibold">Official Business Records</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Live state stored independently in each partner system
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-border text-xs">
              <div className="flex items-center justify-between px-5 py-3">
                <span className="text-muted-foreground">Merchant Profile Registry</span>
                <span className="font-medium text-foreground">
                  {humanizeStateValue(authoritativeState.merchant?.status ?? 'PENDING')}
                </span>
              </div>
              <div className="flex items-center justify-between px-5 py-3">
                <span className="text-muted-foreground">Bank KYC System</span>
                <span className="font-medium text-foreground">
                  {humanizeStateValue(authoritativeState.kyc?.status ?? 'PENDING')}
                </span>
              </div>
              <div className="flex items-center justify-between px-5 py-3">
                <span className="text-muted-foreground">Compliance &amp; Risk Engine</span>
                <span className="font-medium text-foreground">
                  {authoritativeState.risk
                    ? `${humanizeStateValue(authoritativeState.risk.status)} (Score ${authoritativeState.risk.score}/100)`
                    : 'Waiting'}
                </span>
              </div>
              <div className="flex items-center justify-between px-5 py-3">
                <span className="text-muted-foreground">Merchant Account Gateway</span>
                <span className="font-medium text-foreground">
                  {authoritativeState.activation
                    ? `${humanizeStateValue(authoritativeState.activation.status)} (${authoritativeState.activation.activationCode})`
                    : 'Not Activated Yet'}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="py-0 gap-0 shadow-none overflow-hidden">
            <CardHeader className="px-5 py-4 border-b border-border">
              <CardTitle className="text-sm font-semibold">
                Case Timeline ({auditEvents.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-border max-h-64 overflow-y-auto">
              {auditEvents.map((evt) => (
                <div key={evt.id} className="px-5 py-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground">
                      {HUMAN_EVENT_LABELS[evt.eventType] ?? evt.eventType}
                    </span>
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {new Date(evt.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {humanizeStateToken(evt.previousState)} → {humanizeStateToken(evt.newState)}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Accordion className="rounded-xl bg-card border border-border px-4">
            <AccordionItem value="tech-ids" className="border-b-0">
              <AccordionTrigger className="text-xs font-medium text-muted-foreground hover:no-underline">
                Technical IDs &amp; Duplicate Guards ({idempotencyKeys.length})
              </AccordionTrigger>
              <AccordionContent className="text-[11px] font-mono text-muted-foreground space-y-1.5">
                <div>Journey ID: {journey.id}</div>
                <div>Workflow ID: {journey.workflowId}</div>
                <div>Correlation ID: {journey.correlationId}</div>
                {idempotencyKeys.map((k) => (
                  <div key={k.key} className="pt-1 border-t border-border">
                    {k.key} · {k.operationType} · Attempts: {k.attemptCount}
                  </div>
                ))}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </div>
    </div>
  );
}
