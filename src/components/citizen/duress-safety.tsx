'use client';
import { ArrowLeftRight, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Keypad } from '@/components/voice/keypad';
import { VoicePrompt, playSequence } from '@/components/voice/voice-prompt';
import { useBi } from '@/components/voice/voice-lib';
import { api } from './screens';

const TIP_EN = 'Safety Trick: If anyone forces you to enter your PIN, type it backwards (e.g., 4321 instead of 1234). The screen will look normal, your money will stay frozen, and an officer will be silently alerted.';
const TIP_UR = 'حفاظتی طریقہ: اگر کوئی زبردستی آپ سے پن ڈلوائے تو اپنا پن الٹا لکھیں (مثلاً 1234 کی جگہ 4321)۔ اسکرین عام دکھائی دے گی، آپ کے پیسے محفوظ رہیں گے اور افسر کو خفیہ اطلاع مل جائے گی۔';

/**
 * Low-literacy safety education for the Silent Duress PIN: three pictures (your PIN → backwards → protected),
 * the instruction in both languages and a play button that reads it in Urdu.
 */
export function DuressSafetyCard({ compact = false }: { compact?: boolean }) {
  const bi = useBi();
  return (
    <section className="space-y-3 rounded-[20px] border border-mint/30 bg-mint/[0.06] p-4" data-testid="duress-safety-card" aria-label={bi('Safety trick', 'حفاظتی طریقہ')}>
      <div dir="ltr" className="flex items-center justify-center gap-2 font-mono text-lg font-bold" aria-hidden>
        <span className="rounded-xl bg-void px-3 py-1.5 tracking-[0.3em]">1234</span>
        <ArrowLeftRight className="size-5 text-mint" />
        <span className="rounded-xl bg-mint px-3 py-1.5 tracking-[0.3em] text-void">4321</span>
        <ShieldCheck className="size-6 text-mint" />
      </div>
      <p className="text-sm leading-relaxed">{bi(TIP_EN, TIP_UR)}</p>
      {!compact && <p className="text-xs leading-relaxed text-white/60" lang={bi('ur', 'en')}>{bi(TIP_UR, TIP_EN)}</p>}
      <VoicePrompt clip="duress_tip" label={bi('Hear the safety trick', 'حفاظتی طریقہ سنیں')} autoPlay={false} />
    </section>
  );
}

/**
 * Change the payout number: new wallet (10 digits) → PIN → "Request received — verification in progress".
 * The confirmation is the same whether the real PIN or the reversed (duress) PIN was used: the server answers
 * both identically, so nothing on this screen can tip off someone watching.
 */
export function PayoutChangeFlow({ onDone }: { onDone: () => void }) {
  const bi = useBi();
  const [step, setStep] = useState<'wallet' | 'pin' | 'done'>('wallet');
  const [wallet, setWallet] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [last4, setLast4] = useState('');

  if (step === 'done') {
    return (
      <motion.section initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="space-y-4 rounded-[24px] border border-mint/40 bg-mint/10 p-6 text-center" data-testid="payout-request-received" role="status">
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 16, delay: 0.1 }} className="mx-auto flex size-16 items-center justify-center rounded-full bg-mint text-3xl text-void" aria-hidden>✓</motion.div>
        <h3 className="display text-2xl font-extrabold">{bi('Request Received — Verification in Progress', 'درخواست مل گئی — تصدیق جاری ہے')}</h3>
        <p className="text-white/80">{bi(`Your new payout number ending ${last4} will be checked by an officer. Nobody will ask you for money.`, `آپ کا نیا نمبر (آخری ہندسے ${last4}) ایک افسر جانچے گا۔ کوئی آپ سے پیسے نہیں مانگے گا۔`)}</p>
        <Button size="lg" variant="secondary" className="rounded-full" onClick={onDone}>{bi('Done', 'ٹھیک ہے')}</Button>
      </motion.section>
    );
  }

  return (
    <section className="space-y-4" data-testid="payout-change">
      {step === 'wallet' ? (
        <>
          <p className="font-semibold">{bi('New wallet number (10 digits)', 'نیا والیٹ نمبر (10 ہندسے)')}</p>
          <VoicePrompt clip="ask_wallet" label={bi('Play again', 'دوبارہ سنیں')} />
          <Keypad value={wallet} onChange={setWallet} max={10} />
          <Button size="xl" className="w-full" disabled={wallet.length !== 10} onClick={() => { setErr(null); setStep('pin'); void playSequence(['ask_pin']); }} data-testid="payout-wallet-ok">✓ {bi('Next', 'آگے')}</Button>
        </>
      ) : (
        <>
          <p className="font-semibold">{bi('Enter your 4-digit PIN to confirm', 'تصدیق کے لیے اپنا 4 ہندسوں کا پن لکھیں')}</p>
          <Keypad value={pin} onChange={setPin} max={4} masked />
          {err && <p role="alert" className="text-center text-destructive">{err}</p>}
          <Button size="xl" className="w-full" disabled={pin.length !== 4 || busy} data-testid="payout-pin-ok" onClick={async () => {
            setBusy(true);
            const r = await api('/api/v1/payout-changes', { body: { walletDigits: wallet, pin }, idem: true });
            setBusy(false);
            setPin('');
            if (r.status === 201) { setLast4(r.body.newLast4); setStep('done'); void playSequence(['request_received']); return; }
            setErr(r.body.detail ?? bi('Something went wrong. Try again.', 'کچھ غلط ہو گیا۔ دوبارہ کوشش کریں۔'));
          }}>✓ {bi('Confirm', 'تصدیق کریں')}</Button>
          <button type="button" className="w-full text-center text-sm text-white/60 underline" onClick={() => setStep('wallet')}>← {bi('Back', 'واپس')}</button>
        </>
      )}
    </section>
  );
}
