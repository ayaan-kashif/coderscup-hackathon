'use client';
import { useLiveQuery } from 'dexie-react-hooks';
import { WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { SimulatedBadge } from '@/components/shell/simulated-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Keypad } from '@/components/voice/keypad';
import { VoicePrompt } from '@/components/voice/voice-prompt';
import { enqueue, outboxDb } from '@/offline/outbox';
import { startSync, syncOnce } from '@/offline/sync';
import { Ticks } from './ticks';
import { trustPicture } from './trust-pictures';

type Me = { role: string; stage: 'otp' | 'full'; displayName?: string; trustPictureId?: number | null };
type Step = 'loading' | 'offline' | 'phone' | 'code' | 'pin' | 'home';

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => { window.removeEventListener('online', cb); window.removeEventListener('offline', cb); };
}

async function api(path: string, body?: unknown) {
  const r = await fetch(path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

export function CitizenApp() {
  const t = useTranslations();
  const [step, setStep] = useState<Step>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

  const load = useCallback(() => api('/api/v1/me').then((r) => {
    if (r.status === 200 && r.body.role === 'citizen') {
      setMe(r.body);
      setStep(r.body.stage === 'full' ? 'home' : 'pin');
    } else setStep('phone');
  }, () => setStep('offline')), []);

  useEffect(() => { void load(); }, [load]);

  if (step === 'loading') return <p className="p-6 text-center text-muted-foreground">…</p>;

  if (step === 'offline') return <Offline label={t('shell.offline')} replay={t('citizen.playPrompt')} />;

  if (step === 'phone') {
    const digits = phone;
    return (
      <Screen title={t('citizen.phoneTitle')} prompt="ask_phone" replay={t('citizen.playPrompt')}>
        <p className="text-sm text-muted-foreground">{t('citizen.phoneHint')} <SimulatedBadge what="SMS" /></p>
        <p dir="ltr" className="text-center text-sm text-muted-foreground">+92 00000 _ _ _ _ _</p>
        <Keypad value={digits} onChange={setPhone} max={5} />
        {message && <p role="alert" className="text-center text-destructive">{message}</p>}
        <Button size="xl" className="w-full" disabled={digits.length !== 5} onClick={async () => {
          const full = `+9200000${digits}`;
          const r = await api('/api/v1/auth/otp/request', { phone: full });
          if (r.status === 202) { setMessage(null); setStep('code'); } else setMessage(r.body.detail ?? t('errors.INTERNAL'));
        }}>{t('citizen.sendCode')}</Button>
        <a className="block text-center text-sm underline" href={`/mock/phone?phone=%2B9200000${digits}`} target="_blank" rel="noreferrer">{t('home.mockPhone')}</a>
      </Screen>
    );
  }

  if (step === 'code') {
    return (
      <Screen title={t('citizen.codeTitle')} prompt="ask_code" replay={t('citizen.playPrompt')}>
        <p className="text-sm text-muted-foreground">{t('citizen.codeHint')}</p>
        <a className="block text-center underline" href={`/mock/phone?phone=${encodeURIComponent(`+9200000${phone}`)}`} target="_blank" rel="noreferrer">{t('home.mockPhone')} ↗</a>
        <Keypad value={code} onChange={setCode} max={6} />
        {message && <p role="alert" className="text-center text-destructive">{message}</p>}
        <Button size="xl" className="w-full" disabled={code.length !== 6} onClick={async () => {
          const r = await api('/api/v1/auth/otp/verify', { phone: `+9200000${phone}`, code });
          if (r.status === 200) { setMessage(null); setStep('pin'); } else { setCode(''); setMessage(r.body.detail ?? t('errors.UNAUTHENTICATED')); }
        }}>{t('citizen.verify')}</Button>
      </Screen>
    );
  }

  if (step === 'pin') {
    return (
      <Screen title={t('citizen.pinTitle')} prompt={message?.includes('15') ? 'pin_locked' : message ? 'wrong_pin' : 'ask_pin'} replay={t('citizen.playPrompt')}>
        <Keypad value={pin} onChange={setPin} max={4} masked />
        {message && <p role="alert" className="text-center text-destructive">{message}</p>}
        <Button size="xl" className="w-full" disabled={pin.length !== 4} onClick={async () => {
          const r = await api('/api/v1/auth/pin/verify', { pin });
          setPin('');
          if (r.status === 200) { setMessage(null); await load(); }
          else if (r.status === 423) setMessage(t('citizen.locked'));
          else if (r.status === 401 && r.body.code === 'PIN_INVALID') setMessage(t('citizen.wrongPin', { left: r.body.attemptsLeft ?? 0 }));
          else if (r.status === 401) { setStep('phone'); setMessage(r.body.detail); }
          else setMessage(r.body.detail ?? t('errors.INTERNAL'));
        }}>{t('citizen.verify')}</Button>
      </Screen>
    );
  }

  return <Home me={me!} online={online} />;
}

function Screen({ title, prompt, replay, children }: { title: string; prompt: string; replay: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-5 px-4 py-6">
      <h1 className="text-2xl font-bold">{title}</h1>
      <VoicePrompt clip={prompt} label={replay} />
      {children}
    </main>
  );
}

function Offline({ label, replay }: { label: string; replay: string }) {
  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-6 px-4 py-12 text-center">
      <WifiOff className="size-16 text-muted-foreground" aria-hidden />
      <p className="text-xl font-semibold">{label}</p>
      <VoicePrompt clip="offline" label={replay} />
      <OutboxList />
    </main>
  );
}

function Home({ me, online }: { me: Me; online: boolean }) {
  const t = useTranslations();
  useEffect(() => startSync(outboxDb(), { fetch: window.fetch.bind(window), now: Date.now, random: Math.random }), []);
  return (
    <main className="mx-auto flex max-w-md flex-col gap-5 px-4 py-6">
      {/* CIT-8: the trust picture heads every signed-in screen */}
      <header className="flex items-center gap-4 rounded-lg border border-border bg-card p-4">
        <span className="text-5xl" aria-label="trust picture">{trustPicture(me.trustPictureId)}</span>
        <div>
          <p className="text-lg font-semibold">{me.displayName}</p>
          <SimulatedBadge what="Saaya" />
        </div>
      </header>
      {!online && <p className="rounded-md bg-warning px-3 py-2 text-warning-foreground">{t('shell.offline')}</p>}
      <VoicePrompt clip="home" label={t('citizen.playPrompt')} />
      <Button size="xl" className="w-full" onClick={async () => {
        // saved on the phone first (one grey tick); the entry id is both Idempotency-Key and clientSubmissionId
        await enqueue(outboxDb(), 'case.create', { programCode: 'SAAYA-WS', channel: 'citizen' });
        new Audio('/voice/ur/saved_on_phone.wav').play().catch(() => {});
        if (navigator.onLine) await syncOnce(outboxDb(), { fetch: window.fetch.bind(window), now: Date.now, random: Math.random });
      }}>{t('citizen.startDraft')}</Button>
      <OutboxList />
    </main>
  );
}

function OutboxList() {
  const t = useTranslations();
  const entries = useLiveQuery(() => outboxDb().outbox.orderBy('createdAt').reverse().limit(10).toArray(), []);
  if (!entries?.length) return null;
  return (
    <Card className="w-full">
      <CardHeader><CardTitle>{t('citizen.outbox')}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {entries.map((e) => (
          <div key={e.id} className="flex items-center justify-between gap-2 border-b border-border pb-2 last:border-0">
            <span dir="ltr" className="font-mono text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleTimeString()}</span>
            <Ticks tick={e.tick} labels={{ saved: t('ticks.saved'), sent: t('ticks.sent'), opened: t('ticks.opened'), failed: t('ticks.failed') }} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
