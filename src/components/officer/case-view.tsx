'use client';
import { ShieldOff } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/components/citizen/screens';
import { avatar } from '@/components/citizen/trust-pictures';
import { SimulatedBadge } from '@/components/shell/simulated-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SourceChip, StopBadge } from './stop-badge';

type Sentence = { text: string; cites: string[] };
type View = {
  case: { id: string; status: string; route: string | null; amount: number; frozenReason: string | null; assignedOfficerId: string | null; escalatedTo: string | null; pipeline: { step?: string; mode?: string } | null; createdAt: string };
  citizen: { name: string | null; cnic: string; dob: string | null; avatarId: number | null } | null;
  decision: { id: string; outcome: string; actorType: string; reasonCode: string | null; note: string | null } | null;
  systemDecision: null | {
    id: string; outcome: string; proposedAction: string; pLegit: number | null; threshold: number | null; gates: string[]; inputHash: string;
    summary: { known: Sentence[]; conflicts: Sentence[]; why_stopped: Sentence[]; would_settle: Sentence[]; source: string } | null;
    evidence: { id: string; text: string }[]; contributions: { feature: string; value: number; contribution: number; sign: string }[];
    stops: { code: string; name: string; reason: string }[]; ruleTrace: { ruleId: string; clause: string; fact: string; op: string; expected: unknown; actual: unknown; result: string }[];
    facts: { key: string; value: unknown; source: string; ref?: string }[]; proofItem: string | null; modelVersions: Record<string, string>;
  };
  documents: { id: string; docType: string; sharpness: number | null; qrSigValid: boolean | null; injectionFlag: boolean; weakSignals?: { notes: string[] } | null; createdAt: string }[];
  matches: { rank: number; registryRecordId: string; scoreBits: number; zone: string; fields: Record<string, { level: string; weight: number }>; record: Record<string, string> }[];
  payments: { id: string; amount: number; status: string; holdUntil: string | null; ledgerRef: string | null }[];
  history: { id: string; outcome: string; actorType: string; reasonCode: string | null; note: string | null; createdAt: string }[];
};

const APPROVE = ['identity_confirmed_by_document', 'evidence_reviewed', 'registry_confirmed', 'proof_received', 'service_outage_reviewed'];
const REJECT = ['not_widow', 'remarried', 'income_above_limit', 'outside_programme_area', 'under_age', 'duplicate_application', 'document_forged', 'identity_not_confirmed'];
const CLOSE = ['paid_and_confirmed', 'withdrawn', 'duplicate', 'ineligible_confirmed'];

/** O2: leads with the decision and the fact that would settle it; summary with cited evidence; sources; trace; actions */
export function OfficerCaseView({ caseId, meId }: { caseId: string; meId: string }) {
  const [v, setV] = useState<View | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [panel, setPanel] = useState<'approve' | 'reject' | 'proof' | 'escalate' | 'freeze' | 'close' | null>(null);
  const [form, setForm] = useState<{ reason: string; note: string; item: string }>({ reason: '', note: '', item: 'death_certificate' });
  const [img, setImg] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<{ ts: string; action: string; actor: string; outcome: string }[]>([]);
  const [replay, setReplay] = useState<{ identical: boolean } | null>(null);

  const load = useCallback(async () => {
    const r = await api(`/api/v1/cases/${caseId}?view=full`);
    if (r.status === 403 && r.body.code === 'CONSENT_WITHDRAWN') { setDenied('Access withdrawn by the citizen'); setV(null); return; }
    if (r.status !== 200) { setDenied(`${r.body.code}: ${r.body.detail}`); return; }
    setDenied(null); setV(r.body);
    const t = await api(`/api/v1/cases/${caseId}/timeline`);
    if (t.status === 200) setTimeline(t.body.events);
  }, [caseId]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
      if (e.key === 'a') setPanel('approve');
      if (e.key === 'r') setPanel('reject');
      if (e.key === 'p') setPanel('proof');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const act = async (path: string, body: unknown, idem = false) => {
    const r = await api(`/api/v1/cases/${caseId}/${path}`, { body, idem });
    setMsg(r.status < 300 ? `Done: ${r.body.outcome ?? r.body.status}` : `${r.body.code}: ${r.body.detail}${r.body.errors ? ` — ${r.body.errors.map((e: { path: string; message: string }) => `${e.path} ${e.message}`).join('; ')}` : ''}`);
    if (r.status < 300) { setPanel(null); setForm({ reason: '', note: '', item: 'death_certificate' }); await load(); }
  };

  if (denied) return (
    <Card data-testid="access-withdrawn"><CardContent className="flex items-center gap-3 p-6 text-lg"><ShieldOff className="size-8 text-destructive" /> {denied}. No personal data is shown; the attempt is in the citizen&apos;s access log.</CardContent></Card>
  );
  if (!v) return <p className="text-muted-foreground">Loading…</p>;
  const sd = v.systemDecision;
  const cite = (s: Sentence) => <li key={s.text}>{s.text} {s.cites.map((c) => <sup key={c} className="text-primary" title={sd?.evidence.find((e) => e.id === c)?.text}>[{c}]</sup>)}</li>;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]" data-testid="case-view">
      <div className="min-w-0 space-y-4">
        <Card>
          <CardHeader className="flex-row flex-wrap items-center gap-3 space-y-0">
            <span className="text-3xl">{avatar(v.citizen?.avatarId)}</span>
            <div className="flex-1">
              <CardTitle>{v.citizen?.name ?? 'Masked'} <span dir="ltr" className="ms-2 font-mono text-sm text-muted-foreground">{v.citizen?.cnic}</span></CardTitle>
              <p className="text-sm text-muted-foreground">Rs {v.case.amount.toLocaleString('en-US')} · {v.case.status.replace(/_/g, ' ')}{v.case.frozenReason ? ` — ${v.case.frozenReason}` : ''}</p>
            </div>
            <div className="flex flex-wrap gap-1">{sd?.gates.map((g) => <StopBadge key={g} code={g} />)}</div>
          </CardHeader>
          {sd && (
            <CardContent className="space-y-2">
              <p className="text-lg font-semibold" data-testid="lead">
                {sd.stops[0] ? `${sd.stops[0].code}: ${sd.stops[0].reason}` : sd.outcome === 'AUTO_APPROVE' ? 'Eligible and confident — approved with a cooling-off hold' : `Confidence ${sd.pLegit !== null ? (sd.pLegit * 100).toFixed(1) : '—'}% vs bar ${sd.threshold !== null ? (sd.threshold * 100).toFixed(1) : '—'}%`}
              </p>
              {sd.summary?.would_settle[0] && <p className="rounded bg-primary/10 p-2">Would settle it: {sd.summary.would_settle[0].text}</p>}
              <p className="break-all font-mono text-xs text-muted-foreground">confidence {sd.pLegit !== null ? (sd.pLegit * 100).toFixed(2) : '—'}% · bar {sd.threshold !== null ? (sd.threshold * 100).toFixed(2) : '—'}% · input {sd.inputHash.slice(0, 16)}… · summary by {sd.summary?.source ?? '—'}</p>
            </CardContent>
          )}
        </Card>

        {sd?.summary && (
          <Card>
            <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2" data-testid="summary">
              {(['known', 'conflicts', 'why_stopped', 'would_settle'] as const).map((h) => (
                <div key={h}><h4 className="mb-1 font-semibold">{{ known: 'What is known', conflicts: 'What conflicts', why_stopped: 'Why the system stopped', would_settle: 'What would settle it' }[h]}</h4>
                  <ul className="list-disc space-y-1 ps-5 text-sm">{sd.summary![h].length ? sd.summary![h].map(cite) : <li className="text-muted-foreground">—</li>}</ul></div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>Evidence <SimulatedBadge what="registries" /></CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto"><table className="w-full text-sm" data-testid="facts"><tbody>
              {sd?.facts.map((f) => <tr key={f.key} className="border-t border-border"><td className="p-1.5 text-muted-foreground">{f.key}</td><td className="p-1.5 font-medium">{typeof f.value === 'object' ? JSON.stringify(f.value) : String(f.value)}</td><td className="p-1.5"><SourceChip source={f.source} /></td><td className="p-1.5 font-mono text-xs text-muted-foreground">{f.ref}</td></tr>)}
            </tbody></table></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Identity candidates</CardTitle></CardHeader>
          <CardContent className="space-y-2" data-testid="matches">
            {v.matches.map((m) => (
              <div key={m.rank} className="rounded border border-border p-2 text-sm">
                <div className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{String.fromCharCode(64 + m.rank)}. {m.record.name ?? ''} {m.record.relationName ? `w/o ${m.record.relationName}` : ''} · {m.record.district}</span><span className="font-mono">{m.scoreBits.toFixed(1)} bits · <Badge variant={m.zone === 'match' ? 'success' : m.zone === 'review' ? 'warning' : 'outline'}>{m.zone}</Badge></span></div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs">{Object.entries(m.fields).map(([k, f]) => <span key={k} className={f.weight >= 0 ? 'text-success' : 'text-destructive'}>{k}: {f.level} ({f.weight >= 0 ? '+' : ''}{f.weight.toFixed(1)})</span>)}</div>
              </div>
            ))}
            {!v.matches.length && <p className="text-muted-foreground">No registry candidates (the registry may have been unavailable: S8).</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Rule trace</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto"><table className="w-full text-sm" data-testid="rule-trace"><tbody>
              {sd?.ruleTrace.map((t, i) => (
                <tr key={i} className="border-t border-border"><td className="p-1.5 font-mono">{t.ruleId}</td><td className="p-1.5"><a className="underline" href={`/api/v1/assist/policy`} title={t.clause}>{t.clause}</a></td><td className="p-1.5">{t.fact} {t.op} {JSON.stringify(t.expected)}</td><td className="p-1.5">{JSON.stringify(t.actual)}</td><td className="p-1.5"><Badge variant={t.result === 'true' ? 'success' : t.result === 'false' ? 'destructive' : 'warning'}>{t.result}</Badge></td></tr>
              ))}
            </tbody></table></div>
          </CardContent>
        </Card>

        {!!sd?.contributions.length && (
          <Card>
            <CardHeader><CardTitle>Largest evidence contributions</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">{sd.contributions.map((c) => <div key={c.feature} className="flex justify-between"><span>{c.feature} = {c.value}</span><span className={c.contribution >= 0 ? 'text-success' : 'text-destructive'}>{c.sign}{Math.abs(c.contribution).toFixed(2)}</span></div>)}</CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>Documents</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {v.documents.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border p-2 text-sm">
                <span>{d.docType} · sharpness {d.sharpness?.toFixed(2) ?? '—'} · QR {d.qrSigValid === null ? 'none' : d.qrSigValid ? '✓ signed' : '✗ invalid'} {d.injectionFlag && <Badge variant="destructive">instruction text</Badge>}{d.weakSignals?.notes?.map((n) => <Badge key={n} variant="outline" className="ms-1" title="Weak signal only: never used to decide">weak: {n}</Badge>)}</span>
                <Button size="sm" variant="outline" onClick={async () => { const r = await api(`/api/v1/cases/${caseId}/documents/${d.id}`); setImg(r.status === 200 ? r.body.dataUrl : null); }}>View</Button>
              </div>
            ))}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {img && <img src={img} alt="document" className="max-h-[70vh] w-full cursor-zoom-out rounded border object-contain" onClick={() => setImg(null)} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Timeline</CardTitle></CardHeader>
          <CardContent><ul className="space-y-1 text-xs" data-testid="timeline">{timeline.map((e, i) => <li key={i} className="break-all font-mono">{new Date(e.ts).toLocaleString()} · {e.action} · {e.actor} {e.outcome !== 'allowed' ? `(${e.outcome})` : ''}</li>)}</ul></CardContent>
        </Card>
      </div>

      <aside className="order-first min-w-0 space-y-3 lg:order-none">
        <Card>
          <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
          <CardContent className="grid gap-2">
            <Button onClick={() => setPanel('approve')} data-testid="action-approve">Approve (A)</Button>
            <Button variant="destructive" onClick={() => setPanel('reject')}>Reject (R)</Button>
            <Button variant="outline" onClick={() => setPanel('proof')}>Request proof (P)</Button>
            <Button variant="outline" onClick={() => setPanel('escalate')}>Escalate to senior</Button>
            <Button variant="outline" onClick={() => void act('assign', { officerId: meId })}>Assign to me</Button>
            {v.case.status === 'frozen' ? <Button variant="outline" onClick={() => setPanel('freeze')}>Unfreeze</Button> : <Button variant="outline" onClick={() => setPanel('freeze')}>Freeze</Button>}
            <Button variant="ghost" onClick={() => setPanel('close')}>Close with reason</Button>
          </CardContent>
        </Card>
        {panel && (
          <Card data-testid={`panel-${panel}`}>
            <CardContent className="space-y-2 pt-4">
              {(panel === 'approve' || panel === 'reject' || panel === 'close') && (
                <select className="w-full rounded border border-border bg-card p-2 text-sm" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} data-testid="reason">
                  <option value="">Reason code…</option>{(panel === 'approve' ? APPROVE : panel === 'reject' ? REJECT : CLOSE).map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                </select>
              )}
              {panel === 'proof' && <select className="w-full rounded border border-border bg-card p-2 text-sm" value={form.item} onChange={(e) => setForm({ ...form, item: e.target.value })}>{['cnic_front', 'cnic_back', 'death_certificate', 'income_declaration'].map((i) => <option key={i}>{i}</option>)}</select>}
              <textarea className="w-full rounded border border-border bg-card p-2 text-sm" placeholder={panel === 'reject' || panel === 'escalate' || panel === 'freeze' ? 'Note (required)' : 'Note'} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} data-testid="note" />
              <Button className="w-full" data-testid="confirm" onClick={() => {
                if (panel === 'approve') void act('decisions', { action: 'approve', reasonCode: form.reason || undefined, ...(form.note ? { note: form.note } : {}) }, true);
                if (panel === 'reject') void act('decisions', { action: 'reject', reasonCode: form.reason || undefined, note: form.note }, true);
                if (panel === 'proof') void act('decisions', { action: 'request_proof', item: form.item, ...(form.note ? { note: form.note } : {}) }, true);
                if (panel === 'escalate') void act('decisions', { action: 'escalate', note: form.note }, true);
                if (panel === 'freeze') void act(v.case.status === 'frozen' ? 'unfreeze' : 'freeze', { reason: form.note });
                if (panel === 'close') void act('close', { reasonCode: form.reason || undefined, ...(form.note ? { note: form.note } : {}) });
              }}>Confirm</Button>
            </CardContent>
          </Card>
        )}
        {msg && <p role="status" className="rounded bg-muted p-2 text-sm">{msg}</p>}
        <Card>
          <CardHeader><CardTitle>Decisions</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-xs">
            {v.history.map((h) => <div key={h.id} className="border-b border-border pb-1">{h.actorType}: <strong>{h.outcome}</strong> {h.reasonCode ? `· ${h.reasonCode}` : ''} <span className="block text-muted-foreground">{new Date(h.createdAt).toLocaleString()}</span></div>)}
            {sd && <Button size="sm" variant="outline" className="mt-2 w-full" onClick={async () => { const r = await api(`/api/v1/decisions/${sd.id}/replay`, { method: 'POST' }); setReplay(r.status === 200 ? r.body : null); }}>Replay decision</Button>}
            {replay && <p data-testid="replay-result" className={replay.identical ? 'text-success' : 'text-destructive'}>{replay.identical ? 'Replay identical ✓' : 'Replay differs ✗'}</p>}
          </CardContent>
        </Card>
        {v.payments.map((p) => <Card key={p.id}><CardContent className="pt-4 text-sm">Payment Rs {p.amount.toLocaleString('en-US')} · {p.status}{p.holdUntil && p.status === 'scheduled' ? ` until ${new Date(p.holdUntil).toLocaleTimeString()}` : ''} {p.ledgerRef && <SimulatedBadge what={p.ledgerRef} />}</CardContent></Card>)}
      </aside>
    </div>
  );
}
