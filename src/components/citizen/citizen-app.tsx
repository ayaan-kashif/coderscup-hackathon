'use client';
import { WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ApplyFlow, OutboxList, syncNow } from '@/components/apply/apply-flow';
import { LowBandwidthBadge } from '@/components/shell/low-bandwidth';
import { SimulatedBadge } from '@/components/shell/simulated-badge';
import { Button } from '@/components/ui/button';
import { Keypad } from '@/components/voice/keypad';
import { VoicePrompt, playSequence } from '@/components/voice/voice-prompt';
import { useBi } from '@/components/voice/voice-lib';
import { outboxDb } from '@/offline/outbox';
import { startSync } from '@/offline/sync';
import { api, CaseStatusScreen, DataScreen, HelpScreen, ProofScreen, RealScreen, ReceiptScreen } from './screens';
import { TRUST_PICTURES, trustPicture } from './trust-pictures';

type Me = { role: string; stage: 'otp' | 'full'; displayName?: string; trustPictureId?: number | null; locale?: string };
type Step = 'loading' | 'offline' | 'welcome' | 'phone' | 'code' | 'pin' | 'pin_set' | 'trust' | 'consent' | 'home';
type View = { name: 'home' } | { name: 'apply' } | { name: 'status'; caseId: string } | { name: 'proof'; caseId: string; item: string } | { name: 'receipt'; payment: { id: string; amount: number; status: string; confirmedAmount: number | null } } | { name: 'real' } | { name: 'data' } | { name: 'help' };

const LOCK_AFTER_MS = 5 * 60_000; // AUTH-2: the app locks after 5 minutes in the background

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => { window.removeEventListener('online', cb); window.removeEventListener('offline', cb); };
}
const syncDeps = () => ({ fetch: window.fetch.bind(window), now: Date.now, random: Math.random });

export function CitizenApp() {
  const t = useTranslations();
  const bi = useBi();
  const router = useRouter();
  const [step, setStep] = useState<Step>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [pin1, setPin1] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const hiddenAt = useRef<number | null>(null);

  const load = useCallback(() => api('/api/v1/me').then(async (r) => {
    if (r.status === 200 && r.body.role === 'citizen') {
      setMe(r.body);
      if (r.body.stage !== 'full') { setStep('pin'); return; }
      if (!r.body.trustPictureId) { setStep('trust'); return; }
      const c = await api('/api/v1/me/consents');
      const hasActive = c.status === 200 && c.body.consents.some((x: { status: string }) => x.status === 'active');
      const hadAny = c.status === 200 && c.body.consents.length > 0;
      setStep(!hasActive && !hadAny ? 'consent' : 'home');
    } else {
      let welcomed = false;
      try { welcomed = localStorage.getItem('amanat_welcomed') === '1'; } catch { /* private mode */ }
      setStep(welcomed ? 'phone' : 'welcome');
    }
  }, () => setStep('offline')), []);

  useEffect(() => { void load(); }, [load]);

  // AUTH-2: lock after 5 minutes in the background; reopen only with the PIN
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) hiddenAt.current = Date.now();
      else if (hiddenAt.current && Date.now() - hiddenAt.current > LOCK_AFTER_MS && step === 'home') { setStep('pin'); }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [step]);

  if (step === 'loading') return <p className="p-6 text-center text-muted-foreground" aria-busy>…</p>;
  if (step === 'offline') return <Offline label={t('shell.offline')} replay={t('citizen.playPrompt')} />;

  if (step === 'welcome') {
    // C1: start without reading — two language pictures
    const choose = (l: 'ur' | 'en') => {
      document.cookie = `amanat_locale=${l}; path=/; max-age=31536000; samesite=lax`;
      try { localStorage.setItem('amanat_welcomed', '1'); } catch { /* ignore */ }
      router.refresh();
      setStep('phone');
    };
    return (
      <Screen title="خوش آمدید · Welcome" prompt="welcome" replay={t('citizen.playPrompt')}>
        <div className="grid grid-cols-2 gap-4">
          <Button size="xl" className="h-32 flex-col gap-2 text-2xl" onClick={() => choose('ur')} data-testid="lang-ur"><span className="text-5xl">🗣️</span>اردو</Button>
          <Button size="xl" variant="outline" className="h-32 flex-col gap-2 text-2xl" onClick={() => choose('en')} data-testid="lang-en"><span className="text-5xl">🔤</span>English</Button>
        </div>
      </Screen>
    );
  }

  if (step === 'phone') {
    return (
      <Screen title={t('citizen.phoneTitle')} prompt="ask_phone" replay={t('citizen.playPrompt')}>
        <p className="text-sm text-muted-foreground">{t('citizen.phoneHint')} <SimulatedBadge what="SMS" /></p>
        <p dir="ltr" className="text-center text-sm text-muted-foreground">+92 00000 _ _ _ _ _</p>
        <Keypad value={phone} onChange={setPhone} max={5} />
        {message && <p role="alert" className="text-center text-destructive">{message}</p>}
        <Button size="xl" className="w-full" disabled={phone.length !== 5} onClick={async () => {
          const r = await api('/api/v1/auth/otp/request', { body: { phone: `+9200000${phone}` } });
          if (r.status === 202) { setMessage(null); setStep('code'); } else setMessage(r.body.detail ?? t('errors.INTERNAL'));
        }}>{t('citizen.sendCode')}</Button>
        <a className="block text-center text-sm underline" href={`/mock/phone?phone=%2B9200000${phone}`} target="_blank" rel="noreferrer">{t('home.mockPhone')}</a>
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
          const r = await api('/api/v1/auth/otp/verify', { body: { phone: `+9200000${phone}`, code } });
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
          const r = await api('/api/v1/auth/pin/verify', { body: { pin } });
          setPin('');
          if (r.status === 200) { setMessage(null); await load(); }
          else if (r.status === 423) setMessage(t('citizen.locked'));
          else if (r.status === 401 && r.body.code === 'PIN_INVALID') setMessage(t('citizen.wrongPin', { left: r.body.attemptsLeft ?? r.body.triesLeft ?? 0 }));
          else if (r.body.next === 'pin_set') { setMessage(null); setStep('pin_set'); }
          else if (r.status === 401) { setStep('phone'); setMessage(r.body.detail); }
          else setMessage(r.body.detail ?? t('errors.INTERNAL'));
        }}>{t('citizen.verify')}</Button>
      </Screen>
    );
  }

  if (step === 'pin_set') {
    // C3: enter twice
    return (
      <Screen title={bi('Make a PIN', 'پن بنائیں')} prompt={pin1 ? 'confirm_pin' : 'set_pin'} replay={t('citizen.playPrompt')}>
        <Keypad value={pin} onChange={setPin} max={4} masked />
        {message && <p role="alert" className="text-center text-destructive">{message}</p>}
        <Button size="xl" className="w-full" disabled={pin.length !== 4} onClick={async () => {
          if (!pin1) { setPin1(pin); setPin(''); return; }
          if (pin1 !== pin) { setPin1(null); setPin(''); setMessage(bi('The two PINs differ. Start again.', 'دونوں پن مختلف ہیں۔ دوبارہ شروع کریں۔')); return; }
          const r = await api('/api/v1/auth/pin/set', { body: { pin } });
          setPin(''); setPin1(null);
          if (r.status === 200 || r.status === 201) { setMessage(null); setStep('pin'); } else setMessage(r.body.detail);
        }}>{t('citizen.verify')}</Button>
      </Screen>
    );
  }

  if (step === 'trust') {
    // C2: 30 pictures, each named aloud on tap
    return (
      <Screen title={bi('Choose your picture', 'اپنی تصویر چنیں')} prompt="choose_trust" replay={t('citizen.playPrompt')}>
        <div className="grid grid-cols-5 gap-2">
          {TRUST_PICTURES.map((p, i) => (
            <button key={i} type="button" className="aspect-square rounded-xl border-2 border-border text-4xl focus:border-primary" aria-label={`trust ${i + 1}`}
              onClick={async () => { void playSequence([`trust_${i + 1}`]); await api('/api/v1/me', { method: 'PATCH', body: { trustPictureId: i + 1 } }); await load(); }}>{p}</button>
          ))}
        </div>
      </Screen>
    );
  }

  if (step === 'consent') return <ConsentStep onDone={() => void load()} />;

  return <Home me={me!} online={online} />;
}

/** C4: one card per purpose, "haan" + PIN */
function ConsentStep({ onDone }: { onDone: () => void }) {
  const bi = useBi();
  const [pin, setPin] = useState('');
  const [tenants, setTenants] = useState<{ id: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { void api('/api/v1/me/consents').then((r) => setTenants(r.body.consents?.[0] ? { id: r.body.consents[0].tenantId } : null)); }, []);
  return (
    <Screen title={bi('Your permission', 'آپ کی اجازت')} prompt="consent_notice" replay={bi('Play again', 'دوبارہ سنیں')}>
      <ul className="space-y-2">
        <li className="rounded-xl border border-border p-3">🪪 {bi('Identity registry check', 'شناختی ریکارڈ کی جانچ')} <SimulatedBadge what="registry" /></li>
        <li className="rounded-xl border border-border p-3">📜 {bi('Civil registry check (marriage, death)', 'سول ریکارڈ کی جانچ')} <SimulatedBadge what="registry" /></li>
        <li className="rounded-xl border border-border p-3">💵 {bi('Payment to your wallet', 'آپ کے والیٹ میں ادائیگی')} <SimulatedBadge what="ledger" /></li>
      </ul>
      <Keypad value={pin} onChange={setPin} max={4} masked />
      {msg && <p role="alert" className="text-destructive">{msg}</p>}
      <Button size="xl" className="w-full" disabled={pin.length !== 4 || !tenants} onClick={async () => {
        const r = await api('/api/v1/me/consents', { body: { tenantId: tenants!.id, pin } });
        setPin('');
        if (r.status === 201) onDone(); else setMsg(r.body.detail);
      }}>✅ {bi('Yes, I agree', 'ہاں، اجازت ہے')}</Button>
    </Screen>
  );
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
  const bi = useBi();
  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-6 px-4 py-12 text-center">
      <WifiOff className="size-16 text-muted-foreground" aria-hidden />
      <p className="text-xl font-semibold">{label}</p>
      <VoicePrompt clip="offline" label={replay} />
      <OutboxList title={bi('Saved on this phone', 'اس فون میں محفوظ')} />
    </main>
  );
}

const TILES = [
  { view: 'apply', clip: 'tile_apply', icon: '📝', en: 'Apply', ur: 'درخواست' },
  { view: 'status', clip: 'tile_status', icon: '📬', en: 'My status', ur: 'میری صورتحال' },
  { view: 'real', clip: 'tile_real', icon: '🛡️', en: 'Is this real?', ur: 'کیا یہ سچ ہے؟' },
  { view: 'data', clip: 'tile_data', icon: '🔐', en: 'My data', ur: 'میری معلومات' },
  { view: 'help', clip: 'tile_help', icon: '🙋', en: 'Help', ur: 'مدد' },
] as const;

function Home({ me, online }: { me: Me; online: boolean }) {
  const t = useTranslations();
  const bi = useBi();
  // "Is this real?" opened from a message on the mock phone (/c?check=…&from=…)
  const [shared] = useState(() => { try { const u = new URL(window.location.href); return { text: u.searchParams.get('check') ?? '', from: u.searchParams.get('from') ?? '' }; } catch { return { text: '', from: '' }; } });
  const [view, setView] = useState<View>(() => (shared.text ? { name: 'real' } : { name: 'home' }));
  const [caseId, setCaseId] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => startSync(outboxDb(), syncDeps()), []);
  useEffect(() => {
    let alive = true;
    void api('/api/v1/me/cases').then((r) => {
      if (!alive || r.status !== 200) return;
      const items = r.body.items as { id: string; status: string }[];
      setCaseId(items.find((c) => c.status !== 'draft')?.id ?? null);
      setDraftId(items.find((c) => c.status === 'draft')?.id ?? null);
    }, () => {});
    return () => { alive = false; };
  }, [version]);
  const back = () => { setView({ name: 'home' }); setVersion((v) => v + 1); };
  return (
    <main className="mx-auto flex max-w-md flex-col gap-5 px-4 py-6">
      {/* CIT-8: the trust picture heads every signed-in screen */}
      <header className="flex items-center gap-4 rounded-xl border border-border bg-card p-4" data-testid="trust-header">
        <button type="button" className="text-5xl" aria-label="trust picture" onClick={() => me.trustPictureId && void playSequence([`trust_${me.trustPictureId}`])}>{trustPicture(me.trustPictureId)}</button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold">{me.displayName}</p>
          <SimulatedBadge what="Saaya" /> <LowBandwidthBadge label={bi('Low data mode', 'کم ڈیٹا موڈ')} />
        </div>
        {view.name !== 'home' && <Button variant="ghost" onClick={back}>← {bi('Home', 'واپس')}</Button>}
      </header>
      {!online && <p className="rounded-md bg-warning px-3 py-2 text-warning-foreground" role="status">{t('shell.offline')} · {bi('one grey tick = saved on the phone', 'ایک سرمئی نشان = فون میں محفوظ')}</p>}

      {view.name === 'home' && (
        <>
          <VoicePrompt clip="home_tiles" label={t('citizen.playPrompt')} />
          <div className="grid grid-cols-2 gap-3">
            {TILES.map((tile) => (
              <Button key={tile.view} size="xl" variant="outline" className="h-28 flex-col gap-2 text-lg" data-testid={`tile-${tile.view}`}
                disabled={tile.view === 'status' && !caseId}
                onClick={() => { void playSequence([tile.clip]); setView(tile.view === 'status' ? { name: 'status', caseId: caseId! } : { name: tile.view } as View); }}>
                <span className="text-4xl">{tile.icon}</span>{bi(tile.en, tile.ur)}
              </Button>
            ))}
            <a href={`/mock/phone`} target="_blank" rel="noreferrer" className="flex h-28 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border text-lg">📱 {t('home.mockPhone')}</a>
          </div>
          <OutboxList title={bi('Saved on this phone', 'اس فون میں محفوظ')} />
        </>
      )}
      {view.name === 'apply' && (
        caseId && !draftId
          ? <div className="space-y-3"><p>{bi('You already have an application.', 'آپ کی درخواست پہلے سے موجود ہے۔')}</p><Button size="xl" className="w-full" onClick={() => setView({ name: 'status', caseId })}>{bi('See my status', 'صورتحال دیکھیں')}</Button></div>
          : <ApplyFlow mode="citizen" existingCaseId={draftId} onSubmitted={(r) => { void syncNow(); if (r.caseId) setView({ name: 'status', caseId: r.caseId }); else back(); }} />
      )}
      {view.name === 'status' && <CaseStatusScreen caseId={view.caseId} trustPictureId={me.trustPictureId} onProof={(item) => setView({ name: 'proof', caseId: view.caseId, item })} onReceipt={(p) => setView({ name: 'receipt', payment: p })} />}
      {view.name === 'proof' && <ProofScreen caseId={view.caseId} item={view.item} onDone={() => setView({ name: 'status', caseId: view.caseId })} />}
      {view.name === 'receipt' && <ReceiptScreen payment={view.payment} trustPictureId={me.trustPictureId} onDone={back} />}
      {view.name === 'real' && <RealScreen signedIn initialText={shared.text} initialSender={shared.from} />}
      {view.name === 'data' && <DataScreen caseId={caseId} />}
      {view.name === 'help' && <HelpScreen />}
    </main>
  );
}
