'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/components/citizen/screens';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const FACTS = ['applicant.gender', 'applicant.dob', 'applicant.district', 'applicant.remarried', 'applicant.cnic_expiry', 'applicant.cnic', 'applicant.name', 'spouse.deceased', 'spouse.date_of_death', 'spouse.name', 'marriage.date', 'household.monthly_income'];
const OPS = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'exists', 'age_between', 'days_since_lte'];

type Cond = { fact: string; op: string; value?: unknown };
type Rule = { id: string; clause: string; severity: string; when: { all?: Cond[]; any?: Cond[] }; on_fail: string; on_unknown?: string; text_en: string; text_ur: string; icon: string };
type Version = { id: string; version: number; status: string; active: boolean; rules: Rule[]; thresholds: Record<string, number>; costs: Record<string, number>; jsonHash: string; createdBy: string | null; secondApprover: string | null; publishedAt: string | null; twin: { id: string; current: boolean; summary: Twin } | null };
type Twin = { snapshots: number; better: number; worse: number; same: number; inFlightHarm: number; payoutDelta: number; byDistrict: Record<string, { better: number; worse: number }>; affected: { caseId: string; name: string; district: string | null; from: string; to: string; direction: string; inFlight: boolean }[]; needsSecondAdmin: boolean; draftVersion: number };

const showValue = (v: unknown) => (v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v));
function parseValue(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}

/** A1 rules + A2 Twin report: dropdown conditions, JSON view, live validation by the server, preview, Twin, publish */
export function RulesEditor({ meId }: { meId: string }) {
  const [data, setData] = useState<{ activeRuleSetId: string | null; versions: Version[] } | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<Version | null>(null);
  const [json, setJson] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [previewCase, setPreviewCase] = useState('');
  const [preview, setPreview] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [suggestion, setSuggestion] = useState<{ summary: string; diff: { added: string[]; changed: string[]; removed: string[] }; quotes: string[]; proposed: unknown } | null>(null);

  const load = useCallback(async (select?: string) => {
    const r = await api('/api/v1/rules');
    if (r.status !== 200) { setMsg({ ok: false, text: `${r.body.code}: ${r.body.detail}` }); return; }
    setData(r.body);
    const pick = select ?? sel ?? r.body.versions.find((v: Version) => v.status === 'draft')?.id ?? r.body.activeRuleSetId;
    setSel(pick);
    const v = r.body.versions.find((x: Version) => x.id === pick) ?? null;
    setDraft(v ? structuredClone(v) : null);
    setJson(null);
  }, [sel]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || !draft) return <p className="text-muted-foreground">{msg?.text ?? 'Loading rules…'}</p>;
  const editable = draft.status === 'draft';
  const setCond = (ri: number, ci: number, patch: Partial<Cond>) => {
    const next = structuredClone(draft);
    const list = (next.rules[ri]!.when.all ?? next.rules[ri]!.when.any)!;
    list[ci] = { ...list[ci]!, ...patch };
    setDraft(next);
  };
  const save = async () => {
    setBusy(true);
    let body: { rules: unknown; thresholds: unknown; costs: unknown } = { rules: draft.rules, thresholds: draft.thresholds, costs: draft.costs };
    if (json !== null) {
      try { body = JSON.parse(json); } catch (e) { setBusy(false); setMsg({ ok: false, text: `JSON: ${(e as Error).message}` }); return; }
    }
    const r = await api(`/api/v1/rules/drafts/${draft.id}`, { method: 'PUT', body });
    setBusy(false);
    if (r.status === 200) { setMsg({ ok: true, text: `Saved v${r.body.version}. Run the Twin before publishing.` }); await load(draft.id); }
    else setMsg({ ok: false, text: `${r.body.code}: ${(r.body.errors ?? []).map((e: string | { path: string; message: string }) => (typeof e === 'string' ? e : `${e.path} ${e.message}`)).join('; ') || r.body.detail}` });
  };
  const act = async (path: string, body?: unknown, ok?: string) => {
    setBusy(true);
    const r = await api(`/api/v1/rules/drafts/${draft.id}/${path}`, body !== undefined ? { body } : { method: 'POST' });
    setBusy(false);
    setMsg(r.status < 300 ? { ok: true, text: ok ?? 'Done.' } : { ok: false, text: `${r.body.code}: ${r.body.detail}` });
    await load(draft.id);
    return r;
  };
  const twin = draft.twin?.summary;

  return (
    <div className="space-y-4" data-testid="rules-editor">
      <div className="flex flex-wrap items-center gap-2">
        {data.versions.map((v) => (
          <Button key={v.id} size="sm" variant={v.id === sel ? 'default' : 'outline'} onClick={() => void load(v.id)} data-testid={`version-${v.version}`}>
            v{v.version} {v.active ? '● active' : v.status}
          </Button>
        ))}
        <Button size="sm" variant="secondary" disabled={busy} data-testid="new-draft" onClick={async () => { const r = await api('/api/v1/rules/drafts', { body: {} }); if (r.status === 201) await load(r.body.id); else setMsg({ ok: false, text: r.body.detail }); }}>+ New draft</Button>
      </div>
      {msg && <p role="status" className={`rounded-xl p-2 text-sm ${msg.ok ? 'bg-success/15' : 'bg-destructive/15'}`} data-testid="rules-msg">{msg.text}</p>}

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <div><CardTitle>Version {draft.version} <Badge variant={editable ? 'warning' : 'secondary'}>{draft.status}</Badge></CardTitle>
            <CardDescription>{editable ? 'Conditions are built from dropdowns; the server validates against the rule JSON Schema.' : 'Published versions never change; old decisions keep citing them. Create a draft to change rules.'}</CardDescription></div>
          <Button size="sm" variant="ghost" onClick={() => setJson(json === null ? JSON.stringify({ rules: draft.rules, thresholds: draft.thresholds, costs: draft.costs }, null, 2) : null)}>{json === null ? 'JSON view' : 'Builder view'}</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {json !== null ? (
            <textarea className="h-96 w-full rounded-xl border border-white/12 bg-white/5 transition-colors focus-visible:border-mint -2 font-mono text-xs" value={json} readOnly={!editable} onChange={(e) => setJson(e.target.value)} data-testid="rules-json" />
          ) : draft.rules.map((r, ri) => (
            <div key={r.id} className="rounded-2xl border border-border p-3" data-rule={r.id}>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono font-semibold">{r.id}</span>
                <Badge variant="outline">{r.clause}</Badge>
                <Badge variant={r.severity === 'hard' ? 'secondary' : 'outline'}>{r.severity}</Badge>
                <span className="text-muted-foreground">on fail: {r.on_fail}{r.on_unknown ? ` · on unknown: ${r.on_unknown}` : ''}</span>
              </div>
              {(r.when.all ?? r.when.any ?? []).map((c, ci) => (
                <div key={ci} className="grid gap-2 sm:grid-cols-[1fr_9rem_1fr]">
                  <select disabled={!editable} className="h-9 rounded-xl border border-white/12 bg-white/5 transition-colors focus-visible:border-mint -2 text-sm" value={c.fact} onChange={(e) => setCond(ri, ci, { fact: e.target.value })} aria-label="fact">{FACTS.map((f) => <option key={f}>{f}</option>)}</select>
                  <select disabled={!editable} className="h-9 rounded-xl border border-white/12 bg-white/5 transition-colors focus-visible:border-mint -2 text-sm" value={c.op} onChange={(e) => setCond(ri, ci, { op: e.target.value })} aria-label="operator" data-testid={`op-${r.id}`}>{OPS.map((o) => <option key={o}>{o}</option>)}</select>
                  <Input disabled={!editable} value={showValue(c.value)} onChange={(e) => setCond(ri, ci, { value: parseValue(e.target.value) })} aria-label="value" data-testid={`value-${r.id}`} />
                </div>
              ))}
              <p className="mt-1 text-xs text-muted-foreground">{r.text_en} · <span dir="rtl">{r.text_ur}</span></p>
            </div>
          ))}
          {editable && <Button disabled={busy} onClick={() => void save()} data-testid="save-draft">Save draft (validated)</Button>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Preview against a case</CardTitle><CardDescription>Runs decide() on the case&apos;s stored snapshot with this version. Changes nothing.</CardDescription></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Input className="max-w-sm font-mono text-xs" placeholder="case id" value={previewCase} onChange={(e) => setPreviewCase(e.target.value.trim())} />
          <Button variant="outline" disabled={!previewCase} onClick={async () => { const r = await api(`/api/v1/rules/drafts/${draft.id}/preview`, { body: { caseId: previewCase } }); setPreview(r.body); }}>Preview</Button>
          {preview !== null && <pre className="w-full overflow-x-auto rounded-xl bg-muted p-2 text-xs">{JSON.stringify(preview, null, 1)}</pre>}
        </CardContent>
      </Card>

      {editable && (
        <Card data-testid="rule-suggest">
          <CardHeader><CardTitle>Suggest from a policy notice (AI, review only)</CardTitle><CardDescription>Paste a notice. The model proposes rule changes; nothing is saved until you load them, check them and press Save. The Twin and publishing rules still apply.</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            <textarea className="h-28 w-full rounded-xl border border-white/12 bg-white/5 transition-colors focus-visible:border-mint -2 text-sm" placeholder="e.g. From 1 January the age limit for widows rises to 65 (SRP-POL-2.1)…" value={notice} onChange={(e) => setNotice(e.target.value)} />
            <Button variant="outline" disabled={busy || notice.length < 20} onClick={async () => {
              setBusy(true);
              const r = await api(`/api/v1/rules/drafts/${draft.id}/suggest`, { body: { notice } });
              setBusy(false);
              if (r.status === 200) { setSuggestion(r.body); setMsg({ ok: true, text: 'Suggestion ready. Review it below.' }); } else { setSuggestion(null); setMsg({ ok: false, text: `${r.body.code}: ${r.body.detail}` }); }
            }}>Suggest changes</Button>
            {suggestion && (
              <div className="space-y-1 rounded-xl border border-border p-2 text-sm">
                <p>{suggestion.summary}</p>
                <p className="text-xs">Added: {suggestion.diff.added.join(', ') || '—'} · Changed: {suggestion.diff.changed.join(', ') || '—'} · Removed: {suggestion.diff.removed.join(', ') || '—'}</p>
                {suggestion.quotes.map((q) => <p key={q} className="text-xs text-muted-foreground">“{q}”</p>)}
                <Button size="sm" onClick={() => { setJson(JSON.stringify(suggestion.proposed, null, 2)); setMsg({ ok: true, text: 'Loaded into the JSON view. Check it, then press Save.' }); }}>Load into editor (not saved)</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {editable && (
        <Card data-testid="twin">
          <CardHeader><CardTitle>Digital Twin</CardTitle><CardDescription>Replays stored snapshots (last 90 days and every open case) under this draft. Sends nothing, pays nothing, changes no case. Tied to the draft&apos;s hash.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <Button disabled={busy} onClick={() => void act('twin', undefined, 'Twin run finished.')} data-testid="run-twin">Run the Twin</Button>
            {twin && (
              <div className="space-y-2 text-sm">
                {!draft.twin?.current && <p className="rounded-xl bg-warning p-2 text-warning-foreground">The draft changed after this run. Run the Twin again before publishing.</p>}
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{twin.snapshots} snapshots</Badge><Badge variant="success">{twin.better} better</Badge><Badge variant="destructive">{twin.worse} worse</Badge><Badge variant="outline">{twin.same} unchanged</Badge>
                  <Badge variant={twin.inFlightHarm ? 'destructive' : 'success'} data-testid="harm">{twin.inFlightHarm} in-flight harmed</Badge>
                  <Badge variant="outline">payout change Rs {twin.payoutDelta.toLocaleString('en-US')}</Badge>
                </div>
                {twin.inFlightHarm > 0 && <p className="rounded-xl bg-destructive/15 p-2">This version would make {twin.inFlightHarm} in-flight case(s) worse. Publishing needs a second admin (RULE-7); those cases will go to an officer with stop S11, never a silent rejection.</p>}
                <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-muted-foreground"><th className="p-1 text-start">Case (masked)</th><th className="p-1 text-start">District</th><th className="p-1 text-start">From</th><th className="p-1 text-start">To</th><th className="p-1 text-start">In flight</th></tr></thead>
                  <tbody>{twin.affected.slice(0, 50).map((a) => <tr key={a.caseId} className="border-t border-border"><td className="p-1">{a.name} <span className="font-mono text-muted-foreground">{a.caseId.slice(0, 8)}</span></td><td className="p-1">{a.district}</td><td className="p-1">{a.from}</td><td className={`p-1 ${a.direction === 'worse' ? 'text-destructive' : 'text-success'}`}>{a.to}</td><td className="p-1">{a.inFlight ? 'yes' : ''}</td></tr>)}</tbody></table></div>
                <p className="text-xs text-muted-foreground">By district: {Object.entries(twin.byDistrict).map(([d, v]) => `${d} +${v.better}/−${v.worse}`).join(' · ') || '—'}</p>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy || !twin} onClick={() => void act('approve', undefined, 'Approved as the second admin.')} data-testid="second-approve">Approve as second admin{draft.secondApprover ? ' ✓' : ''}</Button>
              <Button disabled={busy || !twin} data-testid="publish" onClick={() => void act('publish', { expectedActiveRuleSetId: data.activeRuleSetId }, `Published v${draft.version}. Open cases are being re-decided; any that would get worse go to an officer (S11).`)}>Publish</Button>
            </div>
            {draft.createdBy === meId && <p className="text-xs text-muted-foreground">You created this draft, so a different admin must give the second approval.</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
