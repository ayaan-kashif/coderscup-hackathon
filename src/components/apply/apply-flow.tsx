'use client';
import { StepFrame } from '@/components/brand/step-frame';
import { useLiveQuery } from 'dexie-react-hooks';
import { Send } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Ticks } from '@/components/citizen/ticks';
import { Button } from '@/components/ui/button';
import { VoicePrompt, playSequence } from '@/components/voice/voice-prompt';
import { useBi } from '@/components/voice/voice-lib';
import { enqueue, outboxDb, type OutboxEntry } from '@/offline/outbox';
import { syncOnce } from '@/offline/sync';
import { CameraCapture, type Captured } from './camera';
import { QUESTION_DEFS, QuestionScreen, type AnswerValue } from './question';

const PHOTOS = [
  { docType: 'cnic_front', prompt: 'photo_cnic_front', en: 'Identity card — front', ur: 'شناختی کارڈ — اگلا حصہ' },
  { docType: 'cnic_back', prompt: 'photo_cnic_back', en: 'Identity card — back', ur: 'شناختی کارڈ — پچھلا حصہ' },
  { docType: 'death_certificate', prompt: 'photo_death_certificate', en: 'Death certificate', ur: 'وفات کا سرٹیفکیٹ' },
] as const;

const deps = () => ({ fetch: window.fetch.bind(window), now: Date.now, random: Math.random });
export const syncNow = () => (navigator.onLine ? syncOnce(outboxDb(), deps()) : Promise.resolve(null));

/**
 * C6 → C7 → C8: one question per screen, then the photos, then a review read aloud, then submit.
 * Every answer and photo goes to the IndexedDB outbox FIRST (one grey tick), then syncs (OFF-2).
 * A case created offline is referenced by its outbox entry until the server id is known.
 */
export function ApplyFlow({ mode, citizenId, existingCaseId, onSubmitted, banner }: {
  mode: 'citizen' | 'helper'; citizenId?: string; existingCaseId?: string | null; onSubmitted: (ref: { caseId: string | null; createRef: string | null }) => void; banner?: React.ReactNode;
}) {
  const bi = useBi();
  const storeKey = `amanat_draft_${mode}_${citizenId ?? 'me'}`;
  const [createRef, setCreateRef] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [photos, setPhotos] = useState<Record<string, Captured>>({});
  const createEntry = useLiveQuery(() => (createRef ? outboxDb().outbox.get(createRef) : undefined), [createRef]);
  const caseId = existingCaseId ?? (createEntry?.serverId || null);

  // resume a draft started on this phone (battery died mid-way: the outbox survives)
  useEffect(() => {
    if (existingCaseId) return;
    let alive = true;
    (async () => {
      let ref: string | null = null;
      try { ref = localStorage.getItem(storeKey); } catch { /* private mode */ }
      const found = ref ? await outboxDb().outbox.get(ref) : undefined;
      if (found) { if (alive) setCreateRef(found.id); return; }
      const e = await enqueue(outboxDb(), 'case.create', { programCode: 'SAAYA-WS', channel: mode, ...(citizenId ? { citizenId } : {}) }, Date.now(), { label: bi('Application', 'درخواست') });
      try { localStorage.setItem(storeKey, e.id); } catch { /* ignore */ }
      if (alive) setCreateRef(e.id);
      void syncNow();
    })();
    return () => { alive = false; };
  }, [existingCaseId, storeKey, mode, citizenId, bi]);

  const link = useMemo(() => (existingCaseId ? { caseId: existingCaseId } : createRef ? { caseRef: createRef } : null), [existingCaseId, createRef]);
  const total = QUESTION_DEFS.length + PHOTOS.length + 1;

  const save = async (a: AnswerValue | null) => {
    if (a && link) {
      setAnswers((s) => ({ ...s, [a.question]: a }));
      await enqueue(outboxDb(), 'case.answers', { answers: [{ question: a.question, value: a.value, via: a.via, ...(a.voiceInputId ? { voiceInputId: a.voiceInputId } : {}) }] }, Date.now(), { ...link, label: bi(QUESTION_DEFS.find((q) => q.key === a.question)!.en, QUESTION_DEFS.find((q) => q.key === a.question)!.ur) });
      void playSequence(['saved_on_phone']);
      void syncNow();
    }
    setStep((s) => s + 1);
  };

  const savePhoto = async (docType: string, c: Captured, label: string) => {
    if (!link) return;
    setPhotos((s) => ({ ...s, [docType]: c }));
    // the key is the photo's content: a resend after a dropped signal is the same document (OFF-4)
    await enqueue(outboxDb(), 'case.document', { docType, dataBase64: c.base64 }, Date.now(), { ...link, label });
    void syncNow();
    setStep((s) => s + 1);
  };

  if (!link) return <p className="p-6 text-center">…</p>;
  const qi = step;
  const pi = step - QUESTION_DEFS.length;
  return (
    <div className="space-y-4">
      {banner}
      {qi < QUESTION_DEFS.length && (
        <QuestionScreen key={QUESTION_DEFS[qi]!.key} q={QUESTION_DEFS[qi]!} caseId={caseId} initial={answers[QUESTION_DEFS[qi]!.key]} step={step + 1} total={total}
          onAnswer={(a) => void save(a)} onBack={() => setStep((s) => Math.max(0, s - 1))} />
      )}
      {pi >= 0 && pi < PHOTOS.length && (
        <CameraCapture key={PHOTOS[pi]!.docType} prompt={PHOTOS[pi]!.prompt} title={`${step + 1} / ${total} · ${bi(PHOTOS[pi]!.en, PHOTOS[pi]!.ur)}`}
          onAccept={(c) => void savePhoto(PHOTOS[pi]!.docType, c, bi(PHOTOS[pi]!.en, PHOTOS[pi]!.ur))} />
      )}
      {pi === PHOTOS.length && (
        <StepFrame data-testid="review" title={bi('Check and send', 'دیکھیں اور بھیجیں')} voice={<VoicePrompt clip="review" label={bi('Play again', 'دوبارہ سنیں')} />}>
          <ul className="divide-y divide-white/10 overflow-hidden rounded-[20px] border border-white/10 bg-void/40">
            {QUESTION_DEFS.map((q) => (
              <li key={q.key} className="flex items-center justify-between gap-2 p-3">
                <span className="text-muted-foreground">{bi(q.en, q.ur)}</span>
                <span className="font-semibold">{answers[q.key]?.display ?? '—'}</span>
              </li>
            ))}
            {PHOTOS.map((p) => (
              <li key={p.docType} className="flex items-center justify-between gap-2 p-3">
                <span className="text-muted-foreground">{bi(p.en, p.ur)}</span>
                <span>{photos[p.docType] ? '📷 ✓' : '—'}</span>
              </li>
            ))}
          </ul>
          <Button size="xl" className="w-full" data-testid="submit" onClick={async () => {
            await enqueue(outboxDb(), 'case.submit', {}, Date.now(), { ...link, label: bi('Submit', 'بھیجیں') });
            try { localStorage.removeItem(storeKey); } catch { /* ignore */ }
            void playSequence(['submitted']);
            void syncNow();
            onSubmitted({ caseId, createRef });
          }}><Send className="!size-6" /> {bi('Send application', 'درخواست بھیجیں')}</Button>
          <button type="button" className="w-full text-center text-sm font-semibold text-white/70 underline underline-offset-4 transition-colors hover:text-mint" onClick={() => setStep(0)}>{bi('Change an answer', 'جواب بدلیں')}</button>
        </StepFrame>
      )}
    </div>
  );
}

/** the outbox for this phone with ticks (OFF-5) */
export function OutboxList({ title }: { title: string }) {
  const bi = useBi();
  const entries = useLiveQuery(() => outboxDb().outbox.orderBy('createdAt').reverse().limit(12).toArray(), []);
  if (!entries?.length) return null;
  return (
    <section className="rounded-[24px] border border-white/[0.08] bg-bento p-5" data-testid="outbox">
      <h3 className="micro-label mb-3 text-label">{title}</h3>
      <ul className="space-y-2">
        {entries.map((e: OutboxEntry) => (
          <li key={e.id} className="flex items-center justify-between gap-2 border-b border-border pb-2 last:border-0" data-entry-type={e.type}>
            <span className="truncate text-sm">{e.label ?? e.type}</span>
            <Ticks tick={e.tick} labels={{ saved: bi('Saved on phone', 'فون میں محفوظ'), sent: bi('Reached the office', 'دفتر پہنچ گئی'), opened: bi('Officer opened it', 'افسر نے کھولی'), failed: bi('Try again', 'دوبارہ کریں') }} />
          </li>
        ))}
      </ul>
    </section>
  );
}
