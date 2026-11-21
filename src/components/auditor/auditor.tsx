'use client';
import { useState } from 'react';
import { api } from '@/components/citizen/screens';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type Item = { type: 'case' | 'ai'; id: string; kind: string; outcome: string; createdAt: string; caseId?: string; actor?: string; inputHash: string; model?: string; gates?: string[] };

/** AU1: search case decisions and AI decisions together; the trace with all versions and the input hash; replay */
export function DecisionSearch() {
  const [q, setQ] = useState({ caseId: '', citizenId: '', actor: '', kind: 'all' });
  const [items, setItems] = useState<Item[]>([]);
  const [trace, setTrace] = useState<Record<string, unknown> | null>(null);
  const [replay, setReplay] = useState<{ identical: boolean; stored: unknown; replayed: unknown; inputHash: string; decisionHashNow: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const search = async () => {
    const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v).map(([k, v]) => [k, v]));
    const r = await api(`/api/v1/decisions?${qs}`);
    if (r.status === 200) { setItems(r.body.items); setMsg(`${r.body.items.length} result(s)`); } else setMsg(`${r.body.code}: ${r.body.detail}`);
  };
  const open = async (it: Item) => {
    setReplay(null);
    const r = await api(it.type === 'case' ? `/api/v1/decisions/${it.id}` : `/api/v1/ai-decisions/${it.id}`);
    setTrace(r.status === 200 ? r.body : { error: `${r.body.code}: ${r.body.detail}` });
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Decision search</CardTitle><CardDescription>Case decisions (system and officer) and AI decisions outside a case: scam verdicts, intent routing, complaint triage, policy answers, second opinions.</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input placeholder="case id" value={q.caseId} onChange={(e) => setQ({ ...q, caseId: e.target.value.trim() })} />
            <Input placeholder="citizen id" value={q.citizenId} onChange={(e) => setQ({ ...q, citizenId: e.target.value.trim() })} />
            <Input placeholder="actor id (e.g. pipeline:case.process)" value={q.actor} onChange={(e) => setQ({ ...q, actor: e.target.value.trim() })} />
            <select className="h-10 rounded-xl border border-white/12 bg-white/5 transition-colors focus-visible:border-mint -2 text-sm" value={q.kind} onChange={(e) => setQ({ ...q, kind: e.target.value })}><option value="all">case + AI decisions</option><option value="case">case decisions</option><option value="ai">AI decisions</option></select>
          </div>
          <Button onClick={() => void search()} data-testid="search-decisions">Search</Button>
          {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
          <ul className="max-h-[60vh] space-y-1 overflow-y-auto text-sm" data-testid="decision-results">
            {items.map((it) => (
              <li key={it.id}><button type="button" className="w-full rounded-xl border border-border p-2 text-start hover:bg-muted" onClick={() => void open(it)}>
                <Badge variant={it.type === 'case' ? 'secondary' : 'outline'}>{it.kind.replace(/_/g, ' ')}</Badge> <strong>{it.outcome}</strong> {it.gates?.map((g) => <Badge key={g} variant="warning" className="ms-1">{g}</Badge>)}
                <span className="block font-mono text-xs text-muted-foreground">{new Date(it.createdAt).toLocaleString()} · {it.actor ?? it.model} · input {it.inputHash.slice(0, 12)}…</span>
              </button></li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Trace</CardTitle><CardDescription>Input hash, rule set and scorer versions, model and prompt versions, probability, threshold, outcome and actor. Personal fields are removed unless break-glass is open.</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          {trace ? (
            <>
              {'outcome' in trace && 'caseId' in trace && (
                <Button variant="outline" data-testid="replay" onClick={async () => { const r = await api(`/api/v1/decisions/${String(trace.id)}/replay`, { method: 'POST' }); setReplay(r.status === 200 ? r.body : null); setMsg(r.status === 200 ? null : `${r.body.code}: ${r.body.detail}`); }}>Replay</Button>
              )}
              {replay && <p className={`rounded-xl p-2 text-sm ${replay.identical ? 'bg-success/15' : 'bg-destructive/15'}`} data-testid="replay-verdict">{replay.identical ? 'Replay identical: same input hash, same decision hash.' : 'Replay differs.'} <span className="font-mono text-xs">{replay.decisionHashNow.slice(0, 16)}…</span></p>}
              <pre className="max-h-[60vh] overflow-auto rounded-xl bg-muted p-2 text-xs" data-testid="trace">{JSON.stringify(trace, null, 1)}</pre>
            </>
          ) : <p className="text-sm text-muted-foreground">Open a result.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

/** AU3: one citizen's consent records and every data read, allowed and denied; break-glass with a reason */
export function ConsentAccess() {
  const [caseId, setCaseId] = useState('');
  const [data, setData] = useState<{ citizenId: string; consents: { id: string; status: string; purpose: string; dataCategories: string[]; createdAt: string; withdrawnAt: string | null }[]; events: { ts: string; action: string; actorType: string; actorId: string; outcome: string; details: Record<string, unknown> }[] } | null>(null);
  const [bg, setBg] = useState({ basis: 'open_complaint', complaintId: '', reason: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const load = async () => {
    const r = await api(`/api/v1/audit/access?caseId=${caseId}`);
    if (r.status === 200) { setData(r.body); setMsg(null); } else setMsg(`${r.body.code}: ${r.body.detail}`);
  };
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Consent and access</CardTitle><CardDescription>Lawful use: every consent and every read of her data, allowed and refused.</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          <div className="flex gap-2"><Input placeholder="case id" value={caseId} onChange={(e) => setCaseId(e.target.value.trim())} /><Button onClick={() => void load()} data-testid="load-access">Load</Button></div>
          {msg && <p role="alert" className="text-sm text-destructive">{msg}</p>}
          {data && (
            <>
              <h4 className="font-semibold">Consents</h4>
              <ul className="text-sm">{data.consents.map((c) => <li key={c.id}><Badge variant={c.status === 'active' ? 'success' : 'destructive'}>{c.status}</Badge> {c.purpose} · {c.dataCategories.join(', ')} · {new Date(c.createdAt).toLocaleString()}{c.withdrawnAt ? ` → withdrawn ${new Date(c.withdrawnAt).toLocaleString()}` : ''}</li>)}</ul>
              <h4 className="font-semibold">Access log</h4>
              <div className="overflow-x-auto"><table className="w-full text-xs" data-testid="access-events"><tbody>{data.events.map((e, i) => (
                <tr key={i} className={`border-t border-border ${e.outcome === 'denied' ? 'bg-destructive/10' : ''}`}><td className="p-1">{new Date(e.ts).toLocaleString()}</td><td className="p-1">{e.action}</td><td className="p-1 font-mono">{e.actorType}:{e.actorId.slice(0, 18)}</td><td className="p-1">{e.outcome}{e.details?.code ? ` (${String(e.details.code)})` : ''}</td></tr>
              ))}</tbody></table></div>
            </>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Break-glass</CardTitle><CardDescription>Personal fields of one case for 30 minutes, only for an open complaint or a legal request, with a written reason. It appears in the citizen&apos;s access log.</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          <select className="h-10 w-full rounded-xl border border-white/12 bg-white/5 transition-colors focus-visible:border-mint -2 text-sm" value={bg.basis} onChange={(e) => setBg({ ...bg, basis: e.target.value })}><option value="open_complaint">Open complaint</option><option value="legal_request">Legal request</option></select>
          {bg.basis === 'open_complaint' && <Input placeholder="complaint id" value={bg.complaintId} onChange={(e) => setBg({ ...bg, complaintId: e.target.value.trim() })} />}
          <textarea className="w-full rounded-xl border border-white/12 bg-white/5 transition-colors focus-visible:border-mint -2 text-sm" placeholder="Reason (at least 15 characters)" value={bg.reason} onChange={(e) => setBg({ ...bg, reason: e.target.value })} />
          <Button variant="destructive" disabled={!caseId} onClick={async () => {
            const r = await api('/api/v1/audit/break-glass', { body: { caseId, basis: bg.basis, reason: bg.reason, ...(bg.complaintId ? { complaintId: bg.complaintId } : {}) } });
            setMsg(r.status === 201 ? `Break-glass open until ${new Date(r.body.expiresAt).toLocaleTimeString()}; logged in her access log.` : `${r.body.code}: ${r.body.detail}`);
          }}>Open break-glass</Button>
        </CardContent>
      </Card>
    </div>
  );
}
