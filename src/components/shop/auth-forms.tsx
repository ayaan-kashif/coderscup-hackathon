'use client';
/**
 * Shopkeeper sign-in and sign-up. Shopkeepers can read: username + password, no keypad flow. Every message is in Urdu and English,
 * and the details are fictional (a made-up shop; email optional and only a made-up .test address).
 */
import { Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBi } from '@/components/voice/voice-lib';
import { safeNext } from '@/lib/shop-next';

type Msg = { en: string; ur: string };

function PasswordInput({ id, value, onChange, autoComplete, invalid }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string; invalid?: boolean }) {
  const bi = useBi();
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input id={id} type={show ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid || undefined} className="pe-12" />
      <button type="button" onClick={() => setShow((s) => !s)} className="absolute inset-y-0 end-0 flex w-11 items-center justify-center text-white/60 hover:text-mint" aria-label={show ? bi('Hide password', 'پاس ورڈ چھپائیں') : bi('Show password', 'پاس ورڈ دکھائیں')} aria-pressed={show} data-testid={`${id}-toggle`}>
        {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
      </button>
    </div>
  );
}

function FieldError({ m, id }: { m?: Msg; id: string }) {
  const bi = useBi();
  if (!m) return null;
  return <p role="alert" className="text-sm text-destructive" data-testid={`err-${id}`}>{bi(m.en, m.ur)}</p>;
}

export function ShopLoginForm({ next }: { next?: string }) {
  const bi = useBi();
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<Msg | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form className="space-y-4" data-testid="shop-login" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      const r = await fetch('/api/v1/auth/shopkeeper/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier, password }) });
      const b = await r.json().catch(() => ({}));
      setBusy(false);
      if (r.ok) { router.push(safeNext(next)); router.refresh(); return; }
      setPassword('');
      setErr(r.status === 429 ? { en: 'Too many tries. Wait 15 minutes and try again.', ur: 'بہت زیادہ کوششیں۔ 15 منٹ انتظار کر کے دوبارہ کوشش کریں۔' } : { en: b.en ?? 'Username or password is wrong.', ur: b.ur ?? 'یوزر نیم یا پاس ورڈ غلط ہے۔' });
    }}>
      <div className="space-y-2"><Label htmlFor="identifier">{bi('Username or email', 'یوزر نیم یا ای میل')}</Label><Input id="identifier" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoCapitalize="none" spellCheck={false} /></div>
      <div className="space-y-2"><Label htmlFor="password">{bi('Password', 'پاس ورڈ')}</Label><PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" /></div>
      {err && <p role="alert" className="text-sm text-destructive" data-testid="shop-login-error">{bi(err.en, err.ur)}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={busy || !identifier || !password} data-testid="shop-login-submit">{bi('Sign in', 'سائن اِن')}</Button>
      <p className="text-center text-sm">
        <Link href={`/signup/shopkeeper${next ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-semibold text-mint underline underline-offset-4" data-testid="shop-signup-link">{bi('New shop? Create an account', 'نئی دکان؟ اکاؤنٹ بنائیں')}</Link>
      </p>
    </form>
  );
}

export function ShopSignupForm({ districts, next }: { districts: { code: string; name: string; nameUr: string | null }[]; next?: string }) {
  const bi = useBi();
  const router = useRouter();
  const [f, setF] = useState({ shopName: '', username: '', password: '', passwordConfirm: '', districtCode: '', email: '', prototype: false });
  const [errs, setErrs] = useState<Record<string, Msg>>({});
  const [general, setGeneral] = useState<Msg | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string | boolean) => { setF((x) => ({ ...x, [k]: v })); setErrs((e) => { const c = { ...e }; delete c[k]; if (k === 'districtCode') delete c.district; return c; }); };
  return (
    <form className="space-y-4" data-testid="shop-signup" noValidate onSubmit={async (e) => {
      e.preventDefault();
      if (f.password !== f.passwordConfirm) { setErrs({ passwordConfirm: { en: 'The two passwords are different.', ur: 'دونوں پاس ورڈ مختلف ہیں۔' } }); return; }
      setBusy(true);
      const r = await fetch('/api/v1/auth/shopkeeper/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...f, email: f.email.trim() || undefined, lang: document.documentElement.lang === 'en' ? 'en' : 'ur' }) });
      const b = await r.json().catch(() => ({}));
      setBusy(false);
      if (r.status === 201) { router.push(safeNext(next)); router.refresh(); return; }
      if (b.fields) { setErrs(b.fields); setGeneral(null); return; }
      setGeneral(r.status === 429 ? { en: 'Too many new accounts from this connection. Try again in an hour.', ur: 'اس کنکشن سے بہت زیادہ نئے اکاؤنٹ۔ ایک گھنٹے بعد کوشش کریں۔' } : { en: 'Something went wrong. Try again.', ur: 'کچھ غلط ہو گیا۔ دوبارہ کوشش کریں۔' });
    }}>
      <div className="space-y-2"><Label htmlFor="shopName">{bi('Shop name', 'دکان کا نام')}</Label><Input id="shopName" value={f.shopName} maxLength={60} onChange={(e) => set('shopName')(e.target.value)} placeholder={bi('A made-up name, e.g. Noor Kiryana Store', 'فرضی نام، مثلاً نور کریانہ اسٹور')} /><FieldError m={errs.shopName} id="shopName" /></div>
      <div className="space-y-2">
        <Label htmlFor="username">{bi('Username', 'یوزر نیم')}</Label>
        <Input id="username" value={f.username} maxLength={20} autoComplete="username" autoCapitalize="none" spellCheck={false} onChange={(e) => set('username')(e.target.value.toLowerCase())} />
        <p className="text-xs text-white/60">{bi('4 to 20 characters: a-z, 0-9, dot or underscore.', '4 سے 20 حروف: a-z، 0-9، نقطہ یا انڈر اسکور۔')}</p>
        <FieldError m={errs.username} id="username" />
      </div>
      <div className="space-y-2"><Label htmlFor="password">{bi('Password (at least 8 characters)', 'پاس ورڈ (کم از کم 8 حروف)')}</Label><PasswordInput id="password" value={f.password} onChange={set('password') as (v: string) => void} autoComplete="new-password" invalid={!!errs.password} /><FieldError m={errs.password} id="password" /></div>
      <div className="space-y-2"><Label htmlFor="passwordConfirm">{bi('Password again', 'پاس ورڈ دوبارہ')}</Label><PasswordInput id="passwordConfirm" value={f.passwordConfirm} onChange={set('passwordConfirm') as (v: string) => void} autoComplete="new-password" invalid={!!errs.passwordConfirm} /><FieldError m={errs.passwordConfirm} id="passwordConfirm" /></div>
      <div className="space-y-2">
        <Label htmlFor="district">{bi('District of your shop', 'آپ کی دکان کا ضلع')}</Label>
        <select id="district" value={f.districtCode} onChange={(e) => set('districtCode')(e.target.value)} className="h-11 w-full rounded-xl border border-white/12 bg-white/[0.05] px-3 text-sm">
          <option value="">{bi('Choose…', 'چنیں…')}</option>
          {districts.map((d) => <option key={d.code} value={d.code}>{bi(d.name, d.nameUr ?? d.name)}</option>)}
        </select>
        <FieldError m={errs.district} id="district" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">{bi('Email (optional, made-up, ending in .test)', 'ای میل (اختیاری، فرضی، .test پر ختم)')}</Label>
        <Input id="email" type="email" value={f.email} maxLength={120} autoComplete="off" onChange={(e) => set('email')(e.target.value)} placeholder="name@shop.test" />
        <p className="text-xs text-white/60">{bi('Nothing is ever emailed.', 'کبھی کوئی ای میل نہیں بھیجی جاتی۔')}</p>
        <FieldError m={errs.email} id="email" />
      </div>
      <label className="flex items-start gap-3 rounded-[20px] border border-warning/40 bg-warning/10 p-4 text-sm">
        <input type="checkbox" className="mt-0.5 size-5 accent-[var(--warning)]" checked={f.prototype} onChange={(e) => set('prototype')(e.target.checked)} data-testid="shop-prototype" />
        <span>{bi('This is a prototype: I am using made-up details.', 'یہ ایک تجرباتی نمونہ ہے: میں فرضی تفصیلات استعمال کر رہا ہوں۔')}</span>
      </label>
      <FieldError m={errs.prototype} id="prototype" />
      {general && <p role="alert" className="text-sm text-destructive">{bi(general.en, general.ur)}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={busy} data-testid="shop-signup-submit">{bi('Create my shop account', 'میرا دکان اکاؤنٹ بنائیں')}</Button>
      <p className="text-center text-sm"><Link href="/login/shopkeeper" className="underline underline-offset-4">{bi('Already have an account? Sign in', 'پہلے سے اکاؤنٹ ہے؟ سائن اِن کریں')}</Link></p>
    </form>
  );
}
