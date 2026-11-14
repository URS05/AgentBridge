import { useEffect, useState } from 'react';
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  MessageSquare,
  RefreshCw,
  Search,
  UserCheck,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { TEAM_ROSTER, type Journey, type JourneyStage } from '../../core/types';
import { api, type JourneyDetailResponse } from '../api';
import { HUMAN_SCENARIO_LABELS, HUMAN_STAGE_LABELS, humanizeBlockedReason, humanizeStateValue, humanizeStatus } from '../humanCopy';
import { A2AHandoffWaterfall } from '../components/A2AHandoffWaterfall';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

const STATUS_FILTER_LABELS: Record<string, string> = {
  ALL: 'All Statuses',
  BLOCKED: 'Paused — Mismatch',
  NEEDS_HUMAN: 'Needs Manager Review',
  VERIFICATION_PENDING: 'Waiting on Bank Sync',
  VERIFIED: 'Verified & Live',
  FAILED: 'Failed',
  RUNNING: 'In Progress',
  CANCELLED: 'Cancelled',
};

export function JourneysView({
  onNavigate,
  onOpenLaunch: _onOpenLaunch,
  onAskWhy,
  onChanged,
  initialAssignedTo,
  initialClusterKey,
  initialStatus,
  refreshKey,
}: {
  onNavigate: (path: string) => void;
  onOpenLaunch: () => void;
  onAskWhy: (journeyId: string, question: string) => void;
  onChanged: () => void;
  initialAssignedTo?: string;
  initialClusterKey?: string;
  initialStatus?: string;
  refreshKey: number;
}) {
  const [journeys, setJourneys] = useState<Array<Journey & { stages: JourneyStage[] }>>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(initialStatus || 'ALL');
  const [scenarioFilter, setScenarioFilter] = useState('ALL');
  const [ownerFilter, setOwnerFilter] = useState(initialAssignedTo || 'ALL');
  const [clusterFilter, setClusterFilter] = useState(initialClusterKey || 'ALL');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<JourneyDetailResponse | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busyAction, setBusyAction] = useState(false);

  useEffect(() => {
    if (initialAssignedTo) setOwnerFilter(initialAssignedTo);
    if (initialClusterKey) setClusterFilter(initialClusterKey);
    if (initialStatus) setStatusFilter(initialStatus);
  }, [initialAssignedTo, initialClusterKey, initialStatus]);

  useEffect(() => {
    setLoading(true);
    api
      .getJourneys({
        status: statusFilter,
        scenario: scenarioFilter,
        assignedTo: ownerFilter,
        clusterKey: clusterFilter,
        q: search,
        page,
        pageSize,
      })
      .then((res) => {
        setJourneys(res.journeys);
        setTotal(res.total);
        setSelectedId((prev) => {
          if (prev && res.journeys.some((j) => j.id === prev)) return prev;
          return res.journeys[0]?.id ?? null;
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [statusFilter, scenarioFilter, ownerFilter, clusterFilter, search, page, refreshKey]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setLoadingDetail(true);
    api
      .getJourneyDetail(selectedId)
      .then((res) => setDetail(res))
      .catch(() => setDetail(null))
      .finally(() => setLoadingDetail(false));
  }, [selectedId, refreshKey]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endRow = Math.min(total, page * pageSize);

  function resetFilters() {
    setSearch('');
    setStatusFilter('ALL');
    setScenarioFilter('ALL');
    setOwnerFilter('ALL');
    setClusterFilter('ALL');
    setPage(1);
    onNavigate('/journeys');
  }

  async function handleAssignOwner(journeyId: string, value: string | null) {
    const owner = !value || value === 'UNASSIGNED' ? null : value;
    try {
      await api.assignJourneyOwner(journeyId, owner);
      toast.success(owner ? `Assigned to ${owner}` : 'Removed owner assignment');
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to assign owner');
    }
  }

  async function handleConfirmKyc(journeyId: string) {
    setBusyAction(true);
    try {
      const { journey } = await api.approveSourceKyc(journeyId);
      toast.success(`Bank KYC confirmed. Status is now ${humanizeStatus(journey.status)}.`);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to confirm KYC');
    } finally {
      setBusyAction(false);
    }
  }

  async function handleRecheck(journeyId: string) {
    setBusyAction(true);
    try {
      const { journey } = await api.recheckJourney(journeyId);
      toast.info(`Re-checked official status: ${humanizeStatus(journey.status)}`);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Re-check failed');
    } finally {
      setBusyAction(false);
    }
  }

  const hasActiveFilter =
    search !== '' ||
    statusFilter !== 'ALL' ||
    scenarioFilter !== 'ALL' ||
    ownerFilter !== 'ALL' ||
    clusterFilter !== 'ALL';

  const selectedJourney = detail?.journey ?? journeys.find((j) => j.id === selectedId) ?? null;
  const selectedStages = detail?.stages ?? journeys.find((j) => j.id === selectedId)?.stages ?? [];
  const kycBlocked =
    selectedJourney?.status === 'BLOCKED' &&
    selectedStages.some((s) => s.stageName === 'KYC_VERIFICATION' && (s.status === 'BLOCKED' || s.status === 'MISMATCH'));

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">All Merchants</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Click any merchant on the left to inspect step truth vs AI claims and trace the Agent-to-Agent handoff waterfall on the right.
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <Card className="py-3.5 shadow-none">
        <CardContent className="px-4 py-0 grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          <div className="relative md:col-span-4">
            <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search merchant name, ref ID, or owner..."
              aria-label="Search merchant onboardings"
              className="pl-9 bg-background"
            />
          </div>

          <div className="md:col-span-3">
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v ?? 'ALL');
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full bg-background" aria-label="Filter by status">
                <SelectValue>
                  {STATUS_FILTER_LABELS[statusFilter] ?? statusFilter}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                <SelectItem value="BLOCKED">Paused — Mismatch</SelectItem>
                <SelectItem value="NEEDS_HUMAN">Needs Manager Review</SelectItem>
                <SelectItem value="VERIFICATION_PENDING">Waiting on Bank Sync</SelectItem>
                <SelectItem value="VERIFIED">Verified &amp; Live</SelectItem>
                <SelectItem value="FAILED">Failed</SelectItem>
                <SelectItem value="RUNNING">In Progress</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="md:col-span-3">
            <Select
              value={ownerFilter}
              onValueChange={(v) => {
                setOwnerFilter(v ?? 'ALL');
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full bg-background" aria-label="Filter by team owner">
                <SelectValue>
                  {ownerFilter === 'ALL'
                    ? 'All Team Owners'
                    : ownerFilter === 'UNASSIGNED'
                      ? 'Unassigned Only'
                      : ownerFilter}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Team Owners</SelectItem>
                <SelectItem value="UNASSIGNED">Unassigned Only</SelectItem>
                {TEAM_ROSTER.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="md:col-span-2 flex items-center justify-end gap-2">
            {hasActiveFilter && (
              <Button variant="ghost" size="sm" onClick={resetFilters} className="w-full md:w-auto">
                <X className="w-3.5 h-3.5" />
                <span>Clear</span>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Stripe/Razorpay Master-Detail Split View */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Left Pane: Paginated Merchant Queue */}
        <Card className="xl:col-span-5 py-0 gap-0 shadow-none overflow-hidden">
          <CardHeader className="px-4 py-3 border-b border-border flex flex-row items-center justify-between gap-2 space-y-0 bg-secondary/35">
            <span className="text-xs font-semibold text-foreground tabular-nums">
              {total === 0
                ? '0 merchants'
                : `Showing ${startRow.toLocaleString()}–${endRow.toLocaleString()} of ${total.toLocaleString()}`}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon-xs"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <span className="text-[11px] font-medium text-muted-foreground px-1.5 tabular-nums">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="icon-xs"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                aria-label="Next page"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </CardHeader>

          <CardContent className="p-0 divide-y divide-border max-h-[680px] overflow-y-auto">
            {loading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 rounded-lg" />
                ))}
              </div>
            ) : journeys.length === 0 ? (
              <div className="p-10 text-center text-xs text-muted-foreground">
                No merchant onboardings match the selected filters.
              </div>
            ) : (
              journeys.map((j) => {
                const active = j.id === selectedId;
                return (
                  <button
                    key={j.id}
                    type="button"
                    onClick={() => setSelectedId(j.id)}
                    className={`w-full text-left px-4 py-3.5 transition-colors space-y-1.5 ${
                      active
                        ? 'bg-[#E6F7FD] dark:bg-[#00B9F1]/15'
                        : 'hover:bg-secondary/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground truncate">
                          {j.merchantName}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {j.externalReference} · {HUMAN_STAGE_LABELS[j.currentStage] ?? j.currentStage}
                        </div>
                      </div>
                      <StatusBadge status={j.status} />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>Owner: {j.assignedTo ?? 'Unassigned'}</span>
                      <span>{HUMAN_SCENARIO_LABELS[j.scenario]?.title ?? j.scenario}</span>
                    </div>
                  </button>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Right Pane: Instant Live Preview & A2A Handoff Waterfall */}
        <div className="xl:col-span-7">
          {!selectedJourney ? (
            <Card className="p-10 text-center shadow-none text-xs text-muted-foreground">
              Select a merchant from the list to inspect verification truth and A2A handoffs.
            </Card>
          ) : (
            <Card className="py-0 gap-0 shadow-none overflow-hidden">
              <CardHeader className="px-5 py-4 border-b border-border space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-base font-bold text-foreground">
                        {selectedJourney.merchantName}
                      </CardTitle>
                      <StatusBadge status={selectedJourney.status} />
                    </div>
                    <CardDescription className="text-xs mt-1">
                      {selectedJourney.externalReference} · {selectedJourney.id} ·{' '}
                      {HUMAN_SCENARIO_LABELS[selectedJourney.scenario]?.title ?? selectedJourney.scenario}
                    </CardDescription>
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onNavigate(`/journeys/${selectedJourney.id}`)}
                  >
                    <span>Open Full Graph</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Button>
                </div>

                {/* Inline Triage Toolbar */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Select
                    value={selectedJourney.assignedTo ?? 'UNASSIGNED'}
                    onValueChange={(v) => void handleAssignOwner(selectedJourney.id, v)}
                  >
                    <SelectTrigger
                      size="sm"
                      className="w-[165px] h-8 text-xs bg-background"
                      aria-label="Assign merchant owner"
                    >
                      <SelectValue>
                        {selectedJourney.assignedTo ?? 'Assign Owner'}
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

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      onAskWhy(
                        selectedJourney.id,
                        `Explain why ${selectedJourney.merchantName} is ${humanizeStatus(selectedJourney.status)} and inspect its A2A handoffs.`
                      )
                    }
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-[#0095D9]" />
                    <span>Ask Why</span>
                  </Button>

                  {kycBlocked && (
                    <Button
                      size="sm"
                      disabled={busyAction}
                      onClick={() => void handleConfirmKyc(selectedJourney.id)}
                    >
                      <span>Confirm Bank KYC &amp; Resume</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Button>
                  )}

                  {selectedJourney.status === 'NEEDS_HUMAN' && (
                    <Button size="sm" onClick={() => onNavigate('/approvals')}>
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>Open Approvals</span>
                    </Button>
                  )}

                  {['BLOCKED', 'VERIFICATION_PENDING', 'FAILED'].includes(selectedJourney.status) && !kycBlocked && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyAction}
                      onClick={() => void handleRecheck(selectedJourney.id)}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${busyAction ? 'animate-spin' : ''}`} />
                      <span>Re-check Official Status</span>
                    </Button>
                  )}
                </div>
              </CardHeader>

              <CardContent className="p-5 space-y-5">
                {selectedJourney.blockedReason && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-foreground">
                    <span className="font-semibold text-destructive">Why paused: </span>
                    {humanizeBlockedReason(selectedJourney.blockedReason)}
                  </div>
                )}

                {/* 4-Step Plain-English Truth Grid */}
                <div className="space-y-2.5">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    4-Step Verification Check (AI Claim vs Official System)
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {selectedStages.map((stg) => (
                      <div
                        key={stg.id}
                        className="rounded-lg border border-border bg-background p-3 space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-foreground">
                            {stg.order}. {HUMAN_STAGE_LABELS[stg.stageName] ?? stg.stageName}
                          </span>
                          <StatusBadge status={stg.status} />
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                          <div>
                            <div className="text-muted-foreground">AI Claimed</div>
                            <div className="font-medium text-foreground truncate">
                              {humanizeStateValue(stg.reportedState)}
                            </div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Official Record</div>
                            <div
                              className={`font-medium truncate ${
                                stg.validationStatus === 'MISMATCH' || stg.validationStatus === 'FAIL'
                                  ? 'text-destructive'
                                  : 'text-foreground'
                              }`}
                            >
                              {humanizeStateValue(stg.actualState)}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Agent-to-Agent (A2A) Handoff Waterfall */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      A2A Call Handoff Waterfall
                    </h3>
                    <span className="text-[11px] text-muted-foreground">
                      Hop latency vs official verification check
                    </span>
                  </div>
                  {loadingDetail && !detail ? (
                    <Skeleton className="h-32 rounded-lg" />
                  ) : (
                    <A2AHandoffWaterfall handoffs={detail?.handoffs ?? selectedJourney.handoffs ?? []} />
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
