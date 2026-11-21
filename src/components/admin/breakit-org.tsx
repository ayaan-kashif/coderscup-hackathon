'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/components/citizen/screens';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type Result = { id: string; caseRef: string; attackNo: number | null; expected: { behaviour: string }; actual: { detail: string; caseId: string | null; decisionId: string | null }; result: string };
const COLOR: Record<string, 'success' | 'warning' | 'destructive' | 'secondary' | 'outline'> = { caught: 'success', pass: 'success', asked: 'warning', escalated: 'secondary', false_alarm: 'destructive', missed: 'destructive' };

/** A4 Break It: run the 18 attacks + controls through the live pipeline in the sandbox; misses stay on the page */
export function BreakIt({ sandbox }: { sandbox: boolean }) {
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<{ status: string; metrics: Record<string, Record<string, number>> | null; createdAt: string } | null>(null);
  const [rows, setRows] = useState<Result[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async (id: string) => {
    const r = await api(`/api/v1/eval/runs/${id}`);
    if (r.status === 200) { setRun(r.body.run); setRows(r.body.results); }
    return r.body?.run?.status as string | undefined;
  }, []);
  useEffect(() => {
    let alive = true;
    void api('/api/v1/eval/runs?kind=break_it').then((r) => { if (alive && r.status === 200 && r.body.items[0]) { setRunId(r.body.items[0].id); void load(r.body.items[0].id); } });
    return () => { alive = false; };
  }, [load]);
  useEffect(() => {
    if (!runId || run?.status !== 'running') return;
    const t = setInterval(() => void load(runId), 2500);
    return () => clearInterval(t);
  }, [runId, run?.status, load]);
  const tally = (pred: (r: Result) => boolean) => rows.filter(pred).reduce<Record<string, number>>((a, r) => ({ ...a, [r.result]: (a[r.result] ?? 0) + 1 }), {});
  return (
    <Card data-testid="break-it">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <div><CardTitle>Break It</CardTitle><CardDescription>18 attacks, 20 clean control cases and 5 genuine messages checked for someone else, through the live pipeline in the sandbox office. Results: caught, asked for proof, escalated, false alarm, missed.</CardDescription></div>
        <Button disabled={!sandbox || run?.status === 'running'} data-testid="run-breakit" onClick={async () => {
          const r = await api('/api/v1/eval/break-it', { method: 'POST' });
          if (r.status === 202) { setRunId(r.body.id); setRun({ status: 'running', metrics: null, createdAt: new Date().toISOString() }); setRows([]); setMsg(null); } else setMsg(`${r.body.code}: ${r.body.detail}`);
        }}>{run?.status === 'running' ? 'Running…' : 'Run Break It'}</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {!sandbox && <p className="rounded bg-muted p-2 text-sm">Break It runs only in the sandbox office (sign in as the Break It admin). Real offices see the latest report read-only.</p>}
        {msg && <p role="alert" className="text-destructive">{msg}</p>}
        {run && <p className="text-sm">Run {run.status} · {new Date(run.createdAt).toLocaleString()}</p>}
        {!!rows.length && (
          <>
            <div className="flex flex-wrap gap-4 text-sm" data-testid="breakit-tally">
              {[['Attacks', (r: Result) => !!r.attackNo], ['Controls', (r: Result) => r.caseRef.startsWith('Control')], ['Genuine messages', (r: Result) => r.caseRef.startsWith('Genuine')]].map(([label, pred]) => (
                <div key={label as string}><strong>{label as string}:</strong> {Object.entries(tally(pred as (r: Result) => boolean)).map(([k, n]) => <Badge key={k} variant={COLOR[k] ?? 'outline'} className="ms-1">{n} {k.replace('_', ' ')}</Badge>)}</div>
              ))}
            </div>
            <div className="overflow-x-auto"><table className="w-full text-sm" data-testid="breakit-results">
              <thead><tr className="text-muted-foreground"><th className="p-2 text-start">#</th><th className="p-2 text-start">Expected</th><th className="p-2 text-start">Result</th><th className="p-2 text-start">What happened</th><th className="p-2 text-start">Trace</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id} className={`border-t border-border ${r.result === 'missed' || r.result === 'false_alarm' ? 'bg-destructive/10' : ''}`} data-result={r.result}>
                  <td className="p-2">{r.caseRef}</td><td className="p-2 text-muted-foreground">{r.expected.behaviour}</td><td className="p-2"><Badge variant={COLOR[r.result] ?? 'outline'}>{r.result.replace('_', ' ')}</Badge></td>
                  <td className="p-2 text-xs">{r.actual.detail}</td><td className="p-2 font-mono text-xs">{r.actual.decisionId ? `decision ${r.actual.decisionId.slice(0, 8)}` : r.actual.caseId ? `case ${r.actual.caseId.slice(0, 8)}` : '—'}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** A5 config: model IDs, cooling-off durations, auto cap, floor (every change audited) */
export function ConfigPanel() {
  const [cfg, setCfg] = useState<Record<string, { value: unknown; scope: string }> | null>(null);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [v, setV] = useState(0);
  useEffect(() => { let alive = true; void api('/api/v1/admin/config').then((r) => { if (alive && r.status === 200) setCfg(r.body.config); }); return () => { alive = false; }; }, [v]);
  const KEYS = ['models.ids', 'cooling_off.approval_minutes', 'cooling_off.payout_change_minutes', 'payments.autoCap', 'decision.floor', 'pipeline.inline_fallback'];
  return (
    <Card data-testid="config-panel">
      <CardHeader><CardTitle>Configuration</CardTitle><CardDescription>Model IDs (swap a model without a redeploy), cooling-off periods, the auto cap and the confidence floor. Every save is an audit event.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        {cfg && KEYS.map((k) => {
          const cur = JSON.stringify(cfg[k]?.value ?? null, null, k === 'models.ids' ? 1 : undefined);
          return (
            <div key={k} className="space-y-1">
              <label className="text-sm font-medium">{k} <Badge variant="outline">{cfg[k]?.scope ?? 'default'}</Badge></label>
              {k === 'models.ids'
                ? <textarea className="h-40 w-full rounded border border-border bg-card p-2 font-mono text-xs" value={edit[k] ?? cur} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />
                : <Input className="font-mono" value={edit[k] ?? cur} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />}
              {edit[k] !== undefined && edit[k] !== cur && <Button size="sm" onClick={async () => {
                let value: unknown;
                try { value = JSON.parse(edit[k]!); } catch { setMsg(`${k}: not valid JSON`); return; }
                const r = await api('/api/v1/admin/config', { method: 'PUT', body: { key: k, value } });
                setMsg(r.status === 200 ? `${k} saved (audited).` : `${r.body.code}: ${r.body.detail}`);
                if (r.status === 200) { setEdit({}); setV((x) => x + 1); }
              }}>Save {k}</Button>}
            </div>
          );
        })}
        {msg && <p role="status" className="text-sm">{msg}</p>}
      </CardContent>
    </Card>
  );
}

/** A6 organisation: users and roles, session revocation, API keys (created once, revoked any time) */
export function OrgPanel() {
  const [users, setUsers] = useState<{ id: string; email: string; name: string; role: string; isSenior: boolean; sessionsRevokedAt: string | null }[]>([]);
  const [keys, setKeys] = useState<{ id: string; name: string; prefix: string; scopes: string[]; lastUsedAt: string | null; revokedAt: string | null }[]>([]);
  const [nu, setNu] = useState({ email: '', displayName: '', role: 'officer' });
  const [nk, setNk] = useState({ name: '', scopes: ['cases:read'] as string[] });
  const [shown, setShown] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [v, setV] = useState(0);
  useEffect(() => {
    let alive = true;
    void Promise.all([api('/api/v1/admin/users'), api('/api/v1/admin/api-keys')]).then(([a, b]) => { if (!alive) return; if (a.status === 200) setUsers(a.body.items); if (b.status === 200) setKeys(b.body.items); });
    return () => { alive = false; };
  }, [v]);
  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="org-panel">
      <Card>
        <CardHeader><CardTitle>Users and roles</CardTitle><CardDescription>Fictional .test addresses only.</CardDescription></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {users.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-1">
              <span>{u.name} <span className="text-xs text-muted-foreground">{u.email}</span> <Badge variant="secondary">{u.role}{u.isSenior ? ' · senior' : ''}</Badge></span>
              <Button size="sm" variant="ghost" onClick={async () => { const r = await api(`/api/v1/admin/users/${u.id}/revoke-sessions`, { method: 'POST' }); setMsg(r.status === 200 ? `Sessions of ${u.name} revoked.` : r.body.detail); }}>Revoke sessions</Button>
            </div>
          ))}
          <div className="grid gap-2 pt-2 sm:grid-cols-3">
            <Input placeholder="name.surname@office.amanat.test" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} />
            <Input placeholder="Display name (fictional)" value={nu.displayName} onChange={(e) => setNu({ ...nu, displayName: e.target.value })} />
            <select className="h-10 rounded border border-border bg-card px-2" value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })}>{['officer', 'admin', 'auditor', 'helper'].map((r) => <option key={r}>{r}</option>)}</select>
          </div>
          <Button size="sm" onClick={async () => { const r = await api('/api/v1/admin/users', { body: nu, idem: true }); setShown(r.status === 201 ? `Temporary password (shown once): ${r.body.temporaryPassword}` : null); setMsg(r.status === 201 ? 'User added.' : `${r.body.code}: ${r.body.detail}`); setV((x) => x + 1); }}>Add user</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>API keys</CardTitle><CardDescription>Only the peppered SHA-256 is stored; the key is shown once. Send it as <code>X-API-Key</code>.</CardDescription></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {keys.map((k) => (
            <div key={k.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-1">
              <span>{k.name} <span className="font-mono text-xs">amk_{k.prefix}_…</span> {k.scopes.map((s) => <Badge key={s} variant="outline" className="ms-1">{s}</Badge>)} {k.revokedAt && <Badge variant="destructive">revoked</Badge>}</span>
              <span className="text-xs text-muted-foreground">{k.lastUsedAt ? `used ${new Date(k.lastUsedAt).toLocaleString()}` : 'never used'}</span>
              {!k.revokedAt && <Button size="sm" variant="ghost" onClick={async () => { await api(`/api/v1/admin/api-keys/${k.id}/revoke`, { method: 'POST' }); setV((x) => x + 1); }}>Revoke</Button>}
            </div>
          ))}
          <Input placeholder="Key name, e.g. Partner NGO (fictional)" value={nk.name} onChange={(e) => setNk({ ...nk, name: e.target.value })} />
          <div className="flex flex-wrap gap-3">{['cases:read', 'cases:write', 'scam:check'].map((s) => <label key={s} className="flex items-center gap-1"><input type="checkbox" checked={nk.scopes.includes(s)} onChange={(e) => setNk({ ...nk, scopes: e.target.checked ? [...nk.scopes, s] : nk.scopes.filter((x) => x !== s) })} /> {s}</label>)}</div>
          <Button size="sm" onClick={async () => { const r = await api('/api/v1/admin/api-keys', { body: nk, idem: true }); setShown(r.status === 201 ? `Key (shown once): ${r.body.key}` : null); setMsg(r.status === 201 ? 'Key created.' : `${r.body.code}: ${r.body.detail}`); setV((x) => x + 1); }}>Create key</Button>
        </CardContent>
      </Card>
      {shown && <p className="rounded border-2 border-warning p-2 font-mono text-sm lg:col-span-2" role="status">{shown}</p>}
      {msg && <p className="text-sm lg:col-span-2" role="status">{msg}</p>}
    </div>
  );
}
