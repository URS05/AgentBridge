import { useState, type FormEvent } from 'react';
import { FlaskConical, Play, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import type { JourneyScenario } from '../../core/types';
import { api } from '../api';
import { HUMAN_SCENARIO_LABELS } from '../humanCopy';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const PRESET_MERCHANTS = [
  'Narmada Retail Logistics Pvt Ltd',
  'Vindhya Pay & Mart',
  'Coromandel Spice Exports',
  'Malabar Diagnostics Hub',
];

export function LaunchJourneyModal({
  open,
  onClose,
  onCreated,
  onBatchCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (journeyId: string) => void;
  onBatchCreated?: () => void;
}) {
  const [tab, setTab] = useState<'single' | 'batch'>('single');
  const [merchantName, setMerchantName] = useState(PRESET_MERCHANTS[0]);
  const [scenario, setScenario] = useState<JourneyScenario>('FALSE_COMPLETION');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!merchantName.trim() || merchantName.trim().length < 2) {
      setError('Please enter a merchant business name (at least 2 characters).');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const { journey } = await api.startJourney({ merchantName: merchantName.trim(), scenario });
      toast.success(`Started onboarding for ${journey.merchantName}`);
      onCreated(journey.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start onboarding');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRunBatch(count: number, mismatchRatePct: number, timeoutRatePct: number) {
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.simulateBatch({
        count,
        mismatchRatePct,
        timeoutRatePct,
        highRiskRatePct: 8,
        spreadHours: 24,
      });
      toast.success(
        `Simulated ${res.createdCount.toLocaleString()} A2A onboardings in ${res.elapsedMs}ms (${res.summary.mismatches} mismatches caught).`
      );
      onBatchCreated?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Batch simulation failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetSeed() {
    setError(null);
    setSubmitting(true);
    try {
      await api.resetDemo();
      toast.success('Reset workspace back to clean 3-merchant seed.');
      onBatchCreated?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-xl bg-card text-card-foreground border border-border p-6">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Demo Simulator — Start Merchant Onboarding</DialogTitle>
          <DialogDescription>
            Simulate a single merchant scenario or inject an A2A volume batch to demonstrate AgentBridge verification.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'single' | 'batch')} className="mt-1">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="single">Single Merchant Scenario</TabsTrigger>
            <TabsTrigger value="batch">A2A Scale Batch</TabsTrigger>
          </TabsList>

          <TabsContent value="single" className="mt-4">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="merchant-name-input" className="text-xs font-medium">
                  Merchant Business Name
                </Label>
                <Input
                  id="merchant-name-input"
                  value={merchantName}
                  onChange={(e) => setMerchantName(e.target.value)}
                  placeholder="e.g. Narmada Retail Logistics Pvt Ltd"
                  className="bg-background"
                />
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {PRESET_MERCHANTS.map((name) => (
                    <Button
                      key={name}
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => setMerchantName(name)}
                    >
                      {name}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-medium">Choose a Test Scenario</Label>
                <div className="grid grid-cols-1 gap-2 max-h-60 overflow-y-auto pr-1">
                  {(Object.keys(HUMAN_SCENARIO_LABELS) as JourneyScenario[]).map((key) => {
                    const meta = HUMAN_SCENARIO_LABELS[key];
                    const selected = scenario === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setScenario(key)}
                        className={`text-left p-3 rounded-lg border transition-colors ${
                          selected
                            ? 'bg-primary/10 border-primary text-foreground'
                            : 'bg-background border-border text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-foreground">{meta.title}</span>
                          {key === 'FALSE_COMPLETION' && (
                            <span className="text-[11px] font-semibold text-[#0095D9] dark:text-[#00B9F1]">
                              Recommended Demo
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{meta.summary}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-xs text-destructive">
                  {error}
                </div>
              )}

              <DialogFooter className="bg-transparent border-t border-border pt-4 px-0 pb-0 mx-0 mb-0">
                <Button type="button" variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  <Play className="w-3.5 h-3.5" />
                  <span>{submitting ? 'Running Checks...' : 'Start Onboarding'}</span>
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>

          <TabsContent value="batch" className="mt-4 space-y-4">
            <div className="rounded-lg border border-border bg-secondary/35 p-4 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <FlaskConical className="w-4 h-4 text-[#0095D9]" />
                <span>High-Volume A2A Scale &amp; Clustering Study</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Generate timestamped merchant onboardings across Pi agents, A2A handoff hops, and authoritative bank gates to test Top 5 issue clustering and p95 latency spikes.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={() => void handleRunBatch(500, 12, 6)}
                className="justify-start h-auto py-3 px-4 text-left"
              >
                <div>
                  <div className="text-xs font-semibold text-foreground">Load 500 Steady Cases</div>
                  <div className="text-[11px] text-muted-foreground font-normal">12% KYC mismatch · 6% timeouts</div>
                </div>
              </Button>
              <Button
                type="button"
                disabled={submitting}
                onClick={() => void handleRunBatch(2000, 22, 10)}
                className="justify-start h-auto py-3 px-4 text-left"
              >
                <div>
                  <div className="text-xs font-semibold">Load 2,000 Spike Cases</div>
                  <div className="text-[11px] opacity-85 font-normal">22% KYC mismatch · 10% timeouts</div>
                </div>
              </Button>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-border">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={submitting}
                onClick={() => void handleResetSeed()}
                className="text-muted-foreground"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset to Clean 3-Merchant Seed</span>
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={onClose}>
                Close
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
