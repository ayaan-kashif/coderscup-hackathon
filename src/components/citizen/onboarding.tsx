'use client';
/**
 * First-run pieces for a citizen who signs in with her own WhatsApp number: the WhatsApp phone form, the "WhatsApp is not available"
 * panel, "About you" (name, date of birth, district: each saved as it is given), the prototype notice, and the My data account block.
 * Everything she enters is fictional: the notice says so on the consent and About-you screens.
 */
import { LogOut, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { DISTRICT_ICONS } from '@/components/apply/question';
import { StepFrame } from '@/components/brand/step-frame';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Keypad } from '@/components/voice/keypad';
import { speakText, useBi } from '@/components/voice/voice-lib';
import { VoicePrompt, playSequence } from '@/components/voice/voice-prompt';
import { api } from './screens';

export type Bilingual = { en: string; ur: string };
export type OnboardingState = { step: 'trust' | 'consent' | 'name' | 'dob' | 'district' | 'done'; districts: { code: string; name: string; nameUr: string | null }[]; profile: { name: string | null; dob: string | null; districtSet: boolean; districtCode: string | null; onboarded: boolean } };

/** "03001234567" and "3001234567" are the same number: a typed leading 0 is dropped; 10 digits starting with 3 */
export const waDigits = (v: string) => v.replace(/\D/g, '').replace(/^0+/, '').slice(0, 10);
export const waValid = (d: string) => /^3\d{9}$/.test(d);
const showNumber = (d: string) => `+92 ${d.slice(0, 3)}${d.length > 3 ? ' ' : ''}${d.slice(3)}`;

/** CIT-10 style notice, bilingual, read aloud on request */
export function PrototypeNotice({ compact = false }: { compact?: boolean }) {
  const bi = useBi();
  return (
    <div className="space-y-2 rounded-[20px] border border-warning/40 bg-warning/10 p-4 text-sm leading-relaxed" data-testid="prototype-notice" role="note">
      <p>{bi("This is a prototype: use made-up details only. Don't enter a real CNIC, bank number or address.", 'یہ ایک تجرباتی نمونہ ہے: صرف فرضی تفصیلات لکھیں۔ اصلی شناختی کارڈ نمبر، بینک نمبر یا پتہ نہ لکھیں۔')}</p>
      {!compact && <p className="text-xs text-white/60" lang={bi('ur', 'en')}>{bi('یہ ایک تجرباتی نمونہ ہے: صرف فرضی تفصیلات لکھیں۔ اصلی شناختی کارڈ نمبر، بینک نمبر یا پتہ نہ لکھیں۔', "This is a prototype: use made-up details only. Don't enter a real CNIC, bank number or address.")}</p>}
      <VoicePrompt clip="prototype_notice" label={bi('Hear this', 'یہ سنیں')} autoPlay={false} />
    </div>
  );
}

/** the real-number phone screen: WhatsApp badge, "we'll send the code to your WhatsApp", +92 and 10 digits */
export function WhatsappPhoneForm({ digits, setDigits, message, onSent, onUnavailable, onDemo }: {
  digits: string; setDigits: (d: string) => void; message: Bilingual | null; onSent: () => void; onUnavailable: () => void; onDemo: () => void;
}) {
  const bi = useBi();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Bilingual | null>(message);
  const wrongStart = digits.length > 0 && digits[0] !== '3';
  return (
    <div className="space-y-4" data-testid="whatsapp-phone">
      <p className="inline-flex items-center gap-2 rounded-full border border-mint/40 bg-mint/10 px-3 py-1 text-sm font-bold text-mint" data-testid="whatsapp-badge">
        <span aria-hidden>💬</span> واٹس ایپ / WhatsApp
      </p>
      <p className="text-sm text-muted-foreground">{bi("We'll send the code to your WhatsApp.", 'ہم کوڈ آپ کے واٹس ایپ پر بھیجیں گے۔')}</p>
      <p dir="ltr" className="text-center text-2xl font-bold tracking-wider" aria-live="polite" data-testid="whatsapp-number">{digits ? showNumber(digits) : '+92 3__ _______'}</p>
      <Keypad value={digits} onChange={(v) => { setErr(null); setDigits(waDigits(v)); }} max={10} />
      {(wrongStart || err) && (
        <p role="alert" className="text-center text-destructive" data-testid="whatsapp-error">
          {wrongStart ? bi('A Pakistani mobile number starts with 3 after +92.', 'پاکستانی موبائل نمبر +92 کے بعد 3 سے شروع ہوتا ہے۔') : bi(err!.en, err!.ur)}
        </p>
      )}
      <Button size="xl" className="w-full" disabled={!waValid(digits) || busy} data-testid="whatsapp-send" onClick={async () => {
        setBusy(true);
        const r = await api('/api/v1/auth/otp/request', { body: { phone: `+92${digits}`, lang: document.cookie.includes('amanat_locale=en') ? 'en' : 'ur' } });
        setBusy(false);
        if (r.status === 202) { setErr(null); onSent(); return; }
        if (r.body.reason === 'whatsapp_unavailable' || r.status >= 500) { onUnavailable(); return; }
        setErr({ en: r.body.en ?? r.body.detail ?? 'Something went wrong. Try again.', ur: r.body.ur ?? 'کچھ غلط ہو گیا۔ دوبارہ کوشش کریں۔' });
      }}>💬 {bi('Send the code', 'کوڈ بھیجیں')}</Button>
      <button type="button" className="block w-full text-center text-sm underline" onClick={onDemo} data-testid="use-demo-phone">{bi('Use the demo phone instead', 'اس کے بجائے ڈیمو فون استعمال کریں')}</button>
    </div>
  );
}

/** shown when the gateway is down or the send failed: the demo phone is one tap away */
export function WhatsappUnavailable({ onDemo }: { onDemo: () => void }) {
  const bi = useBi();
  return (
    <div className="space-y-4 rounded-[20px] border border-warning/40 bg-warning/10 p-5 text-center" role="alert" data-testid="whatsapp-unavailable">
      <p className="text-lg font-bold">{bi('WhatsApp is not available right now.', 'واٹس ایپ ابھی دستیاب نہیں ہے۔')}</p>
      <p className="text-sm text-white/70">{bi('You can sign in with the demo phone, which shows the code on the screen.', 'آپ ڈیمو فون سے داخل ہو سکتے ہیں، جو کوڈ اسکرین پر دکھاتا ہے۔')}</p>
      <Button size="xl" className="w-full" onClick={onDemo} data-testid="use-demo-phone">📱 {bi('Use the demo phone instead', 'اس کے بجائے ڈیمو فون استعمال کریں')}</Button>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
/** DDMMYYYY digits to an ISO date, or null when it cannot be a date */
export function dobFromDigits(d: string): string | null {
  if (!/^\d{8}$/.test(d)) return null;
  const day = Number(d.slice(0, 2)), month = Number(d.slice(2, 4)), year = Number(d.slice(4));
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** About you: full name (typing, read back), date of birth (keypad), district (icons). Each answer is saved the moment she gives it. */
export function AboutYou({ state, onSaved }: { state: OnboardingState; onSaved: () => void }) {
  const bi = useBi();
  const [name, setName] = useState('');
  const [digits, setDigits] = useState('');
  const [err, setErr] = useState<Bilingual | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (body: Record<string, string>) => {
    setBusy(true);
    const r = await api('/api/v1/me', { method: 'PATCH', body });
    setBusy(false);
    if (r.status === 200) { setErr(null); void playSequence(['saved_on_phone']); onSaved(); return; }
    const [en, ur] = String(r.body.detail ?? '').split(' / ');
    setErr({ en: en || 'Something went wrong. Try again.', ur: ur || 'کچھ غلط ہو گیا۔ دوبارہ کوشش کریں۔' });
  };
  const total = 3;

  if (state.step === 'name') {
    return (
      <StepFrame data-testid="about-name" title={bi('Your full name', 'آپ کا پورا نام')} voice={<VoicePrompt clip="q_name" label={bi('Play again', 'دوبارہ سنیں')} />} step={1} total={total}>
        <PrototypeNotice compact />
        <Input value={name} onChange={(e) => { setName(e.target.value); setErr(null); }} maxLength={80} autoComplete="off" placeholder={bi('A made-up name', 'ایک فرضی نام')} aria-label={bi('Your full name', 'آپ کا پورا نام')} data-testid="about-name-input" className="h-14 text-lg" />
        {name.trim().length >= 2 && (
          <Button type="button" variant="outline" size="lg" className="w-full" onClick={() => { void playSequence(['i_heard']).then(() => speakText(name.trim(), { kind: 'readback' })); }} data-testid="about-name-hear">🔊 {bi('Hear it read back', 'پڑھ کر سنیں')}</Button>
        )}
        {err && <p role="alert" className="text-center text-destructive">{bi(err.en, err.ur)}</p>}
        <Button size="xl" className="w-full" disabled={busy || name.trim().length < 2} onClick={() => void save({ fullName: name.trim() })} data-testid="about-name-ok">✓ {bi('That is right', 'یہ درست ہے')}</Button>
      </StepFrame>
    );
  }

  if (state.step === 'dob') {
    const shown = `${digits.slice(0, 2).padEnd(2, '_')} / ${digits.slice(2, 4).padEnd(2, '_')} / ${digits.slice(4, 8).padEnd(4, '_')}`;
    const iso = dobFromDigits(digits);
    return (
      <StepFrame data-testid="about-dob" title={bi('Your date of birth', 'آپ کی تاریخ پیدائش')} voice={<VoicePrompt clip="q_dob" label={bi('Play again', 'دوبارہ سنیں')} />} step={2} total={total}>
        <p className="text-center text-sm text-muted-foreground">{bi('Day, month, year: for example 20 05 1975', 'دن، مہینہ، سال: مثلاً 20 05 1975')}</p>
        <p dir="ltr" className="text-center text-2xl font-bold tracking-wider" aria-live="polite" data-testid="about-dob-shown">{shown}</p>
        <Keypad value={digits} onChange={(v) => { setDigits(v.replace(/\D/g, '').slice(0, 8)); setErr(null); }} max={8} />
        {digits.length === 8 && !iso && <p role="alert" className="text-center text-destructive">{bi('That date does not exist.', 'یہ تاریخ درست نہیں۔')}</p>}
        {err && <p role="alert" className="text-center text-destructive">{bi(err.en, err.ur)}</p>}
        <Button size="xl" className="w-full" disabled={busy || !iso} onClick={() => void save({ dob: iso! })} data-testid="about-dob-ok">✓ {bi('Next', 'آگے')}</Button>
      </StepFrame>
    );
  }

  // district: icons, only the offices she agreed to share with
  const icons = state.districts.map((d) => ({ ...d, icon: DISTRICT_ICONS.find((i) => i.code === d.code)?.icon ?? '📍' }));
  return (
    <StepFrame data-testid="about-district" title={bi('Your district', 'آپ کا ضلع')} voice={<VoicePrompt clip="q_district" label={bi('Play again', 'دوبارہ سنیں')} />} step={3} total={total}>
      <div className="grid grid-cols-2 gap-3">
        {icons.map((d) => (
          <Button key={d.code} size="xl" variant="outline" disabled={busy} className="h-24 flex-col gap-1 text-base" data-testid={`about-district-${d.code}`} onClick={() => void save({ districtCode: d.code })}>
            <span className="text-3xl" aria-hidden>{d.icon}</span>{bi(d.name, d.nameUr ?? d.name)}
          </Button>
        ))}
      </div>
      {err && <p role="alert" className="text-center text-destructive">{bi(err.en, err.ur)}</p>}
    </StepFrame>
  );
}

/** My data: log out, and "Delete my account and data" with a confirmation and her PIN */
export function AccountActions({ onLoggedOut }: { onLoggedOut: () => void }) {
  const bi = useBi();
  const [confirming, setConfirming] = useState(false);
  const [sure, setSure] = useState(false);
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section className="space-y-3 rounded-[24px] border border-white/10 bg-void/40 p-4" data-testid="account-actions">
      <Button size="lg" variant="outline" className="w-full" data-testid="logout" onClick={async () => { await api('/api/v1/auth/logout', { method: 'POST', body: {} }); onLoggedOut(); }}>
        <LogOut className="!size-5" /> {bi('Log out', 'لاگ آؤٹ')}
      </Button>
      {!confirming ? (
        <Button size="lg" variant="destructive" className="w-full" data-testid="delete-account" onClick={() => setConfirming(true)}>
          <Trash2 className="!size-5" /> {bi('Delete my account and data', 'میرا اکاؤنٹ اور ڈیٹا حذف کریں')}
        </Button>
      ) : (
        <div className="space-y-3 rounded-[20px] border-2 border-destructive p-4" data-testid="delete-confirm" role="alertdialog" aria-label={bi('Delete my account and data', 'میرا اکاؤنٹ اور ڈیٹا حذف کریں')}>
          <p className="font-semibold">{bi('This removes your applications, documents, permissions and your account. It cannot be undone.', 'اس سے آپ کی درخواستیں، دستاویزات، اجازتیں اور اکاؤنٹ ہٹ جائیں گے۔ اسے واپس نہیں کیا جا سکتا۔')}</p>
          <label className="flex items-center gap-3 text-base">
            <input type="checkbox" className="size-6 accent-[var(--destructive)]" checked={sure} onChange={(e) => setSure(e.target.checked)} data-testid="delete-sure" />
            {bi('Yes, delete everything', 'ہاں، سب کچھ حذف کریں')}
          </label>
          <p className="text-sm text-muted-foreground">{bi('Enter your PIN to confirm', 'تصدیق کے لیے اپنا پن لکھیں')}</p>
          <Keypad value={pin} onChange={setPin} max={4} masked />
          {msg && <p role="alert" className="text-destructive">{msg}</p>}
          <Button size="xl" variant="destructive" className="w-full" disabled={!sure || pin.length !== 4 || busy} data-testid="delete-go" onClick={async () => {
            setBusy(true);
            const r = await api('/api/v1/me', { method: 'DELETE', body: { pin, confirm: true } });
            setBusy(false);
            setPin('');
            if (r.status === 200) { try { localStorage.clear(); } catch { /* ignore */ } onLoggedOut(); } else setMsg(r.body.detail ?? bi('Something went wrong.', 'کچھ غلط ہو گیا۔'));
          }}>{bi('Delete my account and data', 'میرا اکاؤنٹ اور ڈیٹا حذف کریں')}</Button>
          <Button variant="ghost" className="w-full" onClick={() => { setConfirming(false); setSure(false); setPin(''); setMsg(null); }}>{bi('Cancel', 'منسوخ')}</Button>
        </div>
      )}
    </section>
  );
}
