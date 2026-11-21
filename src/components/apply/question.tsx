'use client';
import { useState } from 'react';
import { StepFrame } from '@/components/brand/step-frame';
import { Button } from '@/components/ui/button';
import { Keypad } from '@/components/voice/keypad';
import { VoicePrompt, playSequence } from '@/components/voice/voice-prompt';
import { useBi } from '@/components/voice/voice-lib';
import { VoiceAnswer } from './voice-answer';

export type QuestionKey = 'name' | 'husband_name' | 'cnic' | 'district' | 'husband_died' | 'remarried' | 'income' | 'wallet';
export type AnswerValue = { question: QuestionKey; value: string | number | boolean; via: 'voice' | 'icon' | 'keypad'; voiceInputId?: string; display: string };

/** one question per screen (CIT-2); every answer by voice, icon or keypad — never free typing (CIT-3) */
export const QUESTION_DEFS: { key: QuestionKey; prompt: string; en: string; ur: string; kind: 'text' | 'cnic' | 'district' | 'yesno' | 'number' | 'wallet'; optional?: boolean }[] = [
  { key: 'name', prompt: 'q_name', en: 'Your full name', ur: 'آپ کا پورا نام', kind: 'text' },
  { key: 'husband_name', prompt: 'q_husband_name', en: "Your husband's full name", ur: 'شوہر کا پورا نام', kind: 'text' },
  { key: 'cnic', prompt: 'q_cnic', en: 'Your identity card number', ur: 'شناختی کارڈ نمبر', kind: 'cnic', optional: true },
  { key: 'district', prompt: 'q_district', en: 'Your district', ur: 'آپ کا ضلع', kind: 'district' },
  { key: 'husband_died', prompt: 'q_husband_died', en: 'Has your husband passed away?', ur: 'کیا شوہر وفات پا چکے ہیں؟', kind: 'yesno' },
  { key: 'remarried', prompt: 'q_remarried', en: 'Have you married again?', ur: 'کیا دوبارہ شادی کی؟', kind: 'yesno' },
  { key: 'income', prompt: 'q_income', en: 'Household income per month (Rs)', ur: 'گھر کی ماہانہ آمدنی (روپے)', kind: 'number' },
  { key: 'wallet', prompt: 'q_wallet', en: 'Wallet number for the money', ur: 'رقم کے لیے والیٹ نمبر', kind: 'wallet', optional: true },
];

export const DISTRICT_ICONS: { code: string; en: string; ur: string; icon: string }[] = [
  { code: 'BDN', en: 'Badin', ur: 'بدین', icon: '🌾' }, { code: 'TTA', en: 'Thatta', ur: 'ٹھٹھہ', icon: '⛵' }, { code: 'HYD', en: 'Hyderabad', ur: 'حیدرآباد', icon: '🏙️' },
  { code: 'KHS', en: 'Khairpur', ur: 'خیرپور', icon: '🌴' }, { code: 'SKR', en: 'Sukkur', ur: 'سکھر', icon: '🌉' }, { code: 'THP', en: 'Tharparkar', ur: 'تھرپارکر', icon: '🐪' },
  { code: 'LHR', en: 'Lahore', ur: 'لاہور', icon: '🕌' }, { code: 'MUL', en: 'Multan', ur: 'ملتان', icon: '🥭' }, { code: 'BWP', en: 'Bahawalpur', ur: 'بہاولپور', icon: '🏜️' },
  { code: 'RJP', en: 'Rajanpur', ur: 'راجن پور', icon: '⛰️' }, { code: 'FSD', en: 'Faisalabad', ur: 'فیصل آباد', icon: '🧵' },
];

export function QuestionScreen({ q, caseId, initial, onAnswer, onBack, step, total }: {
  q: (typeof QUESTION_DEFS)[number]; caseId: string | null; initial?: AnswerValue; step: number; total: number;
  onAnswer: (a: AnswerValue | null) => void; onBack: () => void;
}) {
  const bi = useBi();
  const [digits, setDigits] = useState(initial && typeof initial.value !== 'boolean' && q.kind !== 'text' ? String(initial.value).replace(/\D/g, '') : '');
  const [iconsOnly, setIconsOnly] = useState(false);
  const yes = (v: boolean) => { void playSequence([v ? 'yes' : 'no']); onAnswer({ question: q.key, value: v, via: 'icon', display: v ? bi('Yes', 'ہاں') : bi('No', 'نہیں') }); };
  return (
    <StepFrame data-testid={`question-${q.key}`} title={bi(q.en, q.ur)} voice={<VoicePrompt clip={q.prompt} label={bi('Play again', 'دوبارہ سنیں')} />} step={step} total={total} onBack={onBack} backLabel={bi('Back', 'واپس')}>
      {q.kind === 'text' && !iconsOnly && (
        <VoiceAnswer caseId={caseId} questionKey={q.key} onGiveUp={() => setIconsOnly(true)}
          onConfirmed={(h) => onAnswer({ question: q.key, value: h.transcript, via: 'voice', voiceInputId: h.voiceInputId, display: h.transcript })} />
      )}
      {q.kind === 'text' && iconsOnly && (
        <div className="space-y-3 rounded-[20px] border border-white/10 bg-pill/40 p-4">
          <p>{bi('No problem. The name on your identity card will be used.', 'کوئی بات نہیں۔ شناختی کارڈ والا نام لیا جائے گا۔')}</p>
          <Button size="xl" className="w-full" onClick={() => onAnswer(null)}>🪪 {bi('Use the name on my card', 'کارڈ والا نام لیں')}</Button>
        </div>
      )}

      {q.kind === 'yesno' && (
        <div className="grid grid-cols-2 gap-4">
          <Button size="xl" className="h-28 flex-col gap-1 text-2xl" onClick={() => yes(true)} data-testid="answer-yes"><span className="text-4xl">✅</span>{bi('Yes', 'ہاں')}</Button>
          <Button size="xl" variant="outline" className="h-28 flex-col gap-1 text-2xl" onClick={() => yes(false)} data-testid="answer-no"><span className="text-4xl">❌</span>{bi('No', 'نہیں')}</Button>
        </div>
      )}

      {q.kind === 'district' && (
        <div className="grid grid-cols-3 gap-3">
          {DISTRICT_ICONS.map((d) => (
            <Button key={d.code} size="xl" variant={initial?.value === d.code ? 'default' : 'outline'} className="h-24 flex-col gap-1 text-base" data-testid={`district-${d.code}`}
              onClick={() => onAnswer({ question: q.key, value: d.code, via: 'icon', display: bi(d.en, d.ur) })}>
              <span className="text-3xl">{d.icon}</span>{bi(d.en, d.ur)}
            </Button>
          ))}
        </div>
      )}

      {(q.kind === 'number' || q.kind === 'cnic' || q.kind === 'wallet') && (
        <div className="space-y-4">
          {q.kind === 'wallet' && <p dir="ltr" className="text-center font-mono text-muted-foreground">PK00MOCK ••••••••••</p>}
          <Keypad value={digits} onChange={setDigits} max={q.kind === 'cnic' ? 13 : q.kind === 'wallet' ? 10 : 7} />
          <Button size="xl" className="w-full" data-testid="keypad-ok"
            disabled={q.kind === 'cnic' ? digits.length !== 13 : q.kind === 'wallet' ? digits.length !== 10 : digits.length === 0}
            onClick={() => onAnswer({ question: q.key, value: q.kind === 'number' ? Number(digits) : digits, via: 'keypad', display: q.kind === 'number' ? `Rs ${Number(digits).toLocaleString('en-US')}` : q.kind === 'wallet' ? `…${digits.slice(-4)}` : `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}` })}>
            ✓ {bi('OK', 'ٹھیک ہے')}
          </Button>
        </div>
      )}
      {q.optional && <Button variant="ghost" className="w-full" onClick={() => onAnswer(null)}>{bi('Skip — I will show the card', 'چھوڑیں — کارڈ دکھاؤں گی')}</Button>}
    </StepFrame>
  );
}
