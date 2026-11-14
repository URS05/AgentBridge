import { useState } from 'react';
import { Bot, Maximize2, X } from 'lucide-react';
import { AssistantChatPanel } from './AssistantChatPanel';
import { Button } from '@/components/ui/button';

export function FloatingPaytmBot({
  open,
  onOpenChange,
  currentPath,
  focusJourneyId,
  initialQuestion,
  initialQuestionNonce,
  onNavigate,
  onOpenLaunch,
  onMutated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPath: string;
  focusJourneyId?: string;
  initialQuestion?: string | null;
  initialQuestionNonce?: number;
  onNavigate: (path: string) => void;
  onOpenLaunch: () => void;
  onMutated: () => void;
}) {
  const [greetingDismissed, setGreetingDismissed] = useState(false);

  // Do not show floating corner widget on the full-screen /chat page itself
  if (currentPath === '/chat') {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 sm:bottom-5 sm:right-5 z-40 flex flex-col items-end gap-2">
      {/* Expanded Bottom-Right Paytm Bot Chat Popover */}
      {open && (
        <section
          aria-label="Paytm Bot Assistant"
          className="w-[min(430px,calc(100vw-2rem))] h-[min(590px,calc(100vh-6.5rem))] rounded-2xl border border-border bg-card shadow-2xl flex flex-col overflow-hidden"
        >
          <div className="px-4 py-3 bg-[#002E6E] text-white flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4 text-[#00B9F1]" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold leading-tight flex items-center gap-1.5">
                  <span>Paytm Bot</span>
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[#00B9F1]/20 text-[#9BE8FF]">
                    Sarvam AI
                  </span>
                </div>
                <div className="text-[11px] text-white/80 truncate">
                  Hi! I am Paytm Bot — Let me help you navigate
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                onClick={() => {
                  onOpenChange(false);
                  onNavigate('/chat');
                }}
                title="Open full ChatGPT-style screen"
                aria-label="Expand Paytm Bot to full screen"
                className="text-white/80 hover:text-white hover:bg-white/15"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </Button>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                aria-label="Close Paytm Bot"
                className="text-white/80 hover:text-white hover:bg-white/15"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="flex-1 min-h-0">
            <AssistantChatPanel
              compact
              currentPath={currentPath}
              focusJourneyId={focusJourneyId}
              initialQuestion={initialQuestion}
              initialQuestionNonce={initialQuestionNonce}
              onNavigate={(path) => {
                onOpenChange(false);
                onNavigate(path);
              }}
              onOpenLaunch={() => {
                onOpenChange(false);
                onOpenLaunch();
              }}
              onMutated={onMutated}
            />
          </div>
        </section>
      )}

      {/* Compact Single-Row Bottom-Right Paytm Bot Launcher with Greeting */}
      {!open && (
        <div className="flex items-center rounded-full bg-[#002E6E] text-white shadow-lg border border-[#00B9F1]/45 dark:bg-[#00B9F1] dark:text-[#04152D] overflow-hidden">
          <button
            type="button"
            onClick={() => onOpenChange(true)}
            aria-label="Open Paytm Bot Assistant Chat"
            className="h-11 pl-3.5 pr-3 flex items-center gap-2.5 text-xs font-medium hover:bg-white/10 dark:hover:bg-black/10 transition-colors focus:outline-none"
          >
            <span className="w-6 h-6 rounded-full bg-[#00B9F1]/25 dark:bg-[#04152D]/15 flex items-center justify-center shrink-0">
              <Bot className="w-3.5 h-3.5 text-[#00B9F1] dark:text-[#04152D]" />
            </span>
            <span className="font-semibold whitespace-nowrap">Paytm Bot</span>
            {!greetingDismissed && (
              <span className="hidden sm:inline text-[11px] font-normal text-white/85 dark:text-[#04152D]/85 border-l border-white/25 dark:border-[#04152D]/25 pl-2 whitespace-nowrap">
                Hi! Let me help you navigate
              </span>
            )}
          </button>
          {!greetingDismissed && (
            <button
              type="button"
              onClick={() => setGreetingDismissed(true)}
              aria-label="Dismiss Paytm Bot greeting"
              className="hidden sm:flex h-11 pr-3 pl-1 items-center text-white/65 hover:text-white dark:text-[#04152D]/65 dark:hover:text-[#04152D] transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
