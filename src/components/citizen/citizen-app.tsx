'use client';
import { WifiOff } from 'lucide-react';
import { motion } from 'motion/react';
import React from 'react';
import { Logo } from '@/components/brand/logo';
import { cn } from '@/lib/utils';
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
import { api, CaseStatusScreen, DataScreen, HelpScreen, MyApplications, ProofScreen, RealScreen, ReceiptScreen } from './screens';
import { TRUST_PICTURES, trustPicture } from './trust-pictures';
import { DuressSafetyCard, PayoutChangeFlow } from './duress-safety';
import type { AnswerValue } from '@/components/apply/question';
import { DISTRICT_ICONS } from '@/components/apply/question';
import { AboutYou, AccountActions, PrototypeNotice, WhatsappPhoneForm, WhatsappUnavailable, type OnboardingState } from './onboarding';

type Me = { role: string; stage: 'otp' | 'full'; displayName?: string; trustPictureId?: number | null; locale?: string };
type Step = 'loading' | 'offline' | 'welcome' | 'phone' | 'code' | 'pin' | 'pin_set' | 'trust' | 'consent' | 'about' | 'home';
type View = { name: 'home' } | { name: 'apply' } | { name: 'status'; caseId: string } | { name: 'proof'; caseId: string; item: string } | { name: 'receipt'; payment: { id: string; amount: number; status: string; confirmedAmount: number | null } } | { name: 'real' } | { name: 'data' } | { name: 'help' } | { name: 'payout' };

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
  // how the code travels: the on-screen demo phone (+92 00000) or the citizen's own WhatsApp number
  const [channel, setChannel] = useState<'demo' | 'whatsapp' | 'unavailable'>('demo');
  const [sentVia, setSentVia] = useState<'mock' | 'whatsapp'>('mock');
  const [wa, setWa] = useState('');
  const [waEnabled, setWaEnabled] = useState(false);
  const [onboard, setOnboard] = useState<OnboardingState | null>(null);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const hiddenAt = useRef<number | null>(null);

  const load = useCallback(() => api('/api/v1/me').then(async (r) => {
    if (r.status === 200 && r.body.role === 'citizen') {
      setMe(r.body);
      if (r.body.stage !== 'full') { setStep('pin'); return; }
      // trust picture, consent, then "About you": the server says which step she is on, so reopening resumes there
      const o = await api('/api/v1/me/onboarding');
      if (o.status === 200) {
        setOnboard(o.body);
        setStep(o.body.step === 'trust' ? 'trust' : o.body.step === 'consent' ? 'consent' : o.body.step === 'done' ? 'home' : 'about');
        return;
      }
      setStep(!r.body.trustPictureId ? 'trust' : 'home');
    } else {
      let welcomed = false;
      try { welcomed = localStorage.getItem('amanat_welcomed') === '1'; } catch { /* private mode */ }
      setStep(welcomed ? 'phone' : 'welcome');
    }
  }, () => setStep('offline')), []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (step !== 'phone') return;
    void api('/api/v1/auth/otp/channels').then((r) => setWaEnabled(r.status === 200 && r.body.enabled === true));
  }, [step]);

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
    // before the WhatsApp screen is shown, ask whether the gateway is up (the server caches its health for 15 s)
    const startWhatsapp = async () => {
      const r = await api('/api/v1/auth/otp/channels');
      setMessage(null);
      setChannel(r.status === 200 && r.body.whatsapp ? 'whatsapp' : 'unavailable');
    };
    if (channel === 'unavailable') {
      return (
        <Screen title={bi('WhatsApp', 'واٹس ایپ')} prompt="ask_phone" replay={t('citizen.playPrompt')}>
          <WhatsappUnavailable onDemo={() => { setChannel('demo'); setMessage(null); }} />
        </Screen>
      );
    }
    if (channel === 'whatsapp') {
      return (
        <Screen title={t('citizen.phoneTitle')} prompt="ask_phone" replay={t('citizen.playPrompt')}>
          <WhatsappPhoneForm digits={wa} setDigits={setWa} message={null}
            onSent={() => { setSentVia('whatsapp'); setMessage(null); setStep('code'); }}
            onUnavailable={() => setChannel('unavailable')} onDemo={() => { setChannel('demo'); setMessage(null); }} />
        </Screen>
      );
    }
    return (
      <Screen title={t('citizen.phoneTitle')} prompt="ask_phone" replay={t('citizen.playPrompt')}>
        <p className="text-sm text-muted-foreground">{t('citizen.phoneHint')} <SimulatedBadge what="SMS" /></p>
        <p dir="ltr" className="text-center text-sm text-muted-foreground">+92 00000 _ _ _ _ _</p>
        <Keypad value={phone} onChange={setPhone} max={5} />
        {message && <p role="alert" className="text-center text-destructive">{message}</p>}
        <Button size="xl" className="w-full" disabled={phone.length !== 5} onClick={async () => {
          const r = await api('/api/v1/auth/otp/request', { body: { phone: `+9200000${phone}` } });
          if (r.status === 202) { setMessage(null); setSentVia('mock'); setStep('code'); } else setMessage(r.body.detail ?? t('errors.INTERNAL'));
        }}>{t('citizen.sendCode')}</Button>
        <a className="block text-center text-sm underline" href={`/mock/phone?phone=%2B9200000${phone}`} target="_blank" rel="noreferrer">{t('home.mockPhone')}</a>
        {waEnabled && (
          <Button size="lg" variant="outline" className="w-full" onClick={() => void startWhatsapp()} data-testid="use-whatsapp">💬 {bi('Use my WhatsApp number', 'میرا واٹس ایپ نمبر استعمال کریں')}</Button>
        )}
      </Screen>
    );
  }

  if (step === 'code') {
    return (
      <Screen title={t('citizen.codeTitle')} prompt="ask_code" replay={t('citizen.playPrompt')}>
        {sentVia === 'whatsapp' ? (
          <p className="text-sm text-muted-foreground" data-testid="code-in-whatsapp">💬 {bi('The code was sent to your WhatsApp. Open WhatsApp and read it.', 'کوڈ آپ کے واٹس ایپ پر بھیجا گیا ہے۔ واٹس ایپ کھول کر پڑھیں۔')}</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t('citizen.codeHint')}</p>
            <a className="block text-center underline" href={`/mock/phone?phone=${encodeURIComponent(`+9200000${phone}`)}`} target="_blank" rel="noreferrer">{t('home.mockPhone')} ↗</a>
          </>
        )}
        <Keypad value={code} onChange={setCode} max={6} slots />
        {/* the sign-in code is 6 digits from the SMS; the 4-digit PIN comes on the next screen */}
        <p className="text-center text-sm text-muted-foreground" data-testid="code-length-hint">
          {code.length === 6 ? bi('Press Continue.', 'آگے بڑھیں دبائیں۔') : bi(`The code has 6 digits (${code.length} of 6). It is in the ${sentVia === 'whatsapp' ? 'WhatsApp' : 'mock phone'} message. Your 4-digit PIN comes next.`, `کوڈ 6 ہندسوں کا ہے (${code.length} / 6)۔ یہ ${sentVia === 'whatsapp' ? 'واٹس ایپ' : 'فرضی فون'} کے پیغام میں ہے۔ آپ کا 4 ہندسوں کا پن اگلے مرحلے میں آئے گا۔`)}
        </p>
        {message && <p role="alert" className="text-center text-destructive">{message}</p>}
        <Button size="xl" className="w-full" disabled={code.length !== 6} onClick={async () => {
          const r = await api('/api/v1/auth/otp/verify', { body: { phone: sentVia === 'whatsapp' ? `+92${wa}` : `+9200000${phone}`, code } });
          // a number seen for the first time has no PIN yet: go straight to "Make a PIN"
          if (r.status === 200) { setMessage(null); setStep(r.body.next === 'pin_set' ? 'pin_set' : 'pin'); } else { setCode(''); setMessage(r.body.detail ?? t('errors.UNAUTHENTICATED')); }
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
        <DuressSafetyCard />
        <Button size="xl" className="w-full" disabled={pin.length !== 4} onClick={async () => {
          if (!pin1) { setPin1(pin); setPin(''); return; }
          if (pin1 !== pin) { setPin1(null); setPin(''); setMessage(bi('The two PINs differ. Start again.', 'دونوں پن مختلف ہیں۔ دوبارہ شروع کریں۔')); return; }
          const r = await api('/api/v1/auth/pin/set', { body: { pin } });
          setPin(''); setPin1(null);
          if (r.status === 200 || r.status === 201) { setMessage(null); setStep('pin'); } else setMessage(r.body.en ? bi(r.body.en, r.body.ur) : r.body.detail);
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
            <button key={i} type="button" className="aspect-square rounded-[20px] border border-white/10 bg-void text-4xl transition-[transform,border-color] hover:scale-105 hover:border-mint focus-visible:border-mint active:scale-95" aria-label={`trust ${i + 1}`}
              onClick={async () => { void playSequence([`trust_${i + 1}`]); await api('/api/v1/me', { method: 'PATCH', body: { trustPictureId: i + 1 } }); await load(); }}>{p}</button>
          ))}
        </div>
      </Screen>
    );
  }

  if (step === 'consent') return <ConsentStep onDone={() => void load()} />;

  if (step === 'about' && onboard) {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-5" data-testid="about-you">
        <Logo className="px-1" />
        <AboutYou state={onboard} onSaved={() => void load()} />
      </main>
    );
  }

  return <Home me={me!} online={online} />;
}

/** C4: one card per purpose, "haan" + PIN */
function ConsentStep({ onDone }: { onDone: () => void }) {
  const bi = useBi();
  const [pin, setPin] = useState('');
  const [tenants, setTenants] = useState<{ id: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // a first-time citizen has no consent yet: she agrees to share with the programme's main office (offices[0])
  useEffect(() => { void api('/api/v1/me/consents').then((r) => setTenants(r.body.consents?.[0] ? { id: r.body.consents[0].tenantId } : r.body.offices?.[0] ? { id: r.body.offices[0].id } : null)); }, []);
  return (
    <Screen title={bi('Your permission', 'آپ کی اجازت')} prompt="consent_notice" replay={bi('Play again', 'دوبارہ سنیں')}>
      <ul className="space-y-2">
        <li className="rounded-[20px] border border-white/10 bg-void/40 p-3">🪪 {bi('Identity registry check', 'شناختی ریکارڈ کی جانچ')} <SimulatedBadge what="registry" /></li>
        <li className="rounded-[20px] border border-white/10 bg-void/40 p-3">📜 {bi('Civil registry check (marriage, death)', 'سول ریکارڈ کی جانچ')} <SimulatedBadge what="registry" /></li>
        <li className="rounded-[20px] border border-white/10 bg-void/40 p-3">💵 {bi('Payment to your wallet', 'آپ کے والیٹ میں ادائیگی')} <SimulatedBadge what="ledger" /></li>
      </ul>
      <PrototypeNotice />
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
    <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-5">
      <Logo className="px-1" />
      <motion.div key={title} initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} className="flex flex-col gap-4">
        <section className="canvas-violet iso-grid space-y-4 overflow-hidden rounded-[28px] p-6">
          <h1 className="display-lg !text-[clamp(1.6rem,6vw,2.1rem)]">{title}</h1>
          <VoicePrompt clip={prompt} label={replay} />
        </section>
        <motion.div className="flex flex-col gap-5 rounded-[28px] border border-white/[0.08] bg-bento p-5" initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06, delayChildren: 0.15 } } }}>
          {React.Children.map(children, (c) => <motion.div variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }}>{c}</motion.div>)}
        </motion.div>
      </motion.div>
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
  { view: 'payout', clip: 'ask_wallet', icon: '💳', en: 'Payout number', ur: 'ادائیگی نمبر' },
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
  // answers from "About you" (only for a citizen who finished it) start her application filled in
  const [prefill, setPrefill] = useState<Record<string, AnswerValue> | null | undefined>(undefined);
  useEffect(() => {
    void api('/api/v1/me/onboarding').then((r) => {
      const p = r.status === 200 ? r.body.profile : null;
      if (!p?.onboarded) { setPrefill(null); return; }
      const pf: Record<string, AnswerValue> = {};
      if (p.name) pf.name = { question: 'name', value: p.name, via: 'keypad', display: p.name };
      if (p.districtCode) pf.district = { question: 'district', value: p.districtCode, via: 'icon', display: DISTRICT_ICONS.find((d) => d.code === p.districtCode)?.en ?? p.districtCode };
      setPrefill(pf);
    });
  }, []);
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
    <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-5">
      <Logo className="px-1" />
      {/* CIT-8: the trust picture heads every signed-in screen */}
      <motion.header layout initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} className={cn('canvas-violet iso-grid overflow-hidden rounded-[28px]', view.name === 'home' ? 'p-5' : 'p-3')} data-testid="trust-header">
        <div className="flex items-center gap-4">
          <motion.button whileTap={{ scale: 0.9, rotate: -6 }} whileHover={{ scale: 1.06 }} type="button" className={cn('flex shrink-0 items-center justify-center bg-void', view.name === 'home' ? 'size-[72px] rounded-2xl text-5xl' : 'size-12 rounded-xl text-3xl')} aria-label="trust picture" onClick={() => me.trustPictureId && void playSequence([`trust_${me.trustPictureId}`])}>{trustPicture(me.trustPictureId)}</motion.button>
          <div className="min-w-0 flex-1 space-y-1">
            {view.name === 'home' && <p className="micro-label text-white/70">{bi('Welcome', 'خوش آمدید')}</p>}
            <p className={cn('display truncate font-extrabold leading-tight tracking-tight', view.name === 'home' ? 'text-2xl' : 'text-lg')}>{me.displayName}</p>
            <div className="flex flex-wrap items-center gap-1.5"><SimulatedBadge what="Saaya" /> <LowBandwidthBadge label={bi('Low data mode', 'کم ڈیٹا موڈ')} /></div>
          </div>
          {view.name !== 'home' && <Button variant="white" size="sm" onClick={back}>← {bi('Home', 'واپس')}</Button>}
        </div>
      </motion.header>
      {!online && <p className="rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm font-medium text-warning" role="status">{t('shell.offline')} · {bi('one grey tick = saved on the phone', 'ایک سرمئی نشان = فون میں محفوظ')}</p>}

      {view.name === 'home' && (
        <>
          <VoicePrompt clip="home_tiles" label={t('citizen.playPrompt')} />
          <MyApplications key={version} onOpen={(id) => setView({ name: 'status', caseId: id })} />
          <motion.div className="grid grid-cols-2 gap-3" initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } } }}>
            {TILES.map((tile) => {
              const primary = tile.view === 'apply';
              const off = tile.view === 'status' && !caseId;
              return (
                <motion.div key={tile.view} className={primary ? 'col-span-2' : undefined} variants={{ hidden: { opacity: 0, y: 22, scale: 0.96 }, show: { opacity: 1, y: 0, scale: 1 } }} whileTap={off ? undefined : { scale: 0.96 }}>
                  <button type="button" data-testid={`tile-${tile.view}`} disabled={off}
                    className={cn(
                      'group flex w-full items-center justify-center gap-3 rounded-[24px] border text-lg font-bold transition-[border-color,background-color,transform] duration-200 hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-40',
                      primary ? 'h-28 flex-row border-transparent bg-mint text-void hover:bg-mint-hover' : 'h-32 flex-col border-white/10 bg-bento hover:border-mint/50 hover:bg-elevated',
                    )}
                    onClick={() => { void playSequence([tile.clip]); setView(tile.view === 'status' ? { name: 'status', caseId: caseId! } : { name: tile.view } as View); }}>
                    <span className={cn('flex items-center justify-center rounded-2xl text-4xl transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110', primary ? 'size-16 bg-void/10' : 'size-14 bg-pill')}>{tile.icon}</span>
                    {bi(tile.en, tile.ur)}
                  </button>
                </motion.div>
              );
            })}
            <motion.a variants={{ hidden: { opacity: 0, y: 22, scale: 0.96 }, show: { opacity: 1, y: 0, scale: 1 } }} whileTap={{ scale: 0.96 }} href="/mock/phone" target="_blank" rel="noreferrer" className="group flex h-32 flex-col items-center justify-center gap-2 rounded-[24px] border border-white/10 bg-bento px-2 text-center text-base font-bold transition-[border-color,background-color,transform] duration-200 hover:-translate-y-0.5 hover:border-mint/50 hover:bg-elevated">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-pill text-4xl transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110">📱</span>{t('home.mockPhone')}
            </motion.a>
          </motion.div>
          <OutboxList title={bi('Saved on this phone', 'اس فون میں محفوظ')} />
        </>
      )}
      {view.name !== 'home' && view.name !== 'apply' && view.name !== 'status' && view.name !== 'proof' && view.name !== 'receipt' && (() => { const tl = TILES.find((x) => x.view === view.name); return tl ? <motion.p initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} className="display flex items-center gap-3 px-1 text-2xl font-extrabold"><span className="flex size-11 items-center justify-center rounded-2xl bg-pill text-2xl">{tl.icon}</span>{bi(tl.en, tl.ur)}</motion.p> : null; })()}
      {view.name === 'apply' && (
        caseId && !draftId
          ? <div className="space-y-3"><p>{bi('You already have an application.', 'آپ کی درخواست پہلے سے موجود ہے۔')}</p><Button size="xl" className="w-full" onClick={() => setView({ name: 'status', caseId })}>{bi('See my status', 'صورتحال دیکھیں')}</Button></div>
          : prefill === undefined ? <p className="p-6 text-center">…</p> : <ApplyFlow mode="citizen" existingCaseId={draftId} prefill={prefill ?? undefined} onSubmitted={(r) => { void syncNow(); if (r.caseId) setView({ name: 'status', caseId: r.caseId }); else back(); }} />
      )}
      {view.name === 'status' && <CaseStatusScreen caseId={view.caseId} trustPictureId={me.trustPictureId} onProof={(item) => setView({ name: 'proof', caseId: view.caseId, item })} onReceipt={(p) => setView({ name: 'receipt', payment: p })} />}
      {view.name === 'proof' && <ProofScreen caseId={view.caseId} item={view.item} onDone={() => setView({ name: 'status', caseId: view.caseId })} />}
      {view.name === 'receipt' && <ReceiptScreen payment={view.payment} trustPictureId={me.trustPictureId} onDone={back} />}
      {view.name === 'real' && <RealScreen signedIn initialText={shared.text} initialSender={shared.from} />}
      {view.name === 'data' && <><DataScreen caseId={caseId} /><DuressSafetyCard /><AccountActions onLoggedOut={() => window.location.reload()} /></>}
      {view.name === 'payout' && <PayoutChangeFlow onDone={back} />}
      {view.name === 'help' && <HelpScreen />}
    </main>
  );
}
