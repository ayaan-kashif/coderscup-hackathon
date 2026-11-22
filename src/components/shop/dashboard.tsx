'use client';
/**
 * The shopkeeper's dashboard: check a message (paste, screenshot or voice), a verdict card with the reasons read aloud and one action,
 * "Tell your customer" (a short Urdu voice note), "Report this scam" (counts for his district on the Scam Map), My checks, the approved
 * alerts of his district, log out and delete the shop account. Every call goes through the API, which checks the session and role.
 */
import { LogOut, Megaphone, Mic, Square, Trash2, Volume2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckIcon } from '@/components/citizen/screens';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useBi } from '@/components/voice/voice-lib';
import { VoicePrompt, playSequence } from '@/components/voice/voice-prompt';

type Reason = { code: string; result: string; en: string; ur: string };
type Verdict = { reportId: string; verdict: 'fake' | 'genuine' | 'not_sure'; reasons: Reason[]; action: { en: string; ur: string }; ledger: { checked: boolean; matched: boolean | null } };
type Check = { id: string; createdAt: string; verdict: Verdict['verdict']; scamType: string | null; reasons: Reason[]; reported: boolean | null };
type Alert = { id: string; scamType: string; count: number; status: string; createdAt: string; sentAt: string | null };
export type Shop = { shopName: string; username: string | null; district: { code: string; name: string; nameUr: string | null } };

async function call(path: string, init: { method?: string; body?: unknown } = {}) {
  const r = await fetch(path, { method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'), credentials: 'same-origin', headers: init.body !== undefined ? { 'content-type': 'application/json' } : {}, body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const toBase64 = async (blob: Blob) => {
  const b = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const verdictClips = (v: { verdict: string; reasons: Reason[] }) => [
  v.verdict === 'fake' ? 'real_fake' : v.verdict === 'genuine' ? 'real_genuine' : 'real_not_sure',
  ...(v.reasons.some((x) => x.code === 'fee' && x.result === 'contradiction') ? ['real_no_fee'] : []),
  ...(v.reasons.some((x) => x.code === 'ledger' && x.result === 'contradiction') ? ['real_no_payment'] : []),
];
const SCAM_TYPE: Record<string, [string, string]> = {
  fee_before_payment: ['Asks for a fee before payment', 'ادائیگی سے پہلے فیس مانگنا'], asks_pin_code_cnic: ['Asks for a PIN, code or CNIC', 'پن، کوڈ یا شناختی کارڈ مانگنا'],
  fake_approval_link: ['Fake approval link', 'جعلی منظوری لنک'], impersonation_call: ['Pretends to be an officer', 'افسر بن کر کال'],
  fake_registration_drive: ['Fake registration drive', 'جعلی رجسٹریشن مہم'], lottery_prize: ['Lottery or prize', 'لاٹری یا انعام'],
};

function VerdictCard({ v, onReported, onAnother }: { v: Verdict; onReported: () => void; onAnother: () => void }) {
  const bi = useBi();
  const [reported, setReported] = useState<{ alert: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const color = v.verdict === 'fake' ? 'border-destructive bg-destructive/10' : v.verdict === 'genuine' ? 'border-success bg-success/10' : 'border-warning bg-warning/10';
  return (
    <section className={`space-y-3 rounded-[24px] border-2 p-5 animate-in zoom-in-95 fade-in-0 duration-500 ${color}`} data-testid="shop-verdict" data-verdict={v.verdict}>
      <p className="text-3xl font-black">{v.verdict === 'fake' ? bi('FAKE', 'جعلی') : v.verdict === 'genuine' ? bi('Looks genuine', 'اصلی لگتا ہے') : bi('Not sure', 'یقین نہیں')}</p>
      <p className="text-lg font-semibold">{bi(v.action.en, v.action.ur)}</p>
      <ul className="space-y-1">{v.reasons.map((r) => <li key={r.code} className="flex gap-2"><CheckIcon state={r.result === 'contradiction' ? 'fail' : r.result === 'support' ? 'pass' : 'unclear'} /><span className="self-center">{bi(r.en, r.ur)}</span></li>)}</ul>
      <Button variant="outline" className="w-full" onClick={() => void playSequence(verdictClips(v))}><Volume2 className="!size-5" /> {bi('Read it aloud again', 'دوبارہ سنیں')}</Button>
      {v.verdict === 'fake' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Button size="lg" variant="secondary" onClick={() => void playSequence(['tell_customer'])} data-testid="tell-customer"><Megaphone className="!size-5" /> {bi('Tell your customer', 'اپنے گاہک کو بتائیں')}</Button>
          {!reported ? (
            <Button size="lg" variant="destructive" disabled={busy} data-testid="report-scam" onClick={async () => {
              setBusy(true);
              const r = await call('/api/v1/shop/reports', { body: { reportId: v.reportId } });
              setBusy(false);
              if (r.status === 200) { setReported({ alert: !!r.body.alertDrafted }); void playSequence(['shop_reported']); onReported(); }
            }}>🚩 {bi('Report this scam', 'اس دھوکے کی رپورٹ کریں')}</Button>
          ) : (
            <p role="status" className="rounded-2xl bg-mint/10 p-3 text-sm text-mint" data-testid="reported">
              {bi('Reported. It now counts for your district on the Scam Map.', 'رپورٹ ہو گئی۔ یہ اب آپ کے ضلع کے نقشے میں شامل ہے۔')}
              {reported.alert && ` ${bi('An officer will review a district alert.', 'ایک افسر ضلعی الرٹ کا جائزہ لے گا۔')}`}
            </p>
          )}
        </div>
      )}
      {v.verdict === 'not_sure' && <p role="status" className="rounded-2xl bg-warning/10 p-3 text-sm" data-testid="sent-to-desk">{bi('Sent to the Scam desk: an officer will look at it. Until then, do not pay anything.', 'اسکیم ڈیسک کو بھیج دیا گیا: ایک افسر دیکھے گا۔ تب تک کوئی ادائیگی نہ کریں۔')}</p>}
      <Button variant="ghost" className="w-full" onClick={onAnother}>{bi('Check another message', 'دوسرا پیغام جانچیں')}</Button>
    </section>
  );
}

/** paste box, screenshot picker and a mic, an optional sender, and "sent to you, or to a customer?" */
function CheckMessage({ initialText, initialSender, onChecked }: { initialText: string; initialSender: string; onChecked: () => void }) {
  const bi = useBi();
  const [text, setText] = useState(initialText);
  const [sender, setSender] = useState(initialSender);
  const [image, setImage] = useState<string | null>(null);
  const [audio, setAudio] = useState<{ b64: string; type: string } | null>(null);
  const [recording, setRecording] = useState(false);
  const [mine, setMine] = useState<boolean | null>(null);
  const [v, setV] = useState<Verdict | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); if (rec.current?.state === 'recording') rec.current.stop(); }, []);

  const startRec = async () => {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunks, { type: r.mimeType || 'audio/webm' });
        if (blob.size < 500) { setErr(bi('I did not hear anything. Try again, or paste the text.', 'کچھ سنائی نہیں دیا۔ دوبارہ کوشش کریں، یا متن چسپاں کریں۔')); return; }
        setAudio({ b64: await toBase64(blob), type: (r.mimeType || 'audio/webm').split(';')[0]! });
      };
      rec.current = r;
      r.start();
      setRecording(true);
      timer.current = setTimeout(() => { if (r.state === 'recording') r.stop(); }, 15_000);
    } catch {
      setErr(bi('The microphone is blocked or not available. Paste the text instead.', 'مائیکروفون بند ہے یا دستیاب نہیں۔ اس کے بجائے متن چسپاں کریں۔'));
    }
  };

  const check = async () => {
    setBusy(true); setErr(null);
    const channel = image ? 'screenshot' : audio && !text ? 'voice' : 'text';
    const r = await call('/api/v1/scam/check', { body: {
      channel, ...(text ? { text } : {}), ...(sender ? { sender } : {}), ...(image ? { imageBase64: image } : {}),
      ...(audio && !text && !image ? { audioBase64: audio.b64, audioMediaType: audio.type } : {}), sentToMe: !!mine,
    } });
    setBusy(false);
    if (r.status === 200) { setV(r.body); void playSequence(verdictClips(r.body)); onChecked(); }
    else setErr(r.status === 429 ? bi('Too many checks. Wait a few minutes.', 'بہت زیادہ جانچ۔ چند منٹ انتظار کریں۔') : (r.body.detail ?? String(r.status)));
  };

  if (v) return <VerdictCard v={v} onReported={onChecked} onAnother={() => { setV(null); setText(''); setSender(''); setImage(null); setAudio(null); setMine(null); }} />;
  const hasInput = !!text || !!image || !!audio;
  return (
    <section className="space-y-4" data-testid="shop-check">
      <VoicePrompt clip="real_paste" label={bi('Play again', 'دوبارہ سنیں')} autoPlay={false} />
      <textarea className="min-h-32 w-full rounded-[20px] border border-white/12 bg-white/5 p-3 text-lg transition-colors focus-visible:border-mint" placeholder={bi('Paste the message here', 'پیغام یہاں چسپاں کریں')} value={text} onChange={(e) => setText(e.target.value)} data-testid="shop-text" />
      <Input placeholder={bi('Sender, as shown on the phone (optional)', 'بھیجنے والا، جیسا فون پر لکھا ہے (اختیاری)')} value={sender} onChange={(e) => setSender(e.target.value)} data-testid="shop-sender" />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-[20px] border-2 border-dashed border-white/20 p-3 transition-colors hover:border-mint/60 hover:bg-white/5">
          🖼️ {image ? bi('Screenshot added', 'اسکرین شاٹ شامل') : bi('Or add a screenshot', 'یا اسکرین شاٹ دیں')}
          <input type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setImage(await toBase64(f)); }} />
        </label>
        <Button type="button" variant="outline" className="h-auto rounded-[20px] border-2 border-dashed py-3" onClick={() => (recording ? rec.current?.stop() : void startRec())} data-testid="shop-mic">
          {recording ? <><Square className="!size-5 text-destructive" /> {bi('Stop (up to 15 s)', 'روکیں (15 سیکنڈ تک)')}</> : audio ? <><Mic className="!size-5" /> {bi('Voice note added', 'آواز شامل')}</> : <><Mic className="!size-5" /> {bi('Or say it / play the voice note', 'یا بول کر سنائیں')}</>}
        </Button>
      </div>
      <p className="font-semibold">{bi('Was this sent to you, or to a customer?', 'یہ پیغام آپ کو آیا یا کسی گاہک کو؟')}</p>
      <div className="grid grid-cols-2 gap-3">
        <Button size="xl" variant={mine === true ? 'default' : 'outline'} onClick={() => setMine(true)} data-testid="shop-sent-to-me">🏪 {bi('Sent to me', 'مجھے آیا')}</Button>
        <Button size="xl" variant={mine === false ? 'default' : 'outline'} onClick={() => setMine(false)} data-testid="shop-sent-to-customer">👥 {bi('A customer', 'گاہک کو')}</Button>
      </div>
      {mine === true && <p className="text-sm text-muted-foreground">{bi('A shop gets no programme payments, so any payment this message claims is not yours.', 'دکان کو پروگرام کی کوئی ادائیگی نہیں ملتی، اس لیے اس پیغام میں بتائی گئی ادائیگی آپ کی نہیں۔')}</p>}
      {err && <p role="alert" className="text-destructive">{err}</p>}
      <Button size="xl" className="w-full" disabled={busy || !hasInput || mine === null || recording} onClick={() => void check()} data-testid="shop-check-go">{busy ? '…' : bi('Check', 'جانچیں')}</Button>
    </section>
  );
}

export function ShopDashboard({ shop, initialText = '', initialSender = '' }: { shop: Shop; initialText?: string; initialSender?: string }) {
  const bi = useBi();
  const router = useRouter();
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [sure, setSure] = useState(false);
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let alive = true;
    void Promise.all([call('/api/v1/shop/checks'), call('/api/v1/shop/alerts')]).then(([c, a]) => {
      if (!alive) return;
      if (c.status === 200) setChecks(c.body.items);
      if (a.status === 200) setAlerts(a.body.items);
    });
    return () => { alive = false; };
  }, [version]);
  const district = bi(shop.district.name, shop.district.nameUr ?? shop.district.name);
  const logout = async () => { await call('/api/v1/auth/logout', { body: {} }); router.push('/login/shopkeeper'); router.refresh(); };

  return (
    <div className="space-y-6" data-testid="shop-dashboard">
      <p className="text-white/80">🏪 <strong>{shop.shopName}</strong> · {district}</p>

      <section className="space-y-3 rounded-[28px] border border-white/[0.08] bg-bento p-5">
        <h2 className="text-xl font-bold">{bi('Check a message', 'پیغام جانچیں')}</h2>
        <CheckMessage initialText={initialText} initialSender={initialSender} onChecked={load} />
      </section>

      <section className="space-y-3 rounded-[28px] border border-white/[0.08] bg-bento p-5" data-testid="shop-alerts">
        <h2 className="text-xl font-bold">{bi(`Alerts in my district: ${shop.district.name}`, `میرے ضلع کے الرٹ: ${shop.district.nameUr ?? shop.district.name}`)}</h2>
        {alerts?.length ? (
          <ul className="space-y-2">{alerts.map((a) => (
            <li key={a.id} className="rounded-2xl border border-destructive/40 bg-destructive/10 p-3" data-alert={a.id}>
              <p className="font-semibold">⚠️ {bi(SCAM_TYPE[a.scamType]?.[0] ?? a.scamType.replace(/_/g, ' '), SCAM_TYPE[a.scamType]?.[1] ?? a.scamType)}</p>
              <p className="text-sm text-white/70">{bi(`${a.count} fake messages reported`, `${a.count} جعلی پیغامات کی رپورٹ`)} · {new Date(a.sentAt ?? a.createdAt).toLocaleString()}</p>
            </li>
          ))}</ul>
        ) : alerts ? <p className="text-muted-foreground">{bi('No alerts for your district.', 'آپ کے ضلع کے لیے کوئی الرٹ نہیں۔')}</p> : <p aria-busy>…</p>}
      </section>

      <section className="space-y-3 rounded-[28px] border border-white/[0.08] bg-bento p-5" data-testid="shop-checks">
        <h2 className="text-xl font-bold">{bi('My checks', 'میری جانچ')}</h2>
        {checks?.length ? (
          <ul className="space-y-2">{checks.map((c) => (
            <li key={c.id} className="space-y-1 rounded-2xl border border-white/10 bg-void/40 p-3" data-check={c.id} data-verdict={c.verdict}>
              <p className="flex flex-wrap items-center justify-between gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-sm font-bold ${c.verdict === 'fake' ? 'bg-destructive text-void' : c.verdict === 'genuine' ? 'bg-success text-void' : 'bg-warning text-void'}`}>
                  {c.verdict === 'fake' ? bi('Fake', 'جعلی') : c.verdict === 'genuine' ? bi('Genuine', 'اصلی') : bi('Not sure', 'یقین نہیں')}
                </span>
                <span className="text-xs text-white/60">{new Date(c.createdAt).toLocaleString()}</span>
              </p>
              <ul className="text-sm text-white/80">{c.reasons.filter((r) => r.result !== 'neutral').slice(0, 3).map((r) => <li key={r.code}>• {bi(r.en, r.ur)}</li>)}</ul>
              {c.verdict === 'fake' && (c.reported
                ? <p className="text-xs text-mint">{bi('Reported', 'رپورٹ ہو گئی')}</p>
                : <Button size="sm" variant="outline" onClick={async () => { await call('/api/v1/shop/reports', { body: { reportId: c.id } }); load(); }}>🚩 {bi('Report this scam', 'رپورٹ کریں')}</Button>)}
            </li>
          ))}</ul>
        ) : checks ? <p className="text-muted-foreground">{bi('No checks yet.', 'ابھی کوئی جانچ نہیں۔')}</p> : <p aria-busy>…</p>}
      </section>

      <section className="space-y-3 rounded-[24px] border border-white/10 bg-void/40 p-4" data-testid="shop-account">
        <Button size="lg" variant="outline" className="w-full" onClick={() => void logout()} data-testid="shop-logout"><LogOut className="!size-5" /> {bi('Log out', 'لاگ آؤٹ')}</Button>
        {!deleting ? (
          <Button size="lg" variant="destructive" className="w-full" onClick={() => setDeleting(true)} data-testid="shop-delete"><Trash2 className="!size-5" /> {bi('Delete my shop account', 'میرا دکان اکاؤنٹ حذف کریں')}</Button>
        ) : (
          <form className="space-y-3 rounded-[20px] border-2 border-destructive p-4" data-testid="shop-delete-confirm" onSubmit={async (e) => {
            e.preventDefault();
            const r = await call('/api/v1/shop/me', { method: 'DELETE', body: { password, confirm: true } });
            setPassword('');
            if (r.status === 200) { router.push('/login/shopkeeper'); router.refresh(); }
            else setMsg(r.body.en ? bi(r.body.en, r.body.ur) : bi('Something went wrong.', 'کچھ غلط ہو گیا۔'));
          }}>
            <p className="font-semibold">{bi('This removes your shop, your login and your sessions. Your past checks stay as anonymous reports. It cannot be undone.', 'اس سے آپ کی دکان، لاگ اِن اور سیشن ہٹ جائیں گے۔ آپ کی پرانی جانچ گمنام رپورٹ کے طور پر رہے گی۔ اسے واپس نہیں کیا جا سکتا۔')}</p>
            <label className="flex items-center gap-3"><input type="checkbox" className="size-5" checked={sure} onChange={(e) => setSure(e.target.checked)} data-testid="shop-delete-sure" />{bi('Yes, delete my shop account', 'ہاں، میرا دکان اکاؤنٹ حذف کریں')}</label>
            <Input type="password" autoComplete="current-password" placeholder={bi('Your password', 'آپ کا پاس ورڈ')} value={password} onChange={(e) => setPassword(e.target.value)} data-testid="shop-delete-password" />
            {msg && <p role="alert" className="text-destructive">{msg}</p>}
            <Button type="submit" variant="destructive" className="w-full" disabled={!sure || !password} data-testid="shop-delete-go">{bi('Delete my shop account', 'میرا دکان اکاؤنٹ حذف کریں')}</Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => { setDeleting(false); setSure(false); setPassword(''); setMsg(null); }}>{bi('Cancel', 'منسوخ')}</Button>
          </form>
        )}
      </section>
    </div>
  );
}
