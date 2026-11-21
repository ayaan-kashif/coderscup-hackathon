'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/components/citizen/screens';
import { StopBadge } from './stop-badge';

type Item = { id: string; status: string; route: string | null; priority: number; waitingHours: number; district: string | null; gates: string[] | null; pLegit: number | null; threshold: number | null; assignedOfficerId: string | null; frozenReason: string | null; firstOpenedAt: string | null };

const STATUSES = [['all_open', 'All open'], ['in_review', 'In review'], ['needs_proof', 'Needs proof'], ['frozen', 'Frozen']] as const;

/** O1: priority (stop severity, waiting time, vulnerability), then lowest confidence. J/K move, Enter opens (§16.2). */
export function OfficerQueue() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [f, setF] = useState<{ status: string; stop: string; district: string; mine: boolean }>({ status: 'all_open', stop: '', district: '', mine: false });
  const [sel, setSel] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    const qs = new URLSearchParams({ status: f.status, ...(f.stop ? { stop: f.stop } : {}), ...(f.district ? { district: f.district } : {}), ...(f.mine ? { mine: 'true' } : {}) });
    return api(`/api/v1/queue?${qs}`).then((r) => { if (r.status === 200) { setItems(r.body.items); setCounts(r.body.countsByStop); setErr(null); } else setErr(`${r.body.code}: ${r.body.detail}`); });
  }, [f]);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 15000); return () => clearInterval(t); }, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
      if (e.key === 'j') setSel((s) => Math.min(items.length - 1, s + 1));
      if (e.key === 'k') setSel((s) => Math.max(0, s - 1));
      if (e.key === 'Enter' && items[sel]) router.push(`/o/cases/${items[sel].id}`);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, sel, router]);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted-foreground">Status
          <select className="block h-9 rounded-xl border border-white/12 bg-white/5 transition-colors focus-visible:border-mint -2 text-sm" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label className="text-xs text-muted-foreground">Stop
          <select className="block h-9 rounded-xl border border-white/12 bg-white/5 transition-colors focus-visible:border-mint -2 text-sm" value={f.stop} onChange={(e) => setF({ ...f, stop: e.target.value })}><option value="">Any</option>{Array.from({ length: 12 }, (_, i) => `S${i + 1}`).map((s) => <option key={s} value={s}>{s}{counts[s] ? ` (${counts[s]})` : ''}</option>)}</select>
        </label>
        <label className="text-xs text-muted-foreground">District
          <input className="block h-9 w-20 rounded-xl border border-white/12 bg-white/5 transition-colors focus-visible:border-mint -2 text-sm" value={f.district} placeholder="BDN" onChange={(e) => setF({ ...f, district: e.target.value.toUpperCase() })} />
        </label>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={f.mine} onChange={(e) => setF({ ...f, mine: e.target.checked })} /> Assigned to me</label>
        <span className="ms-auto text-xs text-muted-foreground">J / K move · Enter opens · in a case: A approve · R reject · P proof</span>
      </div>
      <div className="flex flex-wrap gap-1">{Object.entries(counts).sort().map(([k, n]) => <StopBadge key={k} code={k} suffix={` ${n}`} />)}</div>
      {err && <p role="alert" className="text-destructive">{err}</p>}
      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full text-sm" data-testid="queue">
          <thead className="sticky top-0 bg-muted text-start"><tr>
            <th className="p-2 text-start">Priority</th><th className="p-2 text-start">Stops</th><th className="p-2 text-start">Confidence</th><th className="p-2 text-start">Waiting</th><th className="p-2 text-start">District</th><th className="p-2 text-start">Status</th><th className="p-2"></th>
          </tr></thead>
          <tbody>
            {items.map((r, i) => (
              <tr key={r.id} className={`border-t border-border ${i === sel ? 'bg-primary/10' : ''}`} data-case={r.id} onClick={() => setSel(i)}>
                <td className="p-2 font-mono">{r.priority}</td>
                <td className="p-2"><div className="flex flex-wrap gap-1">{(r.gates ?? []).map((g) => <StopBadge key={g} code={g} />)}{!r.gates?.length && <span className="text-muted-foreground">{r.route ?? '—'}</span>}</div></td>
                <td className="p-2 font-mono">{r.pLegit !== null ? `${(r.pLegit * 100).toFixed(1)}%` : '—'}{r.threshold ? <span className="text-xs text-muted-foreground"> / {(r.threshold * 100).toFixed(1)}%</span> : null}</td>
                <td className="p-2">{r.waitingHours < 1 ? `${Math.round(r.waitingHours * 60)} min` : `${r.waitingHours} h`}</td>
                <td className="p-2">{r.district ?? '—'}</td>
                <td className="p-2"><Badge variant={r.status === 'frozen' ? 'destructive' : 'secondary'}>{r.status.replace(/_/g, ' ')}</Badge>{r.firstOpenedAt ? ' 👁' : ''}</td>
                <td className="p-2"><Button size="sm" onClick={() => router.push(`/o/cases/${r.id}`)}>Open</Button></td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Nothing waiting. New cases appear here when the pipeline hands them to a person.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
