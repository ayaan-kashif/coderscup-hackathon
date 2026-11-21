'use client';
import { motion } from 'motion/react';
import { Lock, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ApplyFlow, OutboxList, syncNow } from '@/components/apply/apply-flow';
import { avatar } from '@/components/citizen/trust-pictures';
import { api, CaseStatusScreen } from '@/components/citizen/screens';
import { Ticks } from '@/components/citizen/ticks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Keypad } from '@/components/voice/keypad';
import { VoicePrompt, playSequence } from '@/components/voice/voice-prompt';
import { outboxDb } from '@/offline/outbox';
import { startSync } from '@/offline/sync';

type Family = { citizenId: string; name: string; avatarId: number | null; cnic: string; case: { id: string; status: string; ticks: 'grey2' | 'blue2'; flagged: boolean } | null };
type Unlock = { grantId: string; citizenId: string; expiresAt: string; idleExpiresAt?: string };

const IDLE_MS = 30 * 60_000;
const WARN_MS = 2 * 60_000;

/**
 * Helper Mode (F10): H1 families → H2 the family's own PIN → H3 workspace with a banner and countdown → H4 activity.
 * Switching families locks the screen; the unlock ends after 30 idle minutes or 2 hours (the server enforces both).
 * Helpers never see trust pictures, full CNICs, payout or consent controls.
 */
export function HelperApp() {
  const [fams, setFams] = useState<Family[]>([]);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Family | null>(null);
  const [unlock, setUnlock] = useState<Unlock | null>(null);
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<'families' | 'activity'>('families');
  const [version, setVersion] = useState(0);
  const [lastActivity, setLastActivity] = useState(0);
  const [now, setNow] = useState(0);

  useEffect(() => startSync(outboxDb(), { fetch: window.fetch.bind(window), now: Date.now, random: Math.random }), []);
  useEffect(() => {
    let alive = true;
    void api('/api/v1/helper/families').then((r) => { if (alive && r.status === 200) { setFams(r.body.families); if (!r.body.unlocked) setUnlock(null); } });
    return () => { alive = false; };
  }, [version]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const lock = useCallback(async (why: 'switch' | 'expired' | 'manual') => {
    if (unlock) await api(`/api/v1/helper/grants/${unlock.grantId}`, { method: 'DELETE' }).catch(() => null);
    setUnlock(null); setSel(null); setPin('');
    if (why === 'expired') void playSequence(['helper_locked']);
    setVersion((v) => v + 1);
  }, [unlock]);

  const endsAt = unlock ? Math.min(new Date(unlock.expiresAt).getTime(), lastActivity + IDLE_MS) : 0;
  const left = unlock && now ? endsAt - now : null;
  useEffect(() => {
    if (left === null) return;
    // act from a timer callback, not synchronously in the effect body
    const t = setTimeout(() => {
      if (left <= 0) void lock('expired');
      else if (left <= WARN_MS && left > WARN_MS - 1000) void playSequence(['helper_time_ending']);
    }, 0);
    return () => clearTimeout(t);
  }, [left, lock]);

  const fam = sel ? fams.find((f) => f.citizenId === sel.citizenId) ?? sel : null;
  const banner = fam && unlock ? (
    <div className="sticky top-0 z-20 sm:top-[88px] flex items-center gap-3 rounded-[20px] border border-mint/60 bg-bento/95 p-3 shadow-[0_0_0_4px_rgb(163_247_181/0.12),0_20px_40px_-20px_rgb(0_0_0/0.8)] backdrop-blur" data-testid="family-banner">
      <span className="text-4xl" aria-hidden>{avatar(fam.avatarId)}</span>
      <div className="flex-1">
        <p className="font-bold">{fam.name}</p>
        <p className={`text-sm ${left !== null && left < WARN_MS ? 'font-bold text-destructive' : 'text-muted-foreground'}`} data-testid="countdown">
          🔓 {left !== null ? `${Math.max(0, Math.floor(left / 60000))}:${String(Math.max(0, Math.floor((left % 60000) / 1000))).padStart(2, '0')}` : '…'}
        </p>
      </div>
      <Button variant="outline" onClick={() => void lock('manual')}><Lock className="!size-5" /> Lock</Button>
    </div>
  ) : null;

  if (fam && unlock) {
    const touch = () => setLastActivity(Date.now());
    return (
      <div className="space-y-4" onPointerDown={touch} onKeyDown={touch}>
        {fam.case && fam.case.status !== 'draft'
          ? <>{banner}<CaseStatusScreen caseId={fam.case.id} onProof={() => {}} onReceipt={() => {}} /></>
          : <ApplyFlow mode="helper" citizenId={fam.citizenId} existingCaseId={fam.case?.id ?? null} banner={banner} onSubmitted={() => { void syncNow(); setVersion((v) => v + 1); }} />}
        <OutboxList title="Saved on this phone" />
      </div>
    );
  }

  if (sel) {
    return (
      <section className="mx-auto max-w-md space-y-4" data-testid="unlock">
        <div className="flex items-center gap-3"><span className="text-5xl">{avatar(sel.avatarId)}</span><div><p className="text-xl font-bold">{sel.name}</p><p dir="ltr" className="font-mono text-sm text-muted-foreground">{sel.cnic}</p></div></div>
        <VoicePrompt clip="helper_family_pin" label="Play again" />
        <p>Hand the phone to the family. They enter <strong>their own</strong> PIN.</p>
        <Keypad value={pin} onChange={setPin} max={4} masked />
        {msg && <p role="alert" className="text-destructive">{msg}</p>}
        <div className="grid grid-cols-2 gap-3">
          <Button size="xl" variant="outline" onClick={() => { setSel(null); setPin(''); setMsg(null); }}>Back</Button>
          <Button size="xl" disabled={pin.length !== 4} data-testid="unlock-ok" onClick={async () => {
            const r = await api('/api/v1/helper/grants', { body: { citizenId: sel.citizenId, pin } });
            setPin('');
            if (r.status === 201) { setUnlock({ grantId: r.body.grantId, citizenId: sel.citizenId, expiresAt: r.body.expiresAt }); setLastActivity(Date.now()); setMsg(null); }
            else setMsg(r.status === 423 ? "The family's PIN is locked for 15 minutes." : r.body.detail ?? String(r.status));
          }}>Unlock</Button>
        </div>
      </section>
    );
  }

  const shown = fams.filter((f) => f.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button variant={tab === 'families' ? 'default' : 'outline'} onClick={() => setTab('families')}>Families ({fams.length} / 40)</Button>
        <Button variant={tab === 'activity' ? 'default' : 'outline'} onClick={() => setTab('activity')}>My activity</Button>
      </div>
      {tab === 'activity' ? <Activity /> : (
        <>
          <div className="relative"><Search className="absolute start-3 top-3 size-4 text-muted-foreground" /><Input className="ps-9" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="families">
            {shown.map((f, i) => (
              <motion.button key={f.citizenId} type="button" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 16) * 0.03, duration: 0.4, ease: [0.22, 1, 0.36, 1] }} whileHover={{ y: -4 }} whileTap={{ scale: 0.97 }} onClick={() => { if (unlock) void lock('switch'); setSel(f); }}
                className={`flex flex-col items-center gap-1 rounded-[20px] border p-3 text-center transition-colors hover:border-mint/50 ${f.case?.flagged ? 'border-destructive bg-destructive/10' : 'border-white/10 bg-bento'}`} data-testid="family-card">
                <span className="text-4xl" aria-hidden>{avatar(f.avatarId)}</span>
                <span className="text-sm font-semibold">{f.name}</span>
                <span dir="ltr" className="font-mono text-xs text-muted-foreground">{f.cnic}</span>
                {f.case && <Ticks tick={f.case.ticks} labels={{ saved: '', sent: f.case.status.replace(/_/g, ' '), opened: f.case.status.replace(/_/g, ' '), failed: '' }} />}
                {f.case?.flagged && <span className="text-xs font-bold text-destructive">⚑ frozen</span>}
              </motion.button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Activity() {
  const [items, setItems] = useState<{ ts: string; action: string; outcome: string; family: { name: string; avatarId: number | null } | null; grantId: string | null }[]>([]);
  useEffect(() => { void api('/api/v1/helper/activity').then((r) => r.status === 200 && setItems(r.body.items)); }, []);
  return (
    <div className="overflow-x-auto"><table className="w-full text-sm" data-testid="helper-activity">
      <thead><tr className="text-start text-muted-foreground"><th className="p-2 text-start">Time</th><th className="p-2 text-start">Family</th><th className="p-2 text-start">Action</th><th className="p-2 text-start">Unlock</th></tr></thead>
      <tbody>
        {items.map((i, k) => (
          <tr key={k} className="border-t border-border"><td className="p-2">{new Date(i.ts).toLocaleString()}</td><td className="p-2">{i.family ? `${avatar(i.family.avatarId)} ${i.family.name}` : '—'}</td><td className="p-2">{i.action} {i.outcome !== 'allowed' && <span className="text-destructive">({i.outcome})</span>}</td><td className="p-2 font-mono text-xs">{i.grantId?.slice(0, 8) ?? '—'}</td></tr>
        ))}
      </tbody>
    </table></div>
  );
}
