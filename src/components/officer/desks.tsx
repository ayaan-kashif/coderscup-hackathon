'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/components/citizen/screens';
import { SimulatedBadge } from '@/components/shell/simulated-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { MapDistrict } from '@/lib/scam-map';
import { DuressAlarmsPanel, DuressPayoutBanner } from './duress-alarms';
import { ScamHeatMap } from './scam-heat-map-lazy';

function useLoad<T>(path: string, every = 10_000) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [v, setV] = useState(0);
  const reload = useCallback(() => setV((x) => x + 1), []);
  useEffect(() => {
    let alive = true;
    const go = () => api(path).then((r) => { if (!alive) return; if (r.status === 200) { setData(r.body); setErr(null); } else setErr(`${r.body.code}: ${r.body.detail}`); });
    void go();
    const t = setInterval(() => { if (document.visibilityState !== 'hidden') void go(); }, every);
    const onVis = () => { if (document.visibilityState === 'visible') void go(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [path, every, v]);
  return { data, err, reload };
}

type Change = { id: string; citizenName: string | null; status: string; oldLast4: string | null; newLast4: string | null; requestedBy: string; coolingOffUntil: string | null; objectedAt: string | null; createdAt: string };

/** O3: pending payout changes with old and new numbers (last 4), cooling-off timer and objections */
export function PayoutDesk() {
  const { data, err, reload } = useLoad<{ items: Change[] }>('/api/v1/payout-changes', 5000);
  const [msg, setMsg] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const act = async (id: string, verb: 'approve' | 'block') => {
    const r = await api(`/api/v1/payout-changes/${id}/${verb}`, verb === 'block' ? { body: { reason: 'Blocked by the officer after review' } } : { method: 'POST' });
    setMsg(r.status < 300 ? `${verb === 'approve' ? 'Approved: cooling-off started; the old number was told "press 9 if this isn\'t you".' : 'Blocked.'}` : `${r.body.code}: ${r.body.detail}`);
    reload();
  };
  return (
    <div className="space-y-4">
    <DuressPayoutBanner />
    <Card>
      <CardHeader><CardTitle>Payout changes</CardTitle><CardDescription>No change completes without an officer, a cooling-off period and a notice to the old number. <SimulatedBadge what="SMS / IVR" /></CardDescription></CardHeader>
      <CardContent className="space-y-2" data-testid="payout-desk">
        {err && <p className="text-destructive">{err}</p>}
        {msg && <p role="status" className="rounded-xl border border-mint/30 bg-mint/10 p-2.5 text-sm text-mint animate-in fade-in-0 slide-in-from-top-1">{msg}</p>}
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-muted-foreground"><th className="p-2 text-start">Citizen</th><th className="p-2 text-start">Old → new</th><th className="p-2 text-start">Status</th><th className="p-2 text-start">Cooling-off</th><th /></tr></thead>
          <tbody>{data?.items.map((c) => (
            <tr key={c.id} className="border-t border-border" data-change={c.id}>
              <td className="p-2">{c.citizenName}</td>
              <td className="p-2 font-mono">…{c.oldLast4 ?? '—'} → …{c.newLast4}</td>
              <td className="p-2">{c.status === 'duress_hold'
                ? <a href="/o/scams" className="inline-flex items-center gap-1" data-testid="duress-hold"><Badge variant="destructive" className="animate-pulse">DURESS HOLD</Badge><span className="text-xs text-destructive underline">see Scam Desk</span></a>
                : <Badge variant={c.status === 'objected' ? 'destructive' : c.status === 'approved' ? 'success' : 'secondary'}>{c.status.replace(/_/g, ' ')}</Badge>}</td>
              <td className="p-2">{c.status === 'cooling_off' && c.coolingOffUntil && now ? `${Math.max(0, Math.round((new Date(c.coolingOffUntil).getTime() - now) / 1000))} s` : c.objectedAt ? 'objected (press 9)' : '—'}</td>
              <td className="p-2 space-x-1">{c.status === 'pending_officer' && <><Button size="sm" onClick={() => void act(c.id, 'approve')} data-testid="payout-approve">Approve</Button><Button size="sm" variant="destructive" onClick={() => void act(c.id, 'block')}>Block</Button></>}{c.status === 'cooling_off' && <Button size="sm" variant="destructive" onClick={() => void act(c.id, 'block')}>Block</Button>}</td>
            </tr>
          ))}</tbody></table></div>
        {data && !data.items.length && <p className="text-muted-foreground">No payout changes.</p>}
      </CardContent>
    </Card>
    </div>
  );
}

type DeskItem = { id: string; district: string | null; channel: string; text: string | null; claims: Record<string, unknown>; probabilities: Record<string, unknown> | null; createdAt: string };
type Alert = { id: string; district: string; districtName: string; scamType: string; status: string; count: number; createdAt: string };
const PERIODS = [{ days: 1, label: 'Today' }, { days: 7, label: '7 days' }, { days: 30, label: '30 days' }] as const;
const TYPE_OPTIONS = [['all', 'All types'], ['fee_before_payment', 'Fee before payment'], ['asks_pin_code_cnic', 'Asks PIN / code / CNIC'], ['fake_approval_link', 'Fake approval link'], ['impersonation_call', 'Impersonation call'], ['fake_registration_drive', 'Fake registration drive'], ['lottery_prize', 'Lottery / prize']] as const;

/** O4: the scam desk: filters, the live heat map (table fallback), "not sure" messages and drafted district alerts (approve before broadcast) */
export function ScamDesk() {
  const [days, setDays] = useState<number>(7);
  const [type, setType] = useState<string>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [mapFailed, setMapFailed] = useState(false);
  const desk = useLoad<{ items: DeskItem[] }>('/api/v1/scam/desk');
  const alerts = useLoad<{ items: Alert[] }>('/api/v1/scam/alerts');
  const map = useLoad<{ districts: MapDistrict[] }>(`/api/v1/scam/map?days=${days}&type=${type}&empty=1`);
  const [msg, setMsg] = useState<string | null>(null);
  const districts = map.data?.districts ?? [];
  const sel = districts.find((d) => d.code === selected) ?? null;
  const items = desk.data?.items.filter((i) => !selected || i.district === selected);
  const selAlerts = alerts.data?.items.filter((a) => a.district === selected && a.status === 'draft') ?? [];
  const alertRow = (a: Alert) => (
    <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-2">
      <span><strong>{a.districtName}</strong> · {a.scamType.replace(/_/g, ' ')} · {a.count} today · <Badge variant={a.status === 'draft' ? 'warning' : 'secondary'}>{a.status}</Badge></span>
      {a.status === 'draft' && <span className="space-x-1"><Button size="sm" data-testid="alert-approve" onClick={async () => { const r = await api(`/api/v1/scam/alerts/${a.id}/approve`, { method: 'POST' }); setMsg(r.status < 300 ? 'Alert approved and sent (in-app, mock SMS, voice note).' : r.body.detail); alerts.reload(); map.reload(); }}>Approve & send</Button><Button size="sm" variant="ghost" onClick={async () => { await api(`/api/v1/scam/alerts/${a.id}/dismiss`, { method: 'POST' }); alerts.reload(); map.reload(); }}>Dismiss</Button></span>}
    </div>
  );
  return (
    <div className="space-y-4">
      <DuressAlarmsPanel />
      {msg && <p role="status" className="rounded-xl border border-mint/30 bg-mint/10 p-2.5 text-sm text-mint animate-in fade-in-0 slide-in-from-top-1">{msg}</p>}
      <Card>
        <CardHeader>
          <CardTitle>Scam Map</CardTitle>
          <CardDescription>Confirmed fakes by district, refreshed every 10 seconds. Fewer than 3 shows no count; no personal data.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2" data-testid="scam-filters">
            <div className="inline-flex rounded-full border border-white/10 p-0.5" role="group" aria-label="Period">
              {PERIODS.map((p) => (
                <button key={p.days} type="button" aria-pressed={days === p.days} onClick={() => setDays(p.days)} className={`rounded-full px-3 py-1 text-sm font-semibold transition-colors ${days === p.days ? 'bg-mint text-void' : 'text-white/70 hover:text-white'}`}>{p.label}</button>
              ))}
            </div>
            <select aria-label="Scam type" value={type} onChange={(e) => setType(e.target.value)} className="rounded-full border border-white/10 bg-bento px-3 py-1.5 text-sm">
              {TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            {selected && <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>Clear district: {sel?.name ?? selected}</Button>}
          </div>
          {!mapFailed && districts.length > 0 && <ScamHeatMap districts={districts} selected={selected} onSelect={(c) => setSelected((cur) => (cur === c ? null : c))} onFail={() => setMapFailed(true)} />}
          {mapFailed && <p className="text-xs text-muted-foreground" data-testid="map-fallback">The map could not start on this device. The table below has the same numbers.</p>}
          {selAlerts.length > 0 && <div className="space-y-2" data-testid="selected-alert">{selAlerts.map(alertRow)}</div>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="scam-map">
              <thead><tr className="text-muted-foreground"><th className="p-2 text-start">District</th><th className="p-2 text-start">Today</th><th className="p-2 text-start">{PERIODS.find((p) => p.days === days)?.label}</th><th className="p-2 text-start">Most common</th><th className="p-2 text-start">Spike</th></tr></thead>
              <tbody>
                {districts.map((d) => (
                  <tr key={d.code} data-district={d.code} data-selected={d.code === selected} onClick={() => setSelected((cur) => (cur === d.code ? null : d.code))} className={`cursor-pointer border-t border-border transition-colors hover:bg-white/5 ${d.code === selected ? 'bg-mint/10 outline outline-1 outline-mint/40' : ''}`}>
                    <td className="p-2 font-semibold">{d.name}</td>
                    <td className="p-2" data-testid={`today-${d.code}`}>{d.countToday ?? 'fewer than 3'}</td>
                    <td className="p-2">{d.count ?? 'fewer than 3'}</td>
                    <td className="p-2">{d.topType?.replace(/_/g, ' ') ?? '—'}</td>
                    <td className="p-2">{d.spike ? <span className="font-bold text-destructive">⚠ spike</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>District alerts</CardTitle><CardDescription>A spike (today ≥ 3× the 7-day average and ≥ 5 reports) drafts a voice alert; nothing is broadcast until an officer approves.</CardDescription></CardHeader>
        <CardContent className="space-y-2" data-testid="scam-alerts">
          {alerts.data?.items.map(alertRow)}
          {alerts.data && !alerts.data.items.length && <p className="text-muted-foreground">No alerts.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Not sure — needs a person{sel ? ` · ${sel.name}` : ''}</CardTitle></CardHeader>
        <CardContent className="space-y-2" data-testid="scam-desk">
          {items?.map((i) => (
            <div key={i.id} className="space-y-1 rounded-xl border border-border p-2 text-sm">
              <p className="font-medium">“{i.text}”</p>
              <p className="break-all text-xs text-muted-foreground">{i.district ?? '—'} · {i.channel} · Jev: {i.probabilities ? JSON.stringify(i.probabilities) : 'unavailable'}</p>
              <div className="space-x-1"><Button size="sm" variant="destructive" onClick={async () => { await api(`/api/v1/scam/reports/${i.id}/label`, { body: { label: 'fake' } }); desk.reload(); map.reload(); alerts.reload(); }}>Fake</Button><Button size="sm" variant="outline" onClick={async () => { await api(`/api/v1/scam/reports/${i.id}/label`, { body: { label: 'genuine' } }); desk.reload(); }}>Genuine</Button></div>
            </div>
          ))}
          {items && !items.length && <p className="text-muted-foreground">{selected ? `Nothing waiting in ${sel?.name ?? selected}.` : 'Nothing waiting.'}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

type Complaint = { id: string; type: string; severity: number; status: string; amountMissing: number | null; caseId: string | null; district: string | null; helperName: string | null; helperComplaints: number; createdAt: string };
type Correction = { id: string; fieldKey: string; claimedValue: unknown; oldValue: unknown; caseId: string | null; createdAt: string };
const REASONS = ['deduction_confirmed', 'helper_misconduct', 'ledger_matches_full_amount', 'insufficient_evidence', 'referred_to_police', 'referred_to_programme', 'payout_change_fraud', 'resolved_with_citizen'];

/** O6: complaints by severity then age, with the linked payment, ledger entry, timeline and helper actions; corrections */
export function ComplaintsDesk() {
  const list = useLoad<{ items: Complaint[] }>('/api/v1/complaints');
  const corr = useLoad<{ items: Correction[] }>('/api/v1/corrections');
  const [open, setOpen] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState({ resolution: 'upheld', reasonCode: '', note: '' });
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Complaints</CardTitle><CardDescription>Severity is set by rules; the model can only raise it.</CardDescription></CardHeader>
        <CardContent className="space-y-2" data-testid="complaints">
          {list.data?.items.map((c) => (
            <button key={c.id} type="button" className="flex w-full items-center justify-between gap-2 rounded-xl border border-border p-2 text-start text-sm hover:bg-muted" onClick={async () => { const r = await api(`/api/v1/complaints/${c.id}`); setOpen(r.status === 200 ? r.body : { error: r.body.detail }); }}>
              <span><Badge variant={c.severity >= 3 ? 'destructive' : c.severity === 2 ? 'warning' : 'secondary'}>sev {c.severity}</Badge> {c.type.replace(/_/g, ' ')}{c.amountMissing ? ` · Rs ${c.amountMissing} missing` : ''}{c.helperName ? ` · helper ${c.helperName} (${c.helperComplaints})` : ''}</span>
              <span className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleString()}</span>
            </button>
          ))}
          {list.data && !list.data.items.length && <p className="text-muted-foreground">No open complaints.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{open ? 'Complaint' : 'Corrections'}</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {open ? (() => {
            const o = open as { complaint?: { id: string; description: string | null }; payment?: { amount: number; ledgerRef: string | null; confirmedAmount: number | null; walletLast4: string | null } | null; ledgerEntry?: unknown; helperActions?: { ts: string; action: string }[]; earlierHelperComplaints?: unknown[]; timeline?: { action: string; ts: string }[]; error?: string };
            if (o.error) return <p className="text-destructive">{o.error}</p>;
            return (
              <div className="space-y-2" data-testid="complaint-view">
                <p>{o.complaint?.description}</p>
                {o.payment && <p>Payment Rs {o.payment.amount} · received {o.payment.confirmedAmount ?? '—'} · wallet …{o.payment.walletLast4} · ledger {o.payment.ledgerRef} <SimulatedBadge what="ledger" /></p>}
                <p className="break-all text-xs">Ledger entry: <code>{JSON.stringify(o.ledgerEntry)}</code></p>
                <p className="text-xs">Helper actions on this case: {o.helperActions?.length ?? 0} · earlier complaints against the helper: {o.earlierHelperComplaints?.length ?? 0}</p>
                <details><summary>Case timeline ({o.timeline?.length ?? 0})</summary><ul className="text-xs">{o.timeline?.map((e, i) => <li key={i}>{new Date(e.ts).toLocaleString()} · {e.action}</li>)}</ul></details>
                <select className="w-full rounded-xl border border-white/12 bg-white/5 transition-colors focus-visible:border-mint -2" value={form.resolution} onChange={(e) => setForm({ ...form, resolution: e.target.value })}>{['upheld', 'not_upheld', 'referred'].map((r) => <option key={r}>{r}</option>)}</select>
                <select className="w-full rounded-xl border border-white/12 bg-white/5 transition-colors focus-visible:border-mint -2" value={form.reasonCode} onChange={(e) => setForm({ ...form, reasonCode: e.target.value })}><option value="">Reason code…</option>{REASONS.map((r) => <option key={r}>{r}</option>)}</select>
                <textarea className="w-full rounded-xl border border-white/12 bg-white/5 transition-colors focus-visible:border-mint -2" placeholder="Note (required)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                <div className="flex gap-2">
                  <Button onClick={async () => { const r = await api(`/api/v1/complaints/${o.complaint!.id}/resolve`, { body: { resolution: form.resolution, reasonCode: form.reasonCode || undefined, note: form.note } }); setMsg(r.status < 300 ? 'Resolved; the citizen hears the outcome.' : `${r.body.code}: ${r.body.detail}`); if (r.status < 300) { setOpen(null); list.reload(); } }}>Resolve</Button>
                  <Button variant="ghost" onClick={() => setOpen(null)}>Back</Button>
                </div>
              </div>
            );
          })() : (
            <div className="space-y-2" data-testid="corrections">
              {corr.data?.items.map((c) => (
                <div key={c.id} className="rounded-xl border border-border p-2">
                  <p><strong>{c.fieldKey}</strong>: {JSON.stringify(c.oldValue)} → <strong>{JSON.stringify(c.claimedValue)}</strong></p>
                  <div className="mt-1 space-x-1">
                    <Button size="sm" onClick={async () => { const r = await api(`/api/v1/corrections/${c.id}/approve`, { body: { reasonCode: 'document_supports_claim' } }); setMsg(r.status < 300 ? 'Approved: stored as an officer fact; the case is re-decided.' : r.body.detail); corr.reload(); }}>Approve</Button>
                    <Button size="sm" variant="outline" onClick={async () => { const r = await api(`/api/v1/corrections/${c.id}/reject`, { body: { reasonCode: 'no_evidence' } }); setMsg(r.status < 300 ? 'Rejected.' : r.body.detail); corr.reload(); }}>Reject</Button>
                  </div>
                </div>
              ))}
              {corr.data && !corr.data.items.length && <p className="text-muted-foreground">No open correction requests.</p>}
            </div>
          )}
          {msg && <p role="status" className="rounded-xl bg-muted p-2">{msg}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
