'use client';
import { AlertTriangle, Check, Mic, RefreshCw, ShieldOff, Volume2, X } from 'lucide-react';
import { isLowBandwidth } from '@/components/shell/low-bandwidth';
import { useCallback, useEffect, useState } from 'react';
import { CameraCapture } from '@/components/apply/camera';
import { DISTRICT_ICONS } from '@/components/apply/question';
import { syncNow } from '@/components/apply/apply-flow';
import { SimulatedBadge } from '@/components/shell/simulated-badge';
import { Button } from '@/components/ui/button';
import { Keypad } from '@/components/voice/keypad';
import { VoicePrompt, playSequence } from '@/components/voice/voice-prompt';
import { amountClips, speakText, useBi } from '@/components/voice/voice-lib';
import { enqueue, outboxDb } from '@/offline/outbox';
import { Ticks } from './ticks';

export async function api(path: string, init: { method?: string; body?: unknown; idem?: boolean } = {}) {
  const r = await fetch(path, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'), credentials: 'same-origin',
    headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(init.idem ? { 'Idempotency-Key': crypto.randomUUID() } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

/** pass = green circle + tick, fail = red square + cross, unclear = amber triangle (shape carries the meaning, §16.1) */
export function CheckIcon({ state }: { state: string }) {
  if (state === 'pass') return <span className="inline-flex size-10 items-center justify-center rounded-full bg-success text-success-foreground" aria-label="pass"><Check className="size-6" /></span>;
  if (state === 'fail') return <span className="inline-flex size-10 items-center justify-center rounded-sm bg-destructive text-void" aria-label="fail"><X className="size-6" /></span>;
  return <span className="inline-flex size-10 items-center justify-center text-warning" aria-label="unclear"><AlertTriangle className="size-9 fill-warning stroke-warning-foreground" /></span>;
}

const CHECK_LABEL: Record<string, [string, string]> = {
  'R-GENDER': ['Woman applicant', 'خاتون درخواست گزار'], 'R-AGE': ['Age', 'عمر'], 'R-WIDOW': ['Husband passed away', 'شوہر کی وفات'],
  'R-DEATH-WINDOW': ['Within ten years', 'دس سال کے اندر'], 'R-NOT-REMARRIED': ['Not remarried', 'دوبارہ شادی نہیں'], 'R-INCOME': ['Household income', 'گھر کی آمدنی'],
  'R-RESIDENCE': ['District', 'ضلع'], 'R-CNIC-VALID': ['Identity card valid', 'کارڈ کی میعاد'],
};

type Status = {
  id: string; status: string; ticks: 'grey2' | 'blue2'; checks: { code: string; state: string; icon: string }[];
  next: { code: string; voice: string } | null; proof: { item: string; attemptsLeft: number } | null;
  payment: { id: string; amount: number; status: string; holdUntil: string | null; confirmedAmount: number | null } | null;
  pipeline: { step: string | null; steps: number } | null; officerDecision: { outcome: string; reasonCode: string | null } | null;
};

/** C9: ticks, checks as icons, a voice explanation and "what to do next" */
export function CaseStatusScreen({ caseId, trustPictureId, onProof, onReceipt }: { caseId: string; trustPictureId?: number | null; onProof: (item: string) => void; onReceipt: (p: NonNullable<Status['payment']>) => void }) {
  const bi = useBi();
  const [s, setS] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api(`/api/v1/cases/${caseId}/status`).then((r) => { if (r.status === 200) { setS(r.body); setErr(null); } else setErr(r.body.detail ?? String(r.status)); }, () => setErr('offline')), [caseId]);
  useEffect(() => {
    let alive = true;
    let n = 0;
    // OFF-7: in low-bandwidth mode the status is polled every 32 s instead of every 8 s (there are no websockets)
    const tick = () => { if (!alive) return; if (n++ % (isLowBandwidth() ? 4 : 1) === 0) void load(); };
    tick();
    const t = setInterval(tick, 8000);
    return () => { alive = false; clearInterval(t); };
  }, [load]);
  const voiceFor = (st: Status) => {
    const trust = trustPictureId ? [`trust_${trustPictureId}`] : [];
    if (st.status === 'paid' && st.payment) return [...trust, 'payment_sent', ...amountClips(st.payment.amount), 'receipt_check', 'no_money'];
    if (st.status === 'approved_on_hold' || st.status === 'approved') return [...trust, 'status_approved', ...amountClips(st.payment?.amount ?? 12000), 'no_money'];
    if (st.status === 'rejected') return [...trust, 'status_rejected', 'how_to_appeal'];
    if (st.status === 'needs_proof' && st.proof) return [...trust, `proof_${st.proof.item}`];
    if (st.status === 'paused_for_consent') return [...trust, 'status_paused'];
    if (st.status === 'frozen') return [...trust, 'status_frozen', 'no_money'];
    if (st.status === 'in_review') return [...trust, 'status_in_review', 'no_money'];
    return [...trust, 'status_checking'];
  };
  if (err && !s) return <p role="alert" className="text-destructive">{err === 'offline' ? bi('No internet. Your answers are safe on the phone.', 'انٹرنیٹ نہیں۔ آپ کے جواب فون میں محفوظ ہیں۔') : err}</p>;
  if (!s) return <p className="py-6 text-center text-muted-foreground">{bi('Please wait…', 'براہ کرم انتظار کریں…')}</p>;
  const statusText: Record<string, [string, string]> = {
    draft: ['Not sent yet', 'ابھی نہیں بھیجی'], submitted: ['Reached the office', 'دفتر پہنچ گئی'], processing: ['Being checked', 'جانچ ہو رہی ہے'],
    needs_proof: ['One clear photo needed', 'ایک صاف تصویر چاہیے'], in_review: ['An officer will decide', 'افسر فیصلہ کرے گا'],
    approved_on_hold: ['Approved — money after a short safety wait', 'منظور — تھوڑے انتظار کے بعد رقم'], approved: ['Approved', 'منظور'], rejected: ['Not approved', 'منظور نہیں'],
    paid: ['Money sent', 'رقم بھیج دی گئی'], confirmed: ['Full amount received', 'پوری رقم مل گئی'], disputed: ['Complaint filed', 'شکایت درج'],
    paused_for_consent: ['Paused: you stopped sharing', 'رکی ہوئی: آپ نے اجازت روکی'], frozen: ['On hold while an officer checks', 'افسر کی جانچ تک رکی'], closed: ['Closed', 'بند'],
  };
  return (
    <section className="space-y-4" data-testid="case-status" data-status={s.status}>
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{bi(...(statusText[s.status] ?? [s.status, s.status]))}</h2>
        <Ticks tick={s.ticks} labels={{ saved: bi('Saved on phone', 'فون میں محفوظ'), sent: bi('Reached the office', 'دفتر پہنچ گئی'), opened: bi('Officer opened it', 'افسر نے کھولی'), failed: '' }} />
      </div>
      <Button size="lg" variant="secondary" className="h-14 rounded-full" onClick={() => void playSequence(voiceFor(s))}><Volume2 className="!size-6" /> {bi('Hear the explanation', 'وضاحت سنیں')}</Button>
      {s.pipeline?.step && !['done', 'hold'].includes(s.pipeline.step) && <p className="text-sm text-muted-foreground"><RefreshCw className="me-1 inline size-4 animate-spin" />{bi('Checking', 'جانچ')}: {s.pipeline.steps}/17</p>}
      {!!s.checks.length && (
        <ul className="grid gap-2">
          {s.checks.map((c) => (
            <li key={c.code} className="flex items-center gap-3 rounded-lg border border-border p-2">
              <CheckIcon state={c.state} />
              <span>{CHECK_LABEL[c.code] ? bi(...CHECK_LABEL[c.code]!) : bi('An officer is checking one thing', 'افسر ایک چیز دیکھ رہا ہے')}</span>
            </li>
          ))}
        </ul>
      )}
      {s.proof && (
        <Button size="xl" className="w-full" onClick={() => onProof(s.proof!.item)} data-testid="open-proof">📷 {bi('Send the photo', 'تصویر بھیجیں')} ({s.proof.attemptsLeft})</Button>
      )}
      {s.payment && ['sent', 'confirmed_full', 'disputed'].includes(s.payment.status) && (
        <Button size="xl" className="w-full" onClick={() => onReceipt(s.payment!)} data-testid="open-receipt">💵 Rs {s.payment.amount.toLocaleString('en-US')}</Button>
      )}
      {s.payment?.status === 'scheduled' && s.payment.holdUntil && <p className="rounded-lg bg-muted p-3 text-sm">{bi('Safety wait until', 'حفاظتی انتظار')} {new Date(s.payment.holdUntil).toLocaleTimeString()}</p>}
      <p className="rounded-lg bg-muted p-3 font-medium">{bi('Nobody will ask you for money.', 'کوئی آپ سے پیسے نہیں مانگے گا۔')}</p>
    </section>
  );
}

/** C10: the one item needed, with the camera; the photo goes through the outbox */
export function ProofScreen({ caseId, item, onDone }: { caseId: string; item: string; onDone: () => void }) {
  const bi = useBi();
  const label: Record<string, [string, string]> = { cnic_front: ['Identity card — front', 'شناختی کارڈ — اگلا حصہ'], cnic_back: ['Identity card — back', 'کارڈ — پچھلا حصہ'], death_certificate: ['Death certificate', 'وفات کا سرٹیفکیٹ'] };
  if (item === 'income_declaration') {
    return <IncomeProof caseId={caseId} onDone={onDone} />;
  }
  return (
    <CameraCapture prompt={`proof_${item}`} title={bi(...(label[item] ?? [item, item]))} onAccept={async (c) => {
      await enqueue(outboxDb(), 'case.proof', { item, docType: item, dataBase64: c.base64 }, Date.now(), { caseId, label: bi('Proof photo', 'ثبوت کی تصویر') });
      void syncNow();
      onDone();
    }} />
  );
}

function IncomeProof({ caseId, onDone }: { caseId: string; onDone: () => void }) {
  const bi = useBi();
  const [v, setV] = useState('');
  return (
    <section className="space-y-4">
      <VoicePrompt clip="proof_income_declaration" label={bi('Play again', 'دوبارہ سنیں')} />
      <Keypad value={v} onChange={setV} max={7} />
      <Button size="xl" className="w-full" disabled={!v} onClick={async () => {
        await enqueue(outboxDb(), 'case.proof', { item: 'income_declaration', answer: { question: 'income', value: Number(v), via: 'keypad' } }, Date.now(), { caseId, label: bi('Income', 'آمدنی') });
        void syncNow();
        onDone();
      }}>✓ {bi('OK', 'ٹھیک ہے')}</Button>
    </section>
  );
}

/** C12: the exact amount, a voice note, and "received all" / "received less" */
export function ReceiptScreen({ payment, trustPictureId, onDone }: { payment: { id: string; amount: number; status: string; confirmedAmount: number | null }; trustPictureId?: number | null; onDone: () => void }) {
  const bi = useBi();
  const [less, setLess] = useState(false);
  const [got, setGot] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { void playSequence([...(trustPictureId ? [`trust_${trustPictureId}`] : []), 'payment_sent', ...amountClips(payment.amount), 'receipt_check']); }, [payment.amount, trustPictureId]);
  const send = async (body: unknown) => {
    const r = await api(`/api/v1/payments/${payment.id}/receipt`, { body, idem: true });
    if (r.status === 200) { setMsg(r.body.complaint ? bi(`Complaint filed: Rs ${r.body.complaint.amountMissing} missing.`, `شکایت درج: ${r.body.complaint.amountMissing} روپے کم۔`) : bi('Thank you.', 'شکریہ۔')); void playSequence([r.body.complaint ? 'complaint_received' : 'thanks_receipt']); }
    else setMsg(r.body.detail ?? String(r.status));
  };
  return (
    <section className="space-y-5 text-center" data-testid="receipt">
      <p className="text-muted-foreground">{bi('Money sent to your wallet', 'آپ کے والیٹ میں رقم بھیجی گئی')} <SimulatedBadge what="ledger" /></p>
      <p dir="ltr" className="text-6xl font-black">Rs {payment.amount.toLocaleString('en-US')}</p>
      <Button size="lg" variant="secondary" className="h-14 rounded-full" onClick={() => void playSequence(['payment_sent', ...amountClips(payment.amount)])}><Volume2 className="!size-6" /> {bi('Hear the amount', 'رقم سنیں')}</Button>
      {msg ? <p className="rounded-lg bg-muted p-4 text-lg font-semibold" role="status">{msg}</p> : !less ? (
        <div className="grid grid-cols-2 gap-3">
          <Button size="xl" className="h-24 flex-col" onClick={() => void send({ received: 'all' })} data-testid="received-all"><span className="text-3xl">✅</span>{bi('Received all', 'پوری رقم ملی')}</Button>
          <Button size="xl" variant="destructive" className="h-24 flex-col" onClick={() => { setLess(true); void playSequence(['how_much']); }} data-testid="received-less"><span className="text-3xl">⚠️</span>{bi('Received less', 'کم رقم ملی')}</Button>
        </div>
      ) : (
        <div className="space-y-3 text-start">
          <p className="font-semibold">{bi('How much did you receive?', 'آپ کو کتنی رقم ملی؟')}</p>
          <Keypad value={got} onChange={setGot} max={6} />
          <Button size="xl" className="w-full" disabled={!got} onClick={() => void send({ received: 'less', amountReceived: Number(got) })} data-testid="less-ok">✓ {bi('Report', 'بتائیں')}</Button>
        </div>
      )}
      <Button variant="ghost" onClick={onDone}>← {bi('Back', 'واپس')}</Button>
    </section>
  );
}

type Verdict = { verdict: 'fake' | 'genuine' | 'not_sure'; reasons: { code: string; result: string; en: string; ur: string }[]; action: { en: string; ur: string } };

/** C11 "Is this real?": paste, screenshot or voice; "was this sent to you?"; a verdict card with reasons and one action */
export function RealScreen({ signedIn, initialText = '', initialSender = '' }: { signedIn: boolean; initialText?: string; initialSender?: string }) {
  const bi = useBi();
  const [text, setText] = useState(initialText);
  const [sender, setSender] = useState(initialSender);
  const [image, setImage] = useState<string | null>(null);
  const [mine, setMine] = useState<boolean | null>(null);
  const [district, setDistrict] = useState('');
  const [v, setV] = useState<Verdict | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const check = async () => {
    setBusy(true); setErr(null);
    const r = await api('/api/v1/scam/check', { body: { channel: image ? 'screenshot' : 'text', ...(text ? { text } : {}), ...(sender ? { sender } : {}), ...(image ? { imageBase64: image } : {}), sentToMe: !!mine, ledgerConsent: !!mine && signedIn, ...(district ? { districtCode: district } : {}) } });
    setBusy(false);
    if (r.status === 200) { setV(r.body); void playSequence([r.body.verdict === 'fake' ? 'real_fake' : r.body.verdict === 'genuine' ? 'real_genuine' : 'real_not_sure', ...(r.body.reasons.some((x: { code: string; result: string }) => x.code === 'fee' && x.result === 'contradiction') ? ['real_no_fee'] : []), ...(r.body.reasons.some((x: { code: string; result: string }) => x.code === 'ledger' && x.result === 'contradiction') ? ['real_no_payment'] : [])]); }
    else setErr(r.body.detail ?? String(r.status));
  };
  if (v) {
    const color = v.verdict === 'fake' ? 'border-destructive bg-destructive/10' : v.verdict === 'genuine' ? 'border-success bg-success/10' : 'border-warning bg-warning/20';
    return (
      <section className={`space-y-3 rounded-xl border-4 p-4 ${color}`} data-testid="verdict" data-verdict={v.verdict}>
        <p className="text-3xl font-black">{v.verdict === 'fake' ? bi('FAKE', 'جعلی') : v.verdict === 'genuine' ? bi('Matches your record', 'ریکارڈ سے ملتا ہے') : bi('Not sure', 'یقین نہیں')}</p>
        <p className="text-lg font-semibold">{bi(v.action.en, v.action.ur)}</p>
        <ul className="space-y-1">{v.reasons.map((r) => <li key={r.code} className="flex gap-2"><CheckIcon state={r.result === 'contradiction' ? 'fail' : r.result === 'support' ? 'pass' : 'unclear'} /><span className="self-center">{bi(r.en, r.ur)}</span></li>)}</ul>
        <Button variant="outline" className="w-full" onClick={() => { setV(null); setText(''); setImage(null); setMine(null); }}>{bi('Check another', 'دوسرا پیغام')}</Button>
      </section>
    );
  }
  return (
    <section className="space-y-4" data-testid="real-screen">
      <VoicePrompt clip="real_paste" label={bi('Play again', 'دوبارہ سنیں')} />
      <textarea className="min-h-32 w-full rounded-xl border border-border bg-card p-3 text-lg" placeholder={bi('Paste the message here', 'پیغام یہاں چسپاں کریں')} value={text} onChange={(e) => setText(e.target.value)} data-testid="real-text" />
      <input className="w-full rounded-lg border border-border bg-card p-3" placeholder={bi('Sender (as shown on the phone)', 'بھیجنے والا')} value={sender} onChange={(e) => setSender(e.target.value)} data-testid="real-sender" />
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border p-3">
        🖼️ {image ? bi('Screenshot added', 'اسکرین شاٹ شامل') : bi('Or add a screenshot', 'یا اسکرین شاٹ دیں')}
        <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const b = new Uint8Array(await f.arrayBuffer());
          let s = '';
          for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
          setImage(btoa(s));
        }} />
      </label>
      <p className="font-semibold">{bi('Was this message sent to you?', 'کیا یہ پیغام آپ کو آیا تھا؟')}</p>
      <div className="grid grid-cols-2 gap-3">
        <Button size="xl" variant={mine === true ? 'default' : 'outline'} onClick={() => setMine(true)} data-testid="sent-to-me">✅ {bi('Yes, to me', 'ہاں، مجھے')}</Button>
        <Button size="xl" variant={mine === false ? 'default' : 'outline'} onClick={() => setMine(false)}>👥 {bi('Someone else', 'کسی اور کو')}</Button>
      </div>
      <label className="block text-sm text-muted-foreground">{bi('Where did it arrive? (for the district scam map)', 'یہ کہاں آیا؟ (ضلعی نقشے کے لیے)')}
        <select className="mt-1 block w-full rounded-lg border border-border bg-card p-3 text-base" value={district} onChange={(e) => setDistrict(e.target.value)} data-testid="real-district">
          <option value="">{bi('My district', 'میرا ضلع')}</option>
          {DISTRICT_ICONS.map((d) => <option key={d.code} value={d.code}>{d.icon} {bi(d.en, d.ur)}</option>)}
        </select>
      </label>
      {mine && signedIn && <p className="text-sm text-muted-foreground">{bi('With your permission we check your own payment record for this message.', 'آپ کی اجازت سے ہم اس پیغام کے لیے آپ کا ادائیگی ریکارڈ دیکھیں گے۔')} <SimulatedBadge what="ledger" /></p>}
      {err && <p role="alert" className="text-destructive">{err}</p>}
      <Button size="xl" className="w-full" disabled={busy || (!text && !image) || mine === null} onClick={() => void check()} data-testid="real-check">{busy ? '…' : bi('Check', 'جانچیں')}</Button>
    </section>
  );
}

type Consents = { consents: { id: string; tenantId: string; grantee: { type: string; name?: string; nameUr?: string }; purpose: string; dataCategories: string[]; status: string; expiresAt: string | null }[]; helpers: { name: string | null; expiresAt: string }[]; processors: { id: string; en: string; ur: string; purpose: string; simulated: boolean }[] };

/** C13 My data: who holds it, the access log (heard aloud), stop sharing (voice warning + PIN), corrections */
export function DataScreen({ caseId }: { caseId: string | null }) {
  const bi = useBi();
  const [c, setC] = useState<Consents | null>(null);
  const [log, setLog] = useState<{ ts: string; en: string; ur: string; outcome: string }[]>([]);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    void Promise.all([api('/api/v1/me/consents'), api('/api/v1/me/access-log')]).then(([a, b]) => { if (!alive) return; if (a.status === 200) setC(a.body); if (b.status === 200) setLog(b.body.items); });
    return () => { alive = false; };
  }, [version]);
  const say = (t: string) => { void speakText(t, { lang: 'en' }); };
  return (
    <section className="space-y-5" data-testid="data-screen">
      <div>
        <h3 className="text-lg font-bold">{bi('Who holds your data', 'آپ کی معلومات کس کے پاس ہیں')}</h3>
        <VoicePrompt clip="data_who" label={bi('Play again', 'دوبارہ سنیں')} autoPlay={false} />
        <ul className="mt-2 space-y-2">
          {c?.consents.filter((x) => x.status === 'active').map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-3">
              <span>🏢 {bi(x.grantee.name ?? '', x.grantee.nameUr ?? x.grantee.name ?? '')} <span className="block text-xs text-muted-foreground">{x.dataCategories.join(', ')}</span></span>
              <Button variant="destructive" onClick={() => { setWithdrawing(x.id); void playSequence(['data_stop_warning']); }} data-testid="stop-sharing"><ShieldOff className="!size-5" /> {bi('Stop sharing', 'روکیں')}</Button>
            </li>
          ))}
          {c?.helpers.map((h, i) => <li key={i} className="rounded-lg border border-border p-3">🤝 {h.name}</li>)}
          {c?.processors.map((p) => <li key={p.id} className="rounded-lg border border-border p-3 text-sm">{bi(p.en, p.ur)} {p.simulated && <SimulatedBadge what="mock" />}<span className="block text-xs text-muted-foreground">{p.purpose}</span></li>)}
        </ul>
      </div>
      {withdrawing && (
        <div className="space-y-3 rounded-xl border-4 border-warning p-4" data-testid="withdraw-confirm">
          <p className="font-semibold">{bi('Your application will pause until you share again.', 'جب تک آپ دوبارہ اجازت نہ دیں، درخواست رکی رہے گی۔')}</p>
          <Keypad value={pin} onChange={setPin} max={4} masked />
          <Button size="xl" variant="destructive" className="w-full" disabled={pin.length !== 4} onClick={async () => {
            const r = await api(`/api/v1/me/consents/${withdrawing}/withdraw`, { body: { pin, heardWarning: true } });
            setPin('');
            if (r.status === 200) { setMsg(bi('Sharing stopped. Your application is paused.', 'معلومات دینا بند ہو گیا۔ درخواست رک گئی۔')); setWithdrawing(null); void playSequence(['data_stopped']); setVersion((x) => x + 1); }
            else setMsg(r.body.detail ?? String(r.status));
          }} data-testid="withdraw-pin-ok">{bi('Confirm with PIN', 'پن سے تصدیق')}</Button>
        </div>
      )}
      {msg && <p role="status" className="rounded-lg bg-muted p-3">{msg}</p>}
      {c && !c.consents.some((x) => x.status === 'active') && c.consents[0] && <ReGrant tenantId={c.consents[0].tenantId} onDone={() => setVersion((x) => x + 1)} />}
      <div>
        <h3 className="text-lg font-bold">{bi('Who looked at your data', 'آپ کی معلومات کس نے دیکھیں')}</h3>
        <ul className="mt-2 space-y-2" data-testid="access-log">
          {log.slice(0, 15).map((l, i) => (
            <li key={i} className={`flex items-center justify-between gap-2 rounded-lg border p-2 text-sm ${l.outcome === 'denied' ? 'border-destructive' : 'border-border'}`}>
              <span>{bi(l.en, l.ur)} <span className="block text-xs text-muted-foreground">{new Date(l.ts).toLocaleString()}</span></span>
              <Button size="icon" variant="ghost" aria-label="play" onClick={() => say(l.en)}><Volume2 /></Button>
            </li>
          ))}
        </ul>
      </div>
      {caseId && <Correction caseId={caseId} />}
      {/* CONS-8: her own data as a JSON file */}
      <Button asChild size="lg" variant="outline" className="w-full" data-testid="export-data">
        <a href="/api/v1/me/export" download>{bi('Download my data', 'اپنی معلومات ڈاؤن لوڈ کریں')}</a>
      </Button>
    </section>
  );
}

function ReGrant({ tenantId, onDone }: { tenantId: string; onDone: () => void }) {
  const bi = useBi();
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="space-y-3 rounded-xl border border-border p-4" data-testid="regrant">
      <VoicePrompt clip="consent_notice" label={bi('Play again', 'دوبارہ سنیں')} autoPlay={false} />
      <Keypad value={pin} onChange={setPin} max={4} masked />
      <Button size="xl" className="w-full" disabled={pin.length !== 4} onClick={async () => {
        const r = await api('/api/v1/me/consents', { body: { tenantId, pin } });
        setPin('');
        if (r.status === 201) onDone(); else setMsg(r.body.detail ?? String(r.status));
      }}>{bi('Share again', 'دوبارہ اجازت دیں')}</Button>
      {msg && <p role="alert" className="text-destructive">{msg}</p>}
    </div>
  );
}

function Correction({ caseId }: { caseId: string }) {
  const bi = useBi();
  const [field, setField] = useState<string | null>(null);
  const [v, setV] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const FIELDS: [string, string, string][] = [['household.monthly_income', 'Household income', 'گھر کی آمدنی'], ['applicant.remarried', 'Married again', 'دوبارہ شادی']];
  return (
    <div className="space-y-2">
      <h3 className="text-lg font-bold">{bi('Something wrong?', 'کچھ غلط ہے؟')}</h3>
      <div className="grid grid-cols-2 gap-2">{FIELDS.map(([k, en, ur]) => <Button key={k} variant={field === k ? 'default' : 'outline'} onClick={() => { setField(k); void playSequence(['data_correction']); }}>{bi(en, ur)}</Button>)}</div>
      {field === 'household.monthly_income' && <Keypad value={v} onChange={setV} max={7} />}
      {field === 'applicant.remarried' && <div className="grid grid-cols-2 gap-2"><Button variant={v === 'yes' ? 'default' : 'outline'} onClick={() => setV('yes')}>{bi('Yes', 'ہاں')}</Button><Button variant={v === 'no' ? 'default' : 'outline'} onClick={() => setV('no')}>{bi('No', 'نہیں')}</Button></div>}
      {field && <Button className="w-full" disabled={!v} onClick={async () => {
        const r = await api('/api/v1/me/corrections', { body: { caseId, fieldKey: field, claimedValue: field === 'applicant.remarried' ? v === 'yes' : Number(v) }, idem: true });
        setMsg(r.status === 201 ? bi('Sent to an officer. The old value is kept in history.', 'افسر کو بھیج دیا گیا۔ پرانی معلومات محفوظ رہیں گی۔') : r.body.detail);
        setField(null); setV('');
      }}>{bi('Send to an officer', 'افسر کو بھیجیں')}</Button>}
      {msg && <p role="status" className="text-sm">{msg}</p>}
    </div>
  );
}

/** Help: a spoken or typed question → policy answer with clause citations, or "a person will call you" */
export function HelpScreen() {
  const bi = useBi();
  const [q, setQ] = useState('');
  const [a, setA] = useState<{ answer_ur: string; answer_en: string; citations: { clause_id: string; quote: string }[]; refused: boolean } | null>(null);
  return (
    <section className="space-y-4" data-testid="help-screen">
      <VoicePrompt clip="help_ask" label={bi('Play again', 'دوبارہ سنیں')} />
      <textarea className="min-h-24 w-full rounded-xl border border-border bg-card p-3 text-lg" value={q} onChange={(e) => setQ(e.target.value)} placeholder={bi('Am I eligible if my husband died abroad?', 'اگر شوہر بیرون ملک فوت ہوئے تو کیا میں اہل ہوں؟')} />
      <Button size="xl" className="w-full" disabled={q.length < 5} onClick={async () => {
        const r = await api('/api/v1/assist/policy', { body: { question: q } });
        if (r.status === 200) { setA(r.body); if (r.body.refused) void playSequence(['help_not_sure']); else void speakText(r.body.answer_ur); }
      }}><Mic className="!size-6" /> {bi('Ask', 'پوچھیں')}</Button>
      {a && (
        <div className="space-y-2 rounded-xl border border-border p-4" data-testid="policy-answer">
          <div className="flex items-start gap-2">
            <p className="flex-1 text-lg font-semibold">{bi(a.answer_en, a.answer_ur)}</p>
            {!a.refused && <Button size="icon" variant="ghost" aria-label={bi('Play again', 'دوبارہ سنیں')} onClick={() => void speakText(a.answer_ur)}><Volume2 /></Button>}
          </div>
          {a.citations.map((c) => <p key={c.clause_id} className="text-sm text-muted-foreground">§ {c.clause_id}: “{c.quote}”</p>)}
        </div>
      )}
    </section>
  );
}
