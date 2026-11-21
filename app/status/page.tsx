import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { getSystemStatus } from '@/services/status';

export const dynamic = 'force-dynamic';

const variant = (s: string) => (s === 'ok' ? 'success' : s === 'degraded' ? 'warning' : 'destructive') as 'success' | 'warning' | 'destructive';

/** OBS-2: dependency health and audit-chain status. */
export default async function StatusPage() {
  let s: Awaited<ReturnType<typeof getSystemStatus>> | null = null;
  let err: string | null = null;
  try { s = await getSystemStatus(getDb()); } catch (e) { err = e instanceof Error ? e.message : String(e); }
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <h1 className="text-2xl font-bold">System status {s && <Badge variant={variant(s.overall)}>{s.overall}</Badge>}</h1>
      {err && <p className="text-destructive">Database unreachable: {err}</p>}
      {s && (
        <>
          <Card>
            <CardHeader><CardTitle>Dependencies</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {Object.entries(s.checks).map(([k, v]) => (
                <div key={k} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 last:border-0">
                  <span className="font-medium">{k}</span>
                  <span className="flex items-center gap-2">
                    {'ms' in v && v.ms !== undefined && <span className="text-muted-foreground">{v.ms} ms</span>}
                    {['rateLimiter', 'aiGateway', 'jobs', 'errorReporting'].includes(k) && <span className="text-muted-foreground">{String(v.detail)}</span>}
                    <Badge variant={variant(v.status)}>{v.status}</Badge>
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Mock services <Badge variant="warning">SIMULATED</Badge></CardTitle></CardHeader>
            <CardContent className="overflow-x-auto text-sm">
              <table className="w-full"><thead><tr className="text-muted-foreground"><th className="text-start">service</th><th className="text-start">latency</th><th className="text-start">timeout</th><th className="text-start">error</th><th className="text-start">circuit</th></tr></thead>
                <tbody>{(s.checks.mocks?.detail as { service: string; latencyMs: number; timeoutRate: number; errorRate: number; circuit: string }[] | undefined)?.map((m) => (
                  <tr key={m.service} className="border-t border-border"><td className="py-1">{m.service}</td><td>{m.latencyMs} ms</td><td>{m.timeoutRate}</td><td>{m.errorRate}</td><td>{m.circuit}</td></tr>
                ))}</tbody></table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Audit chains</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              {s.chains.map((c) => (
                <div key={c.chainId} className="flex justify-between"><span className="font-mono">{c.chainId}</span><span>{c.length} events · <Badge variant={c.intact ? 'success' : 'destructive'}>{c.intact ? 'intact' : `broken at ${c.brokenAt ?? 'tail'}`}</Badge></span></div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Last test run</CardTitle></CardHeader>
            <CardContent className="text-sm" data-testid="test-summary">
              {s.tests ? <p><Badge variant={s.tests.failed ? 'destructive' : 'success'}>{s.tests.passed} passed · {s.tests.failed} failed</Badge> in {s.tests.files} files · {new Date(s.tests.at).toLocaleString()} <span className="text-muted-foreground">{Object.entries(s.tests.suites).map(([k, n]) => `${k} ${n}`).join(' · ')}</span></p> : <p className="text-muted-foreground">No summary yet (pnpm test:summary).</p>}
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">version {s.version} · {s.time}</p>
        </>
      )}
    </main>
  );
}
