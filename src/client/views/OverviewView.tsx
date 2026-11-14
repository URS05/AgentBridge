import { useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock,
  MessageSquare,
  Network,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, type OverviewResponse } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { Badge } from '@/components/ui/badge';
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

function formatAge(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}

export function OverviewView({
  data,
  loading,
  onNavigate,
  onAskWhy,
  onChanged,
}: {
  data: OverviewResponse | null;
  loading: boolean;
  onNavigate: (path: string) => void;
  onAskWhy: (journeyId: string, question: string) => void;
  onChanged: () => void;
}) {
  const [busyCluster, setBusyCluster] = useState<string | null>(null);

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  if (!data) return null;

  const { pulse, departments, topIssues, teamLoad, teamRoster, integrations } = data;
  const maxTeamLoad = Math.max(1, ...teamLoad.map((m) => m.activeCount));
  const otelHealthy = integrations.find((i) => i.id === 'int_otel_collector')?.status === 'HEALTHY';

  async function handleAssignCluster(clusterKey: string, value: string | null) {
    const owner = !value || value === 'UNASSIGNED' ? null : value;
    try {
      const res = await api.assignClusterOwner(clusterKey, owner);
      toast.success(
        owner
          ? `Assigned ${res.updatedCount} issue(s) to ${owner}`
          : `Unassigned ${res.updatedCount} issue(s)`
      );
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to assign owner');
    }
  }

  async function handleClusterAction(issue: OverviewResponse['topIssues'][number]) {
    if (issue.actionType === 'OPEN_APPROVALS') {
      onNavigate('/approvals');
      return;
    }
    if (issue.actionType === 'INSPECT_JOURNEY') {
      onNavigate(`/journeys/${issue.primaryJourneyId}`);
      return;
    }

    setBusyCluster(issue.clusterKey);
    try {
      const res = await api.bulkResolveCluster({
        clusterKey: issue.clusterKey,
        approveKycFirst: issue.actionType === 'CONFIRM_KYC_BULK',
      });
      toast.success(
        `Resolved ${res.verifiedCount} of ${res.updatedCount} merchant onboarding(s) cleanly.`
      );
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to resolve cluster');
    } finally {
      setBusyCluster(null);
    }
  }

  return (
    <div className="space-y-5">
      {/* Calm Manager Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Onboarding Operations Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            See which department is good to go, resolve today’s top issues, and balance cases across your 7-person team.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => onNavigate('/analytics')}>
            <BarChart3 className="w-3.5 h-3.5 text-[#0095D9]" />
            <span>Trends &amp; Latency</span>
          </Button>
        </div>
      </div>

      {/* Individual Department Readiness Strip */}
      <section aria-label="Department Readiness" className="space-y-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Department Readiness
          </h2>
          <div className="flex flex-wrap items-center gap-2.5 text-xs text-muted-foreground tabular-nums">
            <span className="whitespace-nowrap">
              <strong className="text-foreground">{pulse.needsActionNow.toLocaleString()}</strong> need action
            </span>
            <span aria-hidden="true">·</span>
            <span className="whitespace-nowrap">
              <strong className="text-foreground">{pulse.verifiedToday.toLocaleString()}</strong> verified live
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
          {departments.map((dept) => {
            const borderTone =
              dept.readiness === 'OFFLINE'
                ? 'border-[#DC2626]/40'
                : dept.readiness === 'ATTENTION_NEEDED'
                  ? 'border-[#D97706]/35'
                  : 'border-border';

            return (
              <button
                key={dept.stageName}
                type="button"
                onClick={() => onNavigate(dept.targetPath)}
                className={`text-left rounded-xl border ${borderTone} bg-card p-3.5 hover:bg-secondary/35 transition-colors flex flex-col justify-between gap-2`}
              >
                <div className="flex items-center justify-between gap-2">
                  <StatusBadge status={dept.readiness} label={dept.readinessLabel} />
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                </div>

                <div className="space-y-0.5">
                  <div className="text-sm font-semibold text-foreground leading-snug">
                    {dept.departmentName}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {dept.roleLabel}
                  </div>
                </div>

                <div className="pt-2 border-t border-border/70 text-[11px] text-muted-foreground leading-snug">
                  {dept.summary}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Focused 2-Column Triage Area */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left (~67%): Top 5 Issues Right Now */}
        <div className="xl:col-span-8">
          <Card className="py-0 gap-0 shadow-none overflow-hidden">
            <CardHeader className="px-5 py-4 border-b border-border flex flex-row items-center justify-between gap-4 space-y-0">
              <div>
                <CardTitle className="text-base font-semibold">What Needs Your Attention Today</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Grouped by root cause and ranked by merchant impact &amp; SLA waiting time
                </CardDescription>
              </div>
              <Button variant="link" size="xs" onClick={() => onNavigate('/journeys')}>
                All Merchants
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </CardHeader>

            <CardContent className="p-0">
              {topIssues.length === 0 ? (
                <div className="p-10 text-center space-y-2">
                  <CheckCircle2 className="w-7 h-7 text-[#00B074] mx-auto" />
                  <p className="text-sm font-semibold text-foreground">
                    All departments are clear — zero issues blocking activation
                  </p>
                  <p className="text-xs text-muted-foreground max-w-md mx-auto">
                    Every active onboarding matches official bank KYC and risk records cleanly.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {topIssues.map((issue, idx) => {
                    const isBusy = busyCluster === issue.clusterKey;
                    const singleMerchantLabel = issue.primaryMerchantName.split(' (+')[0];
                    return (
                      <div
                        key={issue.clusterKey}
                        className="p-5 hover:bg-secondary/35 transition-colors space-y-3"
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-bold text-[#002E6E] dark:text-[#00B9F1] tabular-nums">
                              #{idx + 1}
                            </span>
                            <StatusBadge
                              status={issue.severity}
                              label={
                                issue.severity === 'CRITICAL'
                                  ? 'Critical'
                                  : issue.severity === 'HIGH'
                                    ? 'High Priority'
                                    : 'Medium'
                              }
                            />
                            <Badge
                              variant="secondary"
                              className="text-[11px] font-semibold tabular-nums"
                            >
                              {issue.affectedCount.toLocaleString()}{' '}
                              {issue.affectedCount === 1 ? 'merchant' : 'merchants'}
                            </Badge>
                            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
                              <Clock className="w-3 h-3" />
                              Oldest waiting {formatAge(issue.oldestAgeMinutes)}
                            </span>
                          </div>

                          <h3 className="text-sm font-semibold text-foreground leading-snug">
                            {issue.title}
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            {issue.plainSummary}
                          </p>
                        </div>

                        <div className="space-y-2.5 pt-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <button
                              type="button"
                              onClick={() => onNavigate(`/journeys/${issue.primaryJourneyId}`)}
                              className="font-medium text-[#002E6E] dark:text-[#00B9F1] hover:underline"
                            >
                              {issue.primaryMerchantName}
                            </button>
                            <span className="text-muted-foreground">·</span>
                            <button
                              type="button"
                              onClick={() =>
                                onNavigate(`/journeys?clusterKey=${encodeURIComponent(issue.clusterKey)}`)
                              }
                              className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                            >
                              Filter cluster
                            </button>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <Select
                              value={issue.primaryAssignedTo ?? 'UNASSIGNED'}
                              onValueChange={(v) => void handleAssignCluster(issue.clusterKey, v)}
                            >
                              <SelectTrigger
                                size="sm"
                                className="w-[155px] h-8 text-xs bg-background"
                                aria-label={`Assign owner for ${issue.title}`}
                              >
                                <SelectValue>
                                  {issue.primaryAssignedTo ?? 'Assign Owner'}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="UNASSIGNED">Unassigned</SelectItem>
                                {teamRoster.map((member) => (
                                  <SelectItem key={member} value={member}>
                                    {member}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>

                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                onAskWhy(
                                  issue.primaryJourneyId,
                                  `Why is ${singleMerchantLabel} paused and what should ${issue.primaryAssignedTo ?? 'our team'} do next?`
                                )
                              }
                            >
                              <MessageSquare className="w-3.5 h-3.5 text-[#0095D9]" />
                              <span>Ask Why</span>
                            </Button>

                            <Button
                              size="sm"
                              disabled={isBusy}
                              onClick={() => void handleClusterAction(issue)}
                            >
                              <span>{isBusy ? 'Resolving...' : issue.actionLabel}</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right (~33%): 7-Person Team Queue + Compact System Summary Link */}
        <div className="xl:col-span-4 space-y-4">
          <Card className="py-0 gap-0 shadow-none overflow-hidden">
            <CardHeader className="px-4 py-3 border-b border-border flex flex-row items-center justify-between gap-4 space-y-0">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-[#0095D9]" />
                <CardTitle className="text-sm font-semibold">7-Person Team Queue</CardTitle>
              </div>
              <span className="text-[11px] text-muted-foreground">Active cases</span>
            </CardHeader>
            <CardContent className="p-2.5 grid grid-cols-2 gap-1.5">
              {teamLoad.map((member) => {
                const pct = member.activeCount > 0 ? Math.max(12, Math.round((member.activeCount / maxTeamLoad) * 100)) : 0;
                const filterVal = member.name === 'Unassigned' ? 'UNASSIGNED' : member.name;
                return (
                  <button
                    key={member.name}
                    type="button"
                    onClick={() => onNavigate(`/journeys?assignedTo=${encodeURIComponent(filterVal)}`)}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg border border-border/60 hover:bg-secondary/60 transition-colors space-y-1"
                  >
                    <div className="flex items-center justify-between gap-1 text-xs">
                      <span
                        className={`font-medium truncate ${member.name === 'Unassigned' && member.activeCount > 0 ? 'text-[#B45309] dark:text-[#F5B84B]' : 'text-foreground'}`}
                      >
                        {member.name}
                      </span>
                      <span className="font-semibold tabular-nums text-muted-foreground shrink-0">
                        {member.activeCount.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                      <div
                        className={`h-full rounded-full ${member.name === 'Unassigned' ? 'bg-[#D97706]' : 'bg-[#0095D9]'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          <Card className="py-0 gap-0 shadow-none overflow-hidden">
            <CardHeader className="px-4 py-3 border-b border-border flex flex-row items-center justify-between gap-2 space-y-0">
              <div className="flex items-center gap-2">
                <Network className="w-4 h-4 text-[#0095D9]" />
                <CardTitle className="text-sm font-semibold">Platform &amp; Protocols</CardTitle>
              </div>
              <Button variant="link" size="xs" onClick={() => onNavigate('/integrations')}>
                Inspect All {pulse.systemsTotal}
                <ArrowRight className="w-3 h-3" />
              </Button>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-border text-xs">
              <div className="flex items-center justify-between px-4 py-2">
                <span className="text-muted-foreground">Pi Agent Protocols</span>
                <StatusBadge
                  status={pulse.piProtocolsHealthy === pulse.piProtocolsTotal ? 'HEALTHY' : 'OUTAGE'}
                  label={`${pulse.piProtocolsHealthy} / ${pulse.piProtocolsTotal} Online`}
                />
              </div>
              <div className="flex items-center justify-between px-4 py-2">
                <span className="text-muted-foreground">Authoritative Bank APIs</span>
                <StatusBadge
                  status={pulse.gatewaysHealthy === pulse.gatewaysTotal ? 'HEALTHY' : 'OUTAGE'}
                  label={`${pulse.gatewaysHealthy} / ${pulse.gatewaysTotal} Online`}
                />
              </div>
              <div className="flex items-center justify-between px-4 py-2">
                <span className="text-muted-foreground">Telemetry &amp; Audit Chain</span>
                <StatusBadge
                  status={otelHealthy ? 'HEALTHY' : 'OUTAGE'}
                  label={otelHealthy ? 'Verified' : 'Offline'}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
