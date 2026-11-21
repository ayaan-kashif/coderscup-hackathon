'use client';
import { AlertOctagon, Ban, ShieldCheck, UserX } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/components/citizen/screens';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export type DuressAlarm = {
  id: string; type: string; severity: string; status: 'open' | 'confirmed_block' | 'escalated' | 'marked_safe'; trigger: 'pin_verify' | 'payout_change' | 'helper_unlock'; createdAt: string;
  citizen: { id: string; name: string; avatarId: number | null }; caseId: string | null; caseStatus: string | null; payoutChangeId: string | null;
  attempted: { payoutChangeIds: string[]; oldLast4: string | null; newLast4: string | null } | null;
  helper: { id: string; name: string | null } | null; helperGrantIds: string[]; frozenCaseIds: string[];
  session: { requestId: string; actorId: string; actorRole: string | null; ip: string; userAgent: string | null; deviceId?: string | null };
  resolvedAt: string | null; resolutionNote: string | null;
};

const TRIGGER: Record<DuressAlarm['trigger'], string> = {
  pin_verify: 'Reversed PIN at sign-in',
  payout_change: 'Reversed PIN on a payout-number change',
  helper_unlock: 'Reversed PIN on a helper phone (family unlock)',
};
const ACTIONS = {
  confirm_block: { label: 'Confirm Permanent Block', note: 'Confirmed coercion: payout change permanently blocked.', Icon: Ban, variant: 'destructive' as const },
  escalate: { label: 'Escalate / Flag Helper', note: 'Escalated: helper flagged and removed from this family pending investigation.', Icon: UserX, variant: 'outline' as const },
  mark_safe: { label: 'Mark Safe (after voice check)', note: 'Called her back alone and verified by voice: no coercion.', Icon: ShieldCheck, variant: 'secondary' as const },
};

/** Loads the office's duress alarms; shared by the Scam Desk panel and the Payouts link-through. */
export function useDuressAlarms(every = 5000) {
  const [items, setItems] = useState<DuressAlarm[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [v, setV] = useState(0);
  const reload = useCallback(() => setV((x) => x + 1), []);
  useEffect(() => {
    let alive = true;
    const go = () => api('/api/v1/scam/duress').then((r) => { if (!alive) return; if (r.status === 200) { setItems(r.body.items); setErr(null); } else setErr(`${r.body.code}: ${r.body.detail}`); });
    void go();
    const t = setInterval(go, every);
    return () => { alive = false; clearInterval(t); };
  }, [every, v]);
  return { items, err, reload };
}

/**
 * Silent Duress alarms, pinned to the very top of the Scam Desk. A pulsing red COERCION / DURESS ALARM badge,
 * who was acting, the attempted wallet change and one-click resolutions. Officers must not contact the helper.
 */
export function DuressAlarmsPanel() {
  const { items, err, reload } = useDuressAlarms();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const resolve = async (a: DuressAlarm, action: keyof typeof ACTIONS) => {
    setBusy(a.id);
    const r = await api(`/api/v1/scam/duress/${a.id}/resolve`, { body: { action, note: ACTIONS[action].note } });
    setBusy(null);
    setMsg(r.status < 300 ? `${ACTIONS[action].label}: done for ${a.citizen.name}.` : `${r.body.code}: ${r.body.detail}`);
    reload();
  };
  const open = items?.filter((a) => a.status === 'open' || a.status === 'escalated') ?? [];
  const closed = items?.filter((a) => a.status === 'confirmed_block' || a.status === 'marked_safe') ?? [];
  return (
    <section className="space-y-3" data-testid="duress-alarms" aria-label="Silent duress alarms">
      {err && <p className="text-destructive">{err}</p>}
      {msg && <p role="status" className="rounded-xl border border-mint/30 bg-mint/10 p-2.5 text-sm text-mint animate-in fade-in-0 slide-in-from-top-1">{msg}</p>}
      <AnimatePresence initial={false}>
        {open.map((a) => (
          <motion.article key={a.id} layout initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }}
            className="relative overflow-hidden rounded-[24px] border-2 border-destructive bg-destructive/10 p-5 shadow-[0_0_0_6px_rgb(255_107_107/0.12)]" data-testid="duress-alarm" data-status={a.status}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <span className="relative inline-flex items-center gap-2 rounded-full bg-destructive px-3 py-1 text-xs font-black uppercase tracking-wider text-void">
                  <span className="absolute inset-0 animate-ping rounded-full bg-destructive opacity-40" aria-hidden />
                  <AlertOctagon className="relative size-4" aria-hidden /><span className="relative">Coercion / Duress Alarm</span>
                </span>
                <h3 className="text-lg font-extrabold leading-tight">Silent Duress PIN Triggered — Potential In-Person Coercion. <span className="text-destructive">Do NOT notify the helper.</span></h3>
                <p className="text-sm text-white/75">{TRIGGER[a.trigger]} · {new Date(a.createdAt).toLocaleString()} · <Badge variant="destructive">{a.severity}</Badge> {a.status === 'escalated' && <Badge variant="warning">escalated</Badge>}</p>
              </div>
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl bg-void/50 p-3"><dt className="micro-label text-label">Citizen</dt><dd className="font-semibold">{a.citizen.name}</dd><dd className="font-mono text-xs text-white/60">case {a.caseId?.slice(0, 8) ?? '—'} · {a.caseStatus ?? '—'}</dd></div>
              <div className="rounded-2xl bg-void/50 p-3"><dt className="micro-label text-label">Attempted wallet change</dt>
                <dd className="font-mono text-base" dir="ltr">{a.attempted ? <>…{a.attempted.oldLast4 ?? '—'} <span className="text-destructive">→ …{a.attempted.newLast4}</span></> : 'none in this request'}</dd>
                <dd className="text-xs text-white/60">{a.attempted ? 'held: can never be paid out' : 'case frozen, payments on hold'}</dd></div>
              <div className="rounded-2xl bg-void/50 p-3"><dt className="micro-label text-label">Acting helper</dt><dd className="font-semibold">{a.helper ? a.helper.name ?? a.helper.id.slice(0, 8) : 'none (citizen device)'}</dd><dd className="text-xs text-white/60">{a.helperGrantIds.length} unlock(s) quarantined</dd></div>
              <div className="rounded-2xl bg-void/50 p-3"><dt className="micro-label text-label">Session</dt><dd className="font-mono text-xs" dir="ltr">IP {a.session.ip}</dd><dd className="truncate font-mono text-xs text-white/60" dir="ltr" title={a.session.userAgent ?? ''}>{a.session.userAgent ?? 'no user agent'}</dd>{a.session.deviceId && <dd className="font-mono text-xs text-white/60">device {a.session.deviceId}</dd>}</div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              {(Object.keys(ACTIONS) as (keyof typeof ACTIONS)[]).filter((k) => !(a.status === 'escalated' && k === 'escalate')).map((k) => {
                const { label, Icon, variant } = ACTIONS[k];
                return <Button key={k} size="sm" variant={variant} disabled={busy === a.id} onClick={() => void resolve(a, k)} data-testid={`duress-${k}`}><Icon /> {label}</Button>;
              })}
            </div>
          </motion.article>
        ))}
      </AnimatePresence>
      {items && !open.length && <p className="rounded-2xl border border-white/10 bg-bento p-4 text-sm text-white/60">No open duress alarms.</p>}
      {!!closed.length && (
        <details className="rounded-2xl border border-white/10 bg-bento p-4 text-sm">
          <summary className="font-semibold">Resolved duress alarms ({closed.length})</summary>
          <ul className="mt-2 space-y-1">{closed.map((a) => <li key={a.id} className="text-white/70">{new Date(a.createdAt).toLocaleString()} · {a.citizen.name} · <Badge variant={a.status === 'marked_safe' ? 'success' : 'destructive'}>{a.status.replace('_', ' ')}</Badge> {a.resolutionNote}</li>)}</ul>
        </details>
      )}
    </section>
  );
}

/** Payout desk banner: links held changes to the Scam Desk alarm */
export function DuressPayoutBanner() {
  const { items } = useDuressAlarms(8000);
  const open = items?.filter((a) => a.status === 'open' || a.status === 'escalated') ?? [];
  if (!open.length) return null;
  return (
    <Link href="/o/scams" className="flex items-center gap-3 rounded-[20px] border-2 border-destructive bg-destructive/10 p-4 transition-colors hover:bg-destructive/20" data-testid="duress-payout-banner">
      <AlertOctagon className="size-6 shrink-0 animate-pulse text-destructive" aria-hidden />
      <span className="text-sm"><strong className="text-destructive">{open.length} silent duress alarm{open.length > 1 ? 's' : ''}</strong>: payout changes marked <em>duress hold</em> cannot be approved here. Resolve them on the Scam Desk →</span>
    </Link>
  );
}
