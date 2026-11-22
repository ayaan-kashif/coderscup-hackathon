'use client';
import { AnimatePresence, motion } from 'motion/react';
import { PhoneCall, ShieldQuestion, Smartphone, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SimulatedBadge } from '@/components/shell/simulated-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { playSequence } from '@/components/voice/voice-prompt';

type Msg = { id: string; fromSender: string; body: string; kind: string; createdAt: string };

/** demo beat 1: the fake relief SMS (no trust picture, a fee, a mobile number) — synthetic, delivered only to this mock phone */
const DEMO_SCAM = { from: '+920000099111', body: 'Congratulations, Rs 25,000 relief approved. Send Rs 500 fee to +920000099111 to release.' };

/**
 * C14 (SIMULATED): the only place a sign-in code, notification, voice note or "press 9" call arrives.
 * AUTH-2: the code is read aloud digit by digit. Nothing is sent to a real number.
 */
export function MockPhone({ initialPhone }: { initialPhone: string }) {
  const [phone, setPhone] = useState(initialPhone);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [outText, setOutText] = useState('STATUS');
  useEffect(() => {
    let alive = true;
    const poll = () => fetch(`/api/mock/sms/inbox?phone=${encodeURIComponent(phone)}`).then(async (r) => {
      const b = await r.json().catch(() => ({}));
      if (!alive) return;
      if (r.ok) { setMsgs(b.messages); setError(null); } else setError(`${b.code ?? r.status}: ${b.detail ?? ''}`);
    }, () => { if (alive) setError('offline'); });
    void poll();
    const t = setInterval(poll, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [phone, version]);

  const press9 = async (m: Msg) => {
    const ref = /PC-([0-9a-f-]{36}):([0-9a-f]{16})/.exec(m.body);
    if (!ref) return;
    const r = await fetch(`/api/v1/payout-changes/${ref[1]}/object`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ digit: '9', token: ref[2] }) });
    const b = await r.json().catch(() => ({}));
    setNote(r.ok ? 'You pressed 9: the change is frozen and a complaint was opened.' : `${b.code ?? r.status}: ${b.detail ?? ''}`);
  };

  return (
    <main className="canvas-violet iso-grid flex min-h-dvh items-start justify-center px-4 py-8">
      <motion.div initial={{ opacity: 0, y: 40, rotate: -1.5 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ type: 'spring', stiffness: 140, damping: 18 }} className="w-full max-w-sm space-y-3 rounded-[2.5rem] border-[6px] border-void bg-bento p-4 shadow-[0_40px_80px_-30px_rgb(20_10_70/0.7)]">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 font-semibold"><Smartphone className="size-5" /> Mock phone</span>
          <SimulatedBadge what="SMS / IVR" />
        </div>
        <Input dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="fictional phone number" />
        <Button size="sm" variant="outline" className="w-full" data-testid="demo-scam-sms" onClick={async () => {
          await fetch('/api/mock/sms/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: phone, from: DEMO_SCAM.from, body: DEMO_SCAM.body, kind: 'other' }) });
          setVersion((v) => v + 1);
        }}>Receive the demo scam SMS (simulated)</Button>
        <form className="flex gap-2" onSubmit={async (e) => {
          e.preventDefault();
          // OFF-8: text the short code with no data plan; "STATUS" returns the case state
          const r = await fetch('/api/mock/sms/inbound', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: phone, to: '8171', body: outText }) });
          if (!r.ok) setError('Could not send the text (simulated).');
          setVersion((v) => v + 1);
        }}>
          <Input dir="ltr" value={outText} onChange={(e) => setOutText(e.target.value)} aria-label="text to 8171" data-testid="sms-out" />
          <Button type="submit" size="sm" variant="secondary" data-testid="sms-send-8171">Text 8171</Button>
        </form>
        {note && <p role="status" className="rounded-2xl bg-warning p-2 text-sm text-warning-foreground">{note}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <ul className="max-h-[60vh] space-y-2 overflow-y-auto" dir="ltr"><AnimatePresence initial={false}>
          {msgs.map((m) => {
            const code = m.body.match(/code is (\d{6})/)?.[1];
            const objection = m.kind === 'ivr' && /\[Press 9 to object\]/.test(m.body) && /PC-[0-9a-f-]{36}:/.test(m.body);
            return (
              <motion.li layout initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} key={m.id} className={`rounded-2xl p-3 text-sm ${m.kind === 'ivr' ? 'border-2 border-primary bg-card' : 'bg-secondary text-secondary-foreground'}`} data-kind={m.kind}>
                <div className="mb-1 flex justify-between text-xs opacity-70"><span>{m.kind === 'ivr' ? <><PhoneCall className="me-1 inline size-3" />voice call</> : m.fromSender} · {m.kind}</span><span>{new Date(m.createdAt).toLocaleTimeString()}</span></div>
                <p>{m.body.replace(/\s*\(ref PC-[^)]+\)/, '')}</p>
                {code && <Button size="sm" variant="outline" className="mt-2" onClick={() => playSequence(code.split('').map((d) => `digit_${d}`))}><Volume2 /> Read code aloud</Button>}
                {objection && <Button size="sm" variant="destructive" className="mt-2" data-testid="press-9" onClick={() => void press9(m)}>9 — this isn&apos;t me</Button>}
                {m.kind !== 'otp' && m.kind !== 'ivr' && !m.fromSender.startsWith('me ') && !m.fromSender.startsWith('SAAYA') && (
                  <a className="mt-2 inline-flex items-center gap-1 text-xs underline" href={`/check?text=${encodeURIComponent(m.body)}&from=${encodeURIComponent(m.fromSender)}`}>
                    <ShieldQuestion className="size-3" /> Is this real?
                  </a>
                )}
              </motion.li>
            );
          })}</AnimatePresence>
          {!msgs.length && <li className="text-center text-sm text-muted-foreground">No messages</li>}
        </ul>
      </motion.div>
    </main>
  );
}
