'use client';
import { useEffect, useState } from 'react';
import { api } from '@/components/citizen/screens';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type Data = {
  districts: { code: string; name: string }[];
  funnel: { step: string; label: string; n: number; fromPrevious: number | null }[];
  timeToDecision: { decided: number; automaticMinutes: { p50: number | null; p90: number | null }; officerHours: { p50: number | null; p90: number | null } };
  officerWorkload: { officer: string; open: number; decided: number }[];
  complaintsByHelper: { helper: string; complaints: number; deduction: number; open: number }[];
  consentWithdrawals: { total: number; byDay: { day: string; n: number }[] };
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
const fmt = (v: number | null, unit: string) => (v === null ? '—' : `${v} ${unit}`);

/** A7: one office's programme at a glance. Aggregates only; every number is scoped to this tenant on the server. */
export function AnalyticsPanel() {
  const [from, setFrom] = useState(() => iso(new Date(Date.now() - 90 * 86_400_000)));
  const [to, setTo] = useState(() => iso(new Date()));
  const [district, setDistrict] = useState('');
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const q = new URLSearchParams({ from, to, ...(district ? { district } : {}) });
    void api(`/api/v1/admin/analytics?${q}`).then((r) => { if (!alive) return; if (r.status === 200) { setD(r.body); setErr(null); } else setErr(r.body.detail ?? String(r.status)); });
    return () => { alive = false; };
  }, [from, to, district]);
  const max = Math.max(1, ...(d?.funnel.map((f) => f.n) ?? [1]));
  return (
    <div className="space-y-4" data-testid="analytics">
      {/* filters in one row above the charts */}
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <label className="grid gap-1">From<Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="grid gap-1">To<Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="grid gap-1">District
          <select className="h-10 rounded border border-border bg-card px-2" value={district} onChange={(e) => setDistrict(e.target.value)} data-testid="analytics-district">
            <option value="">All districts</option>
            {d?.districts.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
          </select>
        </label>
      </div>
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
      {d && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Funnel: application to confirmed receipt</CardTitle><CardDescription>Cases started in the period. The percentage is the share that reached the next step.</CardDescription></CardHeader>
            <CardContent>
              <ol className="space-y-2" aria-label="funnel">
                {d.funnel.map((f) => (
                  <li key={f.step} className="grid grid-cols-[9rem_1fr_6rem] items-center gap-2 text-sm" title={`${f.label}: ${f.n}${f.fromPrevious !== null ? ` (${pct(f.fromPrevious)} of the previous step)` : ''}`}>
                    <span>{f.label}</span>
                    <span className="h-5 rounded-e bg-muted" aria-hidden>
                      <span className="block h-5 rounded-e-[4px] bg-primary" style={{ width: `${(f.n / max) * 100}%`, minWidth: f.n ? 4 : 0 }} />
                    </span>
                    <span className="text-end tabular-nums">{f.n}{f.fromPrevious !== null && <span className="ms-1 text-xs text-muted-foreground">{pct(f.fromPrevious)}</span>}</span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Time to decision</CardTitle><CardDescription>{d.timeToDecision.decided} decided cases in the period.</CardDescription></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-muted-foreground">Automatic check, median</p><p className="text-2xl font-semibold tabular-nums">{fmt(d.timeToDecision.automaticMinutes.p50, 'min')}</p><p className="text-xs text-muted-foreground">90th percentile {fmt(d.timeToDecision.automaticMinutes.p90, 'min')}</p></div>
              <div><p className="text-muted-foreground">Officer decision, median</p><p className="text-2xl font-semibold tabular-nums">{fmt(d.timeToDecision.officerHours.p50, 'h')}</p><p className="text-xs text-muted-foreground">90th percentile {fmt(d.timeToDecision.officerHours.p90, 'h')}</p></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Consent withdrawals</CardTitle><CardDescription>Citizens who stopped sharing in the period.</CardDescription></CardHeader>
            <CardContent className="text-sm">
              <p className="text-2xl font-semibold tabular-nums">{d.consentWithdrawals.total}</p>
              {d.consentWithdrawals.byDay.slice(-7).map((w) => <p key={w.day} className="text-xs text-muted-foreground">{w.day}: {w.n}</p>)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Officer workload</CardTitle><CardDescription>Assigned cases still open, and cases each officer decided.</CardDescription></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm"><thead><tr className="text-muted-foreground"><th className="text-start">Officer</th><th className="text-end">Open</th><th className="text-end">Decided</th></tr></thead>
                <tbody>{d.officerWorkload.length ? d.officerWorkload.map((w) => <tr key={w.officer} className="border-t border-border"><td>{w.officer}</td><td className="text-end tabular-nums">{w.open}</td><td className="text-end tabular-nums">{w.decided}</td></tr>) : <tr><td colSpan={3} className="text-muted-foreground">No assigned cases.</td></tr>}</tbody></table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Complaints by helper</CardTitle><CardDescription>Deductions are the &quot;received less&quot; complaints (HELP-6 watches these).</CardDescription></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm"><thead><tr className="text-muted-foreground"><th className="text-start">Helper</th><th className="text-end">All</th><th className="text-end">Deduction</th><th className="text-end">Open</th></tr></thead>
                <tbody>{d.complaintsByHelper.length ? d.complaintsByHelper.map((h) => <tr key={h.helper} className="border-t border-border"><td>{h.helper}</td><td className="text-end tabular-nums">{h.complaints}</td><td className="text-end tabular-nums">{h.deduction}</td><td className="text-end tabular-nums">{h.open}</td></tr>) : <tr><td colSpan={4} className="text-muted-foreground">No complaints.</td></tr>}</tbody></table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
