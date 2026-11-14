import { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import type { AgentDefinition, AgentRun } from '../../core/types';
import { api } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

type EnrichedAgent = AgentDefinition & {
  totalRuns: number;
  failureRate: number;
  avgLatencyMs: number;
  recentRuns: AgentRun[];
};

export function AgentsView({ refreshKey }: { refreshKey: number }) {
  const [agents, setAgents] = useState<EnrichedAgent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .getAgents()
      .then((res) => {
        setAgents(res.agents);
        setSelectedId((prev) => prev ?? res.agents[0]?.id ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refreshKey]);

  const selected = agents.find((a) => a.id === selectedId) ?? agents[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">AI Assistants Directory</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          View each assistant’s allowed responsibilities, permission boundaries, speed, and recent tasks.
        </p>
      </div>

      {loading ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          <div className="xl:col-span-5 space-y-3">
            {agents.map((agent) => {
              const active = selected?.id === agent.id;
              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => setSelectedId(agent.id)}
                  className={`w-full text-left rounded-xl p-4 border transition-colors ${
                    active
                      ? 'bg-card border-primary ring-1 ring-primary/30'
                      : 'bg-card border-border hover:bg-secondary/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <Bot className="w-4 h-4 text-[#0095D9] dark:text-[#00B9F1]" />
                      <span className="text-sm font-semibold text-foreground">{agent.name}</span>
                      <span className="text-[11px] text-muted-foreground">v{agent.version}</span>
                    </div>
                    <StatusBadge status={agent.health} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{agent.description}</p>
                  <div className="mt-3 pt-2.5 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
                    <span>Tasks: {agent.totalRuns}</span>
                    <span>Error Rate: {agent.failureRate}%</span>
                    <span>Avg Speed: {agent.avgLatencyMs}ms</span>
                  </div>
                </button>
              );
            })}
          </div>

          {selected && (
            <Card className="xl:col-span-7 py-0 gap-0 shadow-none overflow-hidden">
              <CardHeader className="px-5 py-4 border-b border-border flex flex-row items-center justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="text-base font-semibold">{selected.name}</CardTitle>
                  <CardDescription className="text-xs mt-0.5">{selected.description}</CardDescription>
                </div>
                <StatusBadge status={selected.health} />
              </CardHeader>

              <CardContent className="p-5 space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div className="rounded-lg bg-background border border-border p-3.5">
                    <div className="text-[11px] font-medium text-muted-foreground mb-2">Allowed Actions</div>
                    <div className="space-y-1 text-foreground">
                      {selected.capabilities.map((cap) => (
                        <div key={cap}>{cap.replace(/_/g, ' ')}</div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg bg-background border border-border p-3.5">
                    <div className="text-[11px] font-medium text-muted-foreground mb-2">Permission Scope</div>
                    <div className="space-y-1 font-mono text-[11px] text-[#002E6E] dark:text-[#00B9F1]">
                      {selected.permissions.map((perm) => (
                        <div key={perm}>{perm}</div>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-foreground mb-2.5">
                    Recent Tasks ({selected.recentRuns.length})
                  </h3>
                  {selected.recentRuns.length === 0 ? (
                    <div className="text-xs text-muted-foreground p-4 border border-dashed border-border rounded-lg text-center">
                      No tasks recorded yet for this assistant.
                    </div>
                  ) : (
                    <div className="divide-y divide-border border border-border rounded-lg overflow-hidden">
                      {selected.recentRuns.map((run) => (
                        <div key={run.id} className="p-3 bg-background text-xs flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-medium text-foreground truncate">
                              {run.toolName.replace(/_/g, ' ')} · <span className="text-muted-foreground">{run.journeyId}</span>
                            </div>
                            <div className="text-[11px] text-muted-foreground truncate mt-0.5">{run.outputSummary}</div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[11px] text-muted-foreground tabular-nums">{run.latencyMs}ms</span>
                            <StatusBadge status={run.executionStatus} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
