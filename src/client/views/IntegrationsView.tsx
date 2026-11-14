import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Cpu,
  Network,
  Plug,
  Power,
  RefreshCw,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import type { SystemIntegration } from '../../core/types';
import { api } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const PIPELINE_HOPS: Array<{
  order: 1 | 2 | 3 | 4 | 5;
  title: string;
  subtitle: string;
  icon: typeof Cpu;
}> = [
  {
    order: 1,
    title: '1. Pi Agent Runtime',
    subtitle: 'Native RPC (JSONL) & TS SDK',
    icon: Cpu,
  },
  {
    order: 2,
    title: '2. A2A & MCP Bus',
    subtitle: 'Agent Cards, JSON-RPC & Tools',
    icon: Network,
  },
  {
    order: 3,
    title: '3. ACP Policy Gate',
    subtitle: 'Pre-tool guardrail & locks',
    icon: ShieldCheck,
  },
  {
    order: 4,
    title: '4. Official Ledgers',
    subtitle: 'Merchant, KYC, Risk & Activation',
    icon: Plug,
  },
  {
    order: 5,
    title: '5. Telemetry & Audit',
    subtitle: 'OTLP, SSE & SHA-256 Chain',
    icon: Activity,
  },
];

function categoryIcon(cat: SystemIntegration['category']) {
  if (cat === 'PI_RUNTIME') return Cpu;
  if (cat === 'AGENT_PROTOCOL') return Network;
  if (cat === 'TOOL_PROTOCOL') return Wrench;
  if (cat === 'OBSERVABILITY') return Activity;
  return Plug;
}

export function IntegrationsView({ refreshKey }: { refreshKey: number }) {
  const [integrations, setIntegrations] = useState<SystemIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [filterTab, setFilterTab] = useState<'ALL' | 'PI' | 'BANK' | 'OBS'>('ALL');

  const load = () => {
    setLoading(true);
    api
      .getIntegrations()
      .then((res) => setIntegrations(res.integrations))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [refreshKey]);

  async function handleToggle(id: string) {
    try {
      const { integration } = await api.toggleIntegrationStatus(id);
      toast.info(`${integration.name} is now ${integration.status === 'HEALTHY' ? 'Online' : 'Offline'}`);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to update connection status');
    }
  }

  async function handleProbeAll() {
    setProbing(true);
    try {
      const res = await api.probeIntegrations();
      setIntegrations(res.integrations);
      toast.success(
        `End-to-end ping complete: ${res.healthyCount} / ${res.totalCount} protocol links healthy.`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'End-to-end ping failed');
    } finally {
      setProbing(false);
    }
  }

  const piProtocols = integrations.filter((i) =>
    ['PI_RUNTIME', 'AGENT_PROTOCOL', 'TOOL_PROTOCOL'].includes(i.category)
  );
  const bankApis = integrations.filter((i) => i.category === 'SOURCE_SYSTEM');
  const obsLinks = integrations.filter((i) => i.category === 'OBSERVABILITY');

  const visibleList =
    filterTab === 'PI'
      ? piProtocols
      : filterTab === 'BANK'
        ? bankApis
        : filterTab === 'OBS'
          ? obsLinks
          : integrations;

  const healthyCount = integrations.filter((i) => i.status === 'HEALTHY').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">
            Connected Systems &amp; Pi Agent Protocols
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Simulated end-to-end connection topology across Pi runtime, A2A, MCP, ACP policy guardrails, authoritative bank APIs, and OTel audit streams.
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={probing} onClick={() => void handleProbeAll()} className="self-start">
          <RefreshCw className={`w-3.5 h-3.5 text-[#0095D9] ${probing ? 'animate-spin' : ''}`} />
          <span>{probing ? 'Pinging Chain...' : 'Ping End-to-End Chain'}</span>
        </Button>
      </div>

      {/* 5-Hop End-to-End Connection Pipeline */}
      <Card className="py-5 gap-4 shadow-none overflow-hidden">
        <CardHeader className="px-5 py-0 flex flex-row items-center justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-sm font-semibold">
              End-to-End Connection Pipeline ({healthyCount} / {integrations.length} Links Online)
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Toggle any Pi protocol or bank API offline below to verify how AgentBridge holds onboarding safely without data corruption
            </CardDescription>
          </div>
          <Badge variant="secondary" className="text-[11px] font-semibold">
            SIMULATED TOPOLOGY
          </Badge>
        </CardHeader>

        <CardContent className="px-5 py-0">
          {loading ? (
            <Skeleton className="h-28 rounded-lg" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-stretch">
              {PIPELINE_HOPS.map((hop, idx) => {
                const Icon = hop.icon;
                const hopItems = integrations.filter((i) => (i.pipelineOrder ?? 4) === hop.order);
                const hopHealthy = hopItems.filter((i) => i.status === 'HEALTHY').length;
                const hopDown = hopItems.some((i) => i.status !== 'HEALTHY');
                const avgHopMs = hopItems.length
                  ? Math.round(hopItems.reduce((acc, i) => acc + i.latencyMs, 0) / hopItems.length)
                  : 0;

                return (
                  <div key={hop.order} className="relative flex items-stretch gap-2">
                    <div
                      className={`flex-1 rounded-xl border p-3.5 space-y-2 transition-colors ${
                        hopDown
                          ? 'border-[#DC2626]/45 bg-[#FEF2F2]/60 dark:bg-[#DC2626]/10'
                          : 'border-border bg-background'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Icon className={`w-4 h-4 shrink-0 ${hopDown ? 'text-[#DC2626]' : 'text-[#0095D9]'}`} />
                        <StatusBadge
                          status={hopDown ? 'OUTAGE' : 'HEALTHY'}
                          label={hopDown ? `${hopHealthy}/${hopItems.length} Up` : 'Online'}
                        />
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-foreground">{hop.title}</div>
                        <div className="text-[11px] text-muted-foreground">{hop.subtitle}</div>
                      </div>
                      <div className="pt-1 border-t border-border/70 flex flex-wrap gap-1">
                        {hopItems.map((item) => (
                          <span
                            key={item.id}
                            className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                              item.status === 'HEALTHY'
                                ? 'bg-secondary/70 border-border text-foreground'
                                : 'bg-[#FEE2E2] border-[#DC2626]/30 text-[#991B1B] dark:bg-[#DC2626]/20 dark:text-[#FCA5A5]'
                            }`}
                          >
                            {item.protocol ?? item.name}
                          </span>
                        ))}
                      </div>
                      <div className="text-[10px] text-muted-foreground tabular-nums">
                        Avg link latency: {avgHopMs} ms
                      </div>
                    </div>

                    {idx < PIPELINE_HOPS.length - 1 && (
                      <div className="hidden md:flex items-center justify-center shrink-0 -mr-1">
                        <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Protocol Layer Filter Tabs */}
      <Tabs value={filterTab} onValueChange={(v) => setFilterTab(v as typeof filterTab)}>
        <TabsList>
          <TabsTrigger value="ALL">All Connections ({integrations.length})</TabsTrigger>
          <TabsTrigger value="PI">Pi &amp; Agent Protocols ({piProtocols.length})</TabsTrigger>
          <TabsTrigger value="BANK">Bank &amp; Risk APIs ({bankApis.length})</TabsTrigger>
          <TabsTrigger value="OBS">Observability ({obsLinks.length})</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <Skeleton className="h-44 rounded-xl" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visibleList.map((int) => {
            const Icon = categoryIcon(int.category);
            return (
              <Card key={int.id} className="py-5 gap-4 shadow-none">
                <CardHeader className="px-5 py-0 flex flex-row items-start justify-between gap-3 space-y-0">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <Icon className="w-4 h-4 text-[#0095D9] dark:text-[#00B9F1] shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-sm font-semibold">
                          {int.name.replace('Authoritative ', '')}
                        </CardTitle>
                        {int.protocolLabel && (
                          <Badge variant="secondary" className="text-[10px] font-medium">
                            {int.protocolLabel}
                          </Badge>
                        )}
                      </div>
                      <CardDescription className="text-[11px] mt-0.5 tabular-nums">
                        {int.transport ? `${int.transport} · ` : ''}v{int.apiVersion} · {int.latencyMs}ms
                      </CardDescription>
                    </div>
                  </div>
                  <StatusBadge status={int.status} />
                </CardHeader>

                <CardContent className="px-5 py-0 space-y-3.5">
                  {int.details && (
                    <p className="text-xs text-muted-foreground leading-relaxed">{int.details}</p>
                  )}

                  <div className="text-[11px] font-mono text-muted-foreground bg-secondary/45 border border-border rounded-md px-2.5 py-1.5 truncate">
                    {int.endpoint}
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded-lg bg-background border border-border p-3">
                      <div className="text-[11px] text-muted-foreground">Access Scope</div>
                      <div className="text-xs font-medium text-foreground mt-1">
                        {int.permissions.join(', ')}
                      </div>
                    </div>
                    <div className="rounded-lg bg-background border border-border p-3">
                      <div className="text-[11px] text-muted-foreground">Capabilities</div>
                      <div className="text-xs font-medium text-foreground mt-1">
                        {int.capabilities.map((c) => c.replace(/_/g, ' ')).join(', ')}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-border text-xs">
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      Checked {new Date(int.lastCheckedAt).toLocaleTimeString()}
                    </span>
                    <Button size="xs" variant="outline" onClick={() => void handleToggle(int.id)}>
                      <Power className="w-3.5 h-3.5" />
                      <span>{int.status === 'HEALTHY' ? 'Simulate Outage' : 'Restore Online'}</span>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
