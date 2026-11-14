import { useEffect, useState } from 'react';
import { Compass, Play, Sparkles } from 'lucide-react';
import type { Journey } from '../../core/types';
import { api } from '../api';
import { HUMAN_STAGE_LABELS } from '../humanCopy';
import { AssistantChatPanel } from '../components/AssistantChatPanel';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '@/components/ui/button';

const EXPLAINER_TOPICS: Array<{ label: string; prompt: string }> = [
  { label: 'Explain Dashboard & Navigation', prompt: 'Explain how this dashboard works and help me navigate' },
  { label: 'Explain Pi Agent Protocols', prompt: 'Explain Connected Systems & Pi agent protocols' },
  { label: 'Explain Manager Approvals', prompt: 'Explain the Manager Approvals queue' },
];

export function ChatView({
  refreshKey,
  onNavigate,
  onOpenLaunch,
  onMutated,
}: {
  refreshKey: number;
  onNavigate: (path: string) => void;
  onOpenLaunch: () => void;
  onMutated: () => void;
}) {
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [focusId, setFocusId] = useState<string | undefined>(undefined);
  const [queuedPrompt, setQueuedPrompt] = useState<string | null>(null);
  const [promptNonce, setPromptNonce] = useState(0);

  useEffect(() => {
    api
      .getJourneys({ pageSize: 12 })
      .then((res) => setJourneys(res.journeys))
      .catch(() => {});
  }, [refreshKey]);

  function triggerPrompt(prompt: string) {
    setQueuedPrompt(prompt);
    setPromptNonce((n) => n + 1);
  }

  return (
    <div className="h-[calc(100vh-10rem)] min-h-[520px] flex flex-col lg:flex-row gap-4">
      {/* Slim Minimal Left Rail */}
      <aside className="lg:w-[256px] shrink-0 rounded-2xl border border-border bg-card flex flex-col overflow-hidden">
        <div className="p-3 border-b border-border space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Sparkles className="w-3.5 h-3.5 text-[#0095D9]" />
              <span>Paytm Bot</span>
            </div>
            {focusId && (
              <Button size="xs" variant="ghost" onClick={() => setFocusId(undefined)}>
                Clear
              </Button>
            )}
          </div>

          <Button
            size="sm"
            onClick={onOpenLaunch}
            className="w-full justify-center rounded-xl bg-[#002E6E] hover:bg-[#002354] text-white dark:bg-[#00B9F1] dark:text-[#04152D]"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Start Onboarding</span>
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-border/70">
          <div className="p-2.5 space-y-1">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Screen Guides
            </div>
            {EXPLAINER_TOPICS.map((topic) => (
              <button
                key={topic.label}
                type="button"
                onClick={() => triggerPrompt(topic.prompt)}
                className="w-full text-left px-2.5 py-2 rounded-lg text-xs text-foreground hover:bg-secondary/60 transition-colors flex items-center gap-2"
              >
                <Compass className="w-3.5 h-3.5 text-[#0095D9] shrink-0" />
                <span className="truncate">{topic.label}</span>
              </button>
            ))}
          </div>

          <div className="p-2.5 space-y-1">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Merchants
            </div>
            {journeys.slice(0, 8).map((j) => {
              const selected = focusId === j.id;
              return (
                <button
                  key={j.id}
                  type="button"
                  onClick={() => {
                    setFocusId(selected ? undefined : j.id);
                    if (!selected) {
                      triggerPrompt(`Why is ${j.merchantName} in its current status?`);
                    }
                  }}
                  className={`w-full text-left px-2.5 py-2 rounded-lg flex items-center justify-between gap-2 text-xs transition-colors ${
                    selected ? 'bg-[#E6F7FD] dark:bg-[#14294D]' : 'hover:bg-secondary/60'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-medium text-foreground truncate">{j.merchantName}</div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {HUMAN_STAGE_LABELS[j.currentStage]}
                    </div>
                  </div>
                  <StatusBadge status={j.status} />
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      {/* Main Minimal ChatGPT Conversation Canvas */}
      <div className="flex-1 min-w-0 rounded-2xl border border-border bg-card overflow-hidden flex flex-col">
        <AssistantChatPanel
          currentPath="/chat"
          focusJourneyId={focusId}
          initialQuestion={queuedPrompt}
          initialQuestionNonce={promptNonce}
          onNavigate={onNavigate}
          onOpenLaunch={onOpenLaunch}
          onMutated={onMutated}
        />
      </div>
    </div>
  );
}
