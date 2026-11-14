import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { EvidenceRecord, IdempotencyRecord, ValidationCheck, ValidationType } from '../../core/types';
import { api } from '../api';
import { HUMAN_STAGE_LABELS, humanizeBlockedReason, humanizeStateValue } from '../humanCopy';
import { StatusBadge } from '../components/StatusBadge';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type EnrichedCheck = ValidationCheck & {
  merchantName: string;
  externalReference: string;
  reportedState: string | null;
  evidence: EvidenceRecord | null;
};

export function ValidationCentreView({
  refreshKey,
  onNavigate,
}: {
  refreshKey: number;
  onNavigate: (path: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<'ALL' | ValidationType>('BUSINESS_OUTCOME');
  const [resultFilter, setResultFilter] = useState<string>('ALL');
  const [checks, setChecks] = useState<EnrichedCheck[]>([]);
  const [idempotencyKeys, setIdempotencyKeys] = useState<IdempotencyRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .getValidations({ type: activeTab, result: resultFilter })
      .then((res) => {
        setChecks(res.checks);
        setIdempotencyKeys(res.idempotencyKeys);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeTab, resultFilter, refreshKey]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Verification &amp; Safety Checks</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Every onboarding step passes three independent checks before funds or merchant activation can proceed.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'ALL' | ValidationType)}>
            <TabsList>
              <TabsTrigger value="BUSINESS_OUTCOME">Official System</TabsTrigger>
              <TabsTrigger value="EXECUTION">Duplicate &amp; Permissions</TabsTrigger>
              <TabsTrigger value="AI_RESPONSE">AI Format</TabsTrigger>
              <TabsTrigger value="ALL">All</TabsTrigger>
            </TabsList>
          </Tabs>

          <Select value={resultFilter} onValueChange={(v) => setResultFilter(v ?? 'ALL')}>
            <SelectTrigger className="w-[155px] bg-card" aria-label="Filter by check result">
              <SelectValue placeholder="All Outcomes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Outcomes</SelectItem>
              <SelectItem value="MISMATCH">Mismatch Detected</SelectItem>
              <SelectItem value="FAIL">Check Failed</SelectItem>
              <SelectItem value="UNAVAILABLE">Partner Offline</SelectItem>
              <SelectItem value="PASS">Confirmed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-3">
        {loading ? (
          <Skeleton className="h-44 rounded-xl" />
        ) : checks.length === 0 ? (
          <Card className="p-10 text-center text-xs text-muted-foreground shadow-none">
            No checks match the selected category and outcome filter.
          </Card>
        ) : (
          checks.map((chk) => (
            <Card key={chk.id} className="py-4 gap-3 shadow-none">
              <CardContent className="px-5 py-0 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold text-foreground">{chk.merchantName}</span>
                    <span className="text-muted-foreground">· {HUMAN_STAGE_LABELS[chk.stageName] ?? chk.stageName}</span>
                    <span className="text-muted-foreground">· {chk.externalReference}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={chk.result} />
                    <Button size="xs" variant="outline" onClick={() => onNavigate(`/journeys/${chk.journeyId}`)}>
                      <span>Open Case</span>
                      <ArrowRight className="w-3 h-3" />
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="rounded-lg bg-background border border-border px-3.5 py-2.5">
                    <div className="text-[11px] text-muted-foreground">Required Result</div>
                    <div className="font-medium text-foreground mt-0.5">{humanizeStateValue(chk.expectedValue)}</div>
                  </div>
                  <div className="rounded-lg bg-background border border-border px-3.5 py-2.5">
                    <div className="text-[11px] text-muted-foreground">Actual Observed Result</div>
                    <div
                      className={`font-medium mt-0.5 ${
                        chk.result === 'PASS' ? 'text-[#16A34A] dark:text-[#2DD4A4]' : 'text-destructive'
                      }`}
                    >
                      {humanizeStateValue(chk.actualValue)}
                    </div>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">{humanizeBlockedReason(chk.reason)}</p>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Duplicate Action Prevention Table */}
      <Card className="py-0 gap-0 shadow-none overflow-hidden">
        <CardHeader className="px-5 py-4 border-b border-border">
          <CardTitle className="text-sm font-semibold">Duplicate Action Prevention Log</CardTitle>
          <CardDescription className="text-xs mt-0.5">
            Tracks unique operation locks so network retries never create duplicate merchant accounts
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/40 hover:bg-secondary/40">
                <TableHead className="px-4 text-xs">Action Type</TableHead>
                <TableHead className="px-4 text-xs">Case ID</TableHead>
                <TableHead className="px-4 text-xs">Attempts</TableHead>
                <TableHead className="px-4 text-xs">Status</TableHead>
                <TableHead className="px-4 text-xs">Lock Key</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {idempotencyKeys.slice(0, 10).map((k) => (
                <TableRow key={k.key}>
                  <TableCell className="px-4 py-2.5 text-xs font-medium text-foreground">
                    {k.operationType.replace(/_/g, ' ')}
                  </TableCell>
                  <TableCell className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{k.journeyId}</TableCell>
                  <TableCell className="px-4 py-2.5 font-mono text-xs tabular-nums">{k.attemptCount}</TableCell>
                  <TableCell className="px-4 py-2.5">
                    <StatusBadge status={k.status} />
                  </TableCell>
                  <TableCell className="px-4 py-2.5 font-mono text-[11px] text-muted-foreground">{k.key}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
