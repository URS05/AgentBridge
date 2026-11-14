import { useEffect, useState, type FormEvent } from 'react';
import { Lock, RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';
import type { PolicySettings } from '../../core/types';
import { api } from '../api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';

export function SettingsView({ onReset }: { onReset: () => void }) {
  const [policies, setPolicies] = useState<PolicySettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then((res) => setPolicies(res.policies))
      .catch(() => {});
  }, []);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!policies) return;
    setSaving(true);
    try {
      const res = await api.updatePolicies({
        blockOnOutcomeMismatch: policies.blockOnOutcomeMismatch,
        enforceIdempotency: policies.enforceIdempotency,
        requireHumanForHighRisk: policies.requireHumanForHighRisk,
        maxBackoffRetries: policies.maxBackoffRetries,
        baseBackoffMs: policies.baseBackoffMs,
      });
      setPolicies(res.policies);
      toast.success('Safety rules saved.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to save settings');
    } finally {
      setSaving(false);
    }
  }

  async function handleResetDemo() {
    try {
      await api.resetDemo();
      toast.success('Demo data restored to starting state.');
      onReset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to reset demo');
    }
  }

  if (!policies) {
    return <Skeleton className="h-64 rounded-xl max-w-4xl" />;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Safety Rules &amp; Workspace</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Control when onboardings pause for verification, duplicate protection, or manager approval.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={handleResetDemo} className="self-start">
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset Demo Data</span>
        </Button>
      </div>

      <Card className="shadow-none">
        <CardHeader className="border-b border-border pb-4">
          <CardTitle className="text-sm font-semibold">Verification &amp; Approval Policies</CardTitle>
          <CardDescription className="text-xs">
            Guardrails applied automatically across every merchant onboarding step
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-5">
          <form onSubmit={handleSave} className="space-y-4">
            <div className="flex items-center justify-between gap-4 p-3.5 rounded-lg bg-background border border-border">
              <div>
                <Label htmlFor="policy-mismatch" className="text-xs font-medium cursor-pointer">
                  Pause Onboarding When Official Record Differs
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Block account activation whenever an AI claim disagrees with the official partner system.
                </p>
              </div>
              <Switch
                id="policy-mismatch"
                checked={policies.blockOnOutcomeMismatch}
                onCheckedChange={(checked) => setPolicies({ ...policies, blockOnOutcomeMismatch: checked })}
              />
            </div>

            <div className="flex items-center justify-between gap-4 p-3.5 rounded-lg bg-background border border-border">
              <div>
                <Label htmlFor="policy-idem" className="text-xs font-medium cursor-pointer">
                  Prevent Duplicate Merchant Activations
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Ensure retries or network timeouts never trigger the same activation twice.
                </p>
              </div>
              <Switch
                id="policy-idem"
                checked={policies.enforceIdempotency}
                onCheckedChange={(checked) => setPolicies({ ...policies, enforceIdempotency: checked })}
              />
            </div>

            <div className="flex items-center justify-between gap-4 p-3.5 rounded-lg bg-background border border-border">
              <div>
                <Label htmlFor="policy-human" className="text-xs font-medium cursor-pointer">
                  Require Manager Sign-Off for High-Risk Merchants
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Route high-risk business categories to the Manager Approval Queue before going live.
                </p>
              </div>
              <Switch
                id="policy-human"
                checked={policies.requireHumanForHighRisk}
                onCheckedChange={(checked) => setPolicies({ ...policies, requireHumanForHighRisk: checked })}
              />
            </div>

            <div className="flex items-center justify-between gap-4 p-3.5 rounded-lg bg-background border border-border opacity-85">
              <div className="flex items-start gap-2.5">
                <Lock className="w-4 h-4 text-[#0095D9] dark:text-[#00B9F1] shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-medium text-foreground">
                    Allow AI Text to Override Official Records (Locked Off)
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Safety guarantee: an AI assistant can never override an official bank or compliance status.
                  </p>
                </div>
              </div>
              <span className="font-mono text-[11px] font-semibold text-[#002E6E] dark:text-[#00B9F1] shrink-0">
                LOCKED OFF
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div className="space-y-1.5">
                <Label htmlFor="max-retries" className="text-xs font-medium">
                  Automatic Re-check Attempts
                </Label>
                <Input
                  id="max-retries"
                  type="number"
                  min={1}
                  max={10}
                  value={policies.maxBackoffRetries}
                  onChange={(e) => setPolicies({ ...policies, maxBackoffRetries: Number(e.target.value) })}
                  className="bg-background font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="base-backoff" className="text-xs font-medium">
                  Initial Wait Between Re-checks (ms)
                </Label>
                <Input
                  id="base-backoff"
                  type="number"
                  min={100}
                  max={10000}
                  step={100}
                  value={policies.baseBackoffMs}
                  onChange={(e) => setPolicies({ ...policies, baseBackoffMs: Number(e.target.value) })}
                  className="bg-background font-mono"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-border flex justify-end">
              <Button type="submit" size="sm" disabled={saving}>
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? 'Saving...' : 'Save Safety Rules'}</span>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
