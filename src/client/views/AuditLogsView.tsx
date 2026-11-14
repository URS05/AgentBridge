import { useEffect, useState } from 'react';
import { Download, Search, ShieldAlert, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import type { AuditEvent } from '../../core/types';
import { api } from '../api';
import { HUMAN_EVENT_LABELS, humanizeStateToken } from '../humanCopy';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export function AuditLogsView({
  refreshKey,
  onNavigate,
}: {
  refreshKey: number;
  onNavigate: (path: string) => void;
}) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [search, setSearch] = useState('');
  const [eventType, setEventType] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [chainResult, setChainResult] = useState<{
    valid: boolean;
    totalEvents: number;
    reason: string;
  } | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .getAuditLogs({ eventType, q: search })
      .then((res) => setEvents(res.events))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [eventType, search, refreshKey]);

  async function handleVerifyChain() {
    try {
      const res = await api.verifyAuditChain();
      setChainResult(res);
      if (res.valid) {
        toast.success(`Audit ledger verified across ${res.totalEvents} records.`);
      } else {
        toast.error(res.reason);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Verification failed');
    }
  }

  function handleExportJson() {
    const blob = new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agentbridge-audit-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${events.length} audit records.`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Tamper-Evident Audit History</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Every decision, assistant action, and manager sign-off is permanently recorded and cryptographically linked.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={handleVerifyChain}>
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Verify Hash Chain</span>
          </Button>
          <Button size="sm" variant="outline" onClick={handleExportJson}>
            <Download className="w-3.5 h-3.5" />
            <span>Download JSON</span>
          </Button>
        </div>
      </div>

      {chainResult && (
        <Alert
          variant={chainResult.valid ? 'default' : 'destructive'}
          className={
            chainResult.valid
              ? 'border-[#16A34A]/35 bg-[#16A34A]/10 text-foreground'
              : 'border-destructive/35 bg-destructive/10'
          }
        >
          {chainResult.valid ? (
            <ShieldCheck className="w-4 h-4 text-[#16A34A]" />
          ) : (
            <ShieldAlert className="w-4 h-4" />
          )}
          <AlertTitle className="text-xs font-semibold">
            {chainResult.valid ? 'Audit Trail Integrity Confirmed' : 'Integrity Issue Detected'}
          </AlertTitle>
          <AlertDescription className="text-xs">{chainResult.reason}</AlertDescription>
        </Alert>
      )}

      <Card className="py-4 shadow-none">
        <CardContent className="px-4 py-0 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="relative md:col-span-2">
            <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search case ID, actor, or record digest..."
              aria-label="Search audit events"
              className="pl-9 bg-background"
            />
          </div>
          <Select value={eventType} onValueChange={(v) => setEventType(v ?? 'ALL')}>
            <SelectTrigger className="w-full bg-background" aria-label="Filter by event type">
              <SelectValue placeholder="All Activity Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Activity Types</SelectItem>
              <SelectItem value="JOURNEY_CREATED">Onboarding Started</SelectItem>
              <SelectItem value="OUTCOME_VERIFICATION_FAILED">Mismatch Caught</SelectItem>
              <SelectItem value="OUTCOME_VERIFICATION_PASSED">Official Record Confirmed</SelectItem>
              <SelectItem value="WORKFLOW_BLOCKED">Steps Paused for Safety</SelectItem>
              <SelectItem value="DUPLICATE_BLOCKED">Duplicate Activation Blocked</SelectItem>
              <SelectItem value="RETRY_EXECUTED">Re-check Run</SelectItem>
              <SelectItem value="APPROVAL_REQUESTED">Manager Approval Requested</SelectItem>
              <SelectItem value="APPROVAL_GRANTED">Manager Approved</SelectItem>
              <SelectItem value="JOURNEY_VERIFIED">Merchant Verified &amp; Live</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className="py-0 gap-0 shadow-none overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/40 hover:bg-secondary/40">
                <TableHead className="px-4 text-xs">No.</TableHead>
                <TableHead className="px-4 text-xs">Activity</TableHead>
                <TableHead className="px-4 text-xs">Case</TableHead>
                <TableHead className="px-4 text-xs">Actor</TableHead>
                <TableHead className="px-4 text-xs">Status Change</TableHead>
                <TableHead className="px-4 text-xs">Integrity Hash</TableHead>
                <TableHead className="px-4 text-xs text-right">Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-xs text-muted-foreground">
                    Loading audit records...
                  </TableCell>
                </TableRow>
              ) : events.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-xs text-muted-foreground">
                    No matching audit records found.
                  </TableCell>
                </TableRow>
              ) : (
                events.map((evt) => (
                  <TableRow key={evt.id}>
                    <TableCell className="px-4 py-3 font-mono text-xs text-muted-foreground">#{evt.sequence}</TableCell>
                    <TableCell className="px-4 py-3 text-xs font-medium text-foreground">
                      {HUMAN_EVENT_LABELS[evt.eventType] ?? evt.eventType}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <Button
                        variant="link"
                        size="xs"
                        className="px-0 font-mono"
                        onClick={() => onNavigate(`/journeys/${evt.journeyId}`)}
                      >
                        {evt.journeyId}
                      </Button>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-xs text-muted-foreground">{evt.actorId}</TableCell>
                    <TableCell className="px-4 py-3 text-xs text-muted-foreground max-w-xs truncate">
                      {humanizeStateToken(evt.previousState)} →{' '}
                      <span className="text-foreground">{humanizeStateToken(evt.newState)}</span>
                    </TableCell>
                    <TableCell className="px-4 py-3 font-mono text-[11px] text-muted-foreground">
                      {evt.eventHash.slice(0, 14)}…
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right text-xs text-muted-foreground tabular-nums">
                      {new Date(evt.createdAt).toLocaleTimeString()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
