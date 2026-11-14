import { useEffect, useState } from 'react';
import { FlaskConical, RotateCcw } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { api, type AnalyticsResponse } from '../api';
import { HUMAN_SCENARIO_SHORT_LABELS } from '../humanCopy';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const timeSeriesConfig = {
  verified: {
    label: 'Verified & Live',
    color: '#0095D9',
  },
  mismatches: {
    label: 'Mismatches Caught',
    color: '#DC2626',
  },
  timeoutsOrBlocked: {
    label: 'Paused / Timed Out',
    color: '#D97706',
  },
} satisfies ChartConfig;

const agentChartConfig = {
  totalRuns: {
    label: 'Total Tasks',
    color: 'var(--chart-1)',
  },
  outcomeMismatches: {
    label: 'Mismatches Caught',
    color: 'var(--chart-5)',
  },
} satisfies ChartConfig;

const scenarioChartConfig = {
  verified: {
    label: 'Verified & Live',
    color: 'var(--chart-1)',
  },
  blockedOrPending: {
    label: 'Paused / In Review',
    color: 'var(--chart-4)',
  },
} satisfies ChartConfig;

export function AnalyticsView({
  refreshKey,
  onChanged,
}: {
  refreshKey: number;
  onChanged?: () => void;
}) {
  const [windowKey, setWindowKey] = useState<'15m' | '1h' | '24h' | '7d'>('24h');
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);

  useEffect(() => {
    setLoading(true);
    api
      .getAnalytics(windowKey)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [windowKey, refreshKey]);

  async function runStudy(count: number, mismatchRatePct: number, timeoutRatePct: number) {
    setSimulating(true);
    try {
      const res = await api.simulateBatch({
        count,
        mismatchRatePct,
        timeoutRatePct,
        highRiskRatePct: 8,
        spreadHours: windowKey === '7d' ? 168 : 24,
      });
      toast.success(
        `Loaded ${res.createdCount.toLocaleString()} A2A onboardings in ${res.elapsedMs}ms (${res.summary.mismatches} mismatches, ${res.summary.timeouts} timeouts).`
      );
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Simulation failed');
    } finally {
      setSimulating(false);
    }
  }

  async function handleReset() {
    setSimulating(true);
    try {
      await api.resetDemo();
      toast.success('Reset workspace back to clean seed state.');
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setSimulating(false);
    }
  }

  if (loading && !data) {
    return <Skeleton className="h-72 rounded-xl" />;
  }

  if (!data) return null;

  const { latencyPercentiles, timeSeries } = data;

  const metricCards = [
    {
      label: 'Window Volume',
      value: data.metrics.totalJourneys.toLocaleString(),
      note: `${data.metrics.allTimeJourneys.toLocaleString()} all-time cases`,
    },
    {
      label: 'Verified & Live Rate',
      value: `${data.metrics.verifiedOutcomeRate}%`,
      note: 'Passed all official checks',
    },
    {
      label: 'A2A Handoff p50 / p95',
      value: `${latencyPercentiles.a2aHop.p50} / ${latencyPercentiles.a2aHop.p95} ms`,
      note: `p99: ${latencyPercentiles.a2aHop.p99} ms across hops`,
    },
    {
      label: 'Official Check p50 / p95',
      value: `${latencyPercentiles.officialVerify.p50} / ${latencyPercentiles.officialVerify.p95} ms`,
      note: `p99: ${latencyPercentiles.officialVerify.p99} ms partner latency`,
    },
    {
      label: 'Premature AI Approvals Caught',
      value: data.metrics.falseCompletionDetections.toLocaleString(),
      note: 'Blocked before activation',
    },
    {
      label: 'Duplicate Actions Prevented',
      value: data.metrics.duplicateOperationsPrevented.toLocaleString(),
      note: 'Stopped by safety lock',
    },
    {
      label: 'End-to-End A2A p95',
      value: `${latencyPercentiles.endToEnd.p95} ms`,
      note: `Mean ${latencyPercentiles.endToEnd.avg} ms per journey`,
    },
    {
      label: 'Manager Review Rate',
      value: `${data.metrics.humanEscalationRate}%`,
      note: 'Sent to human approval',
    },
  ];

  const agentData = data.agentBreakdown.map((a) => ({
    ...a,
    shortName: a.agentName
      .replace(' Onboarding Agent', '')
      .replace(' Verification Agent', '')
      .replace(' Assessment Agent', '')
      .replace(' Activation Agent', '')
      .replace(' Agent', ''),
  }));

  const scenarioData = data.scenarioBreakdown.map((s) => ({
    name: HUMAN_SCENARIO_SHORT_LABELS[s.scenario] ?? s.scenario,
    verified: s.verified,
    blockedOrPending: s.blockedOrPending,
  }));

  return (
    <div className="space-y-6">
      {/* Header & Time Window Switcher */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">A2A Performance &amp; Scale Analytics</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Track Agent-to-Agent handoff latency percentiles (p50 / p95 / p99), time-series failure spikes, and outcome reliability.
          </p>
        </div>

        <Tabs value={windowKey} onValueChange={(v) => setWindowKey(v as typeof windowKey)}>
          <TabsList>
            <TabsTrigger value="15m">Last 15m</TabsTrigger>
            <TabsTrigger value="1h">Last 1h</TabsTrigger>
            <TabsTrigger value="24h">Last 24h</TabsTrigger>
            <TabsTrigger value="7d">Last 7d</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Inline A2A Batch Study Simulator Toolbar */}
      <Card className="py-3.5 shadow-none border-[#00B9F1]/30 bg-[#EDF4FB]/50 dark:bg-[#14294D]/40">
        <CardContent className="px-5 py-0 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs">
            <FlaskConical className="w-4 h-4 text-[#0095D9] shrink-0" />
            <div>
              <span className="font-semibold text-foreground">A2A Study Simulator: </span>
              <span className="text-muted-foreground">
                Inject synthetic merchant onboardings to study failure clustering and p95 latency spikes.
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="xs"
              variant="outline"
              disabled={simulating}
              onClick={() => void runStudy(500, 12, 6)}
            >
              Simulate 500 Steady
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={simulating}
              onClick={() => void runStudy(1000, 28, 14)}
            >
              Simulate 1,000 Spike
            </Button>
            <Button
              size="xs"
              disabled={simulating}
              onClick={() => void runStudy(2500, 15, 8)}
            >
              {simulating ? 'Generating...' : 'Simulate 2,500 Volume'}
            </Button>
            {data.metrics.allTimeJourneys > 10 && (
              <Button
                size="xs"
                variant="ghost"
                disabled={simulating}
                onClick={() => void handleReset()}
                className="text-muted-foreground"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 8 KPI + Latency Percentile Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {metricCards.map((m) => (
          <Card key={m.label} className="py-4 gap-1 shadow-none">
            <CardHeader className="px-4 py-0">
              <CardDescription className="text-xs">{m.label}</CardDescription>
            </CardHeader>
            <CardContent className="px-4 py-0">
              <div className="text-xl font-bold tabular-nums text-foreground mt-1">{m.value}</div>
              <div className="text-[11px] text-muted-foreground mt-1">{m.note}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Time-Series Volume & Failure Spike Chart */}
      <Card className="py-5 gap-4 shadow-none">
        <CardHeader className="px-5 py-0">
          <CardTitle className="text-sm font-semibold">
            Merchant Volume &amp; Mismatch Trend ({windowKey})
          </CardTitle>
          <CardDescription className="text-xs">
            Tracks verified onboardings vs premature AI mismatches and A2A timeouts over time
          </CardDescription>
        </CardHeader>
        <CardContent className="px-5 py-0">
          <ChartContainer config={timeSeriesConfig} className="h-[260px] w-full">
            <AreaChart data={timeSeries} margin={{ top: 8, right: 12, left: -12, bottom: 4 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="bucketLabel" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Area
                type="monotone"
                dataKey="verified"
                stackId="1"
                stroke="var(--color-verified)"
                fill="var(--color-verified)"
                fillOpacity={0.2}
              />
              <Area
                type="monotone"
                dataKey="mismatches"
                stackId="1"
                stroke="var(--color-mismatches)"
                fill="var(--color-mismatches)"
                fillOpacity={0.35}
              />
              <Area
                type="monotone"
                dataKey="timeoutsOrBlocked"
                stackId="1"
                stroke="var(--color-timeoutsOrBlocked)"
                fill="var(--color-timeoutsOrBlocked)"
                fillOpacity={0.25}
              />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Breakdown Bar Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="py-5 gap-4 shadow-none">
          <CardHeader className="px-5 py-0">
            <CardTitle className="text-sm font-semibold">AI Assistant Tasks vs Mismatches Caught</CardTitle>
            <CardDescription className="text-xs">
              Tracks how often each assistant’s work was checked and blocked
            </CardDescription>
          </CardHeader>
          <CardContent className="px-5 py-0">
            <ChartContainer config={agentChartConfig} className="h-[250px] w-full">
              <BarChart data={agentData} margin={{ top: 8, right: 8, left: -16, bottom: 4 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="shortName" interval={0} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="totalRuns" fill="var(--color-totalRuns)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="outcomeMismatches" fill="var(--color-outcomeMismatches)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="py-5 gap-4 shadow-none">
          <CardHeader className="px-5 py-0">
            <CardTitle className="text-sm font-semibold">Onboardings by Scenario Outcome</CardTitle>
            <CardDescription className="text-xs">
              Verified &amp; live vs paused or waiting for review
            </CardDescription>
          </CardHeader>
          <CardContent className="px-5 py-0">
            <ChartContainer config={scenarioChartConfig} className="h-[250px] w-full">
              <BarChart data={scenarioData} margin={{ top: 8, right: 8, left: -16, bottom: 4 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="name" interval={0} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="verified" stackId="a" fill="var(--color-verified)" radius={[0, 0, 0, 0]} />
                <Bar dataKey="blockedOrPending" stackId="a" fill="var(--color-blockedOrPending)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
