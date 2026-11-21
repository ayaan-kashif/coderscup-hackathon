'use client';
import { motion } from 'motion/react';

/**
 * One step of a guided flow: slim progress bar, a violet title card (with the voice-prompt slot),
 * then the answer area on a bento surface. Re-mounted per step (key it), so each step eases in.
 */
export function StepFrame({ title, voice, step, total, onBack, backLabel, children, ...rest }: {
  title: React.ReactNode; voice?: React.ReactNode; step?: number; total?: number; onBack?: () => void; backLabel?: string; children: React.ReactNode;
} & Omit<React.ComponentProps<'section'>, 'title' | 'children'>) {
  return (
    <motion.section className="space-y-3" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }} {...(rest as object)}>
      {step !== undefined && total !== undefined && (
        <div className="flex items-center gap-3">
          <span dir="ltr" className="micro-label w-12 shrink-0 text-label">{step} / {total}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-pill" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={step}>
            <motion.div className="h-full rounded-full bg-mint" initial={{ width: `${((step - 1) / total) * 100}%` }} animate={{ width: `${(step / total) * 100}%` }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
          </div>
          {onBack && <button type="button" className="shrink-0 rounded-full bg-pill px-3 py-1 text-xs font-semibold text-white/80 transition-colors hover:text-mint" onClick={onBack}>← {backLabel}</button>}
        </div>
      )}
      <div className="canvas-violet iso-grid space-y-4 overflow-hidden rounded-[24px] p-5">
        <h2 className="display-lg !text-[clamp(1.4rem,5.5vw,1.9rem)]">{title}</h2>
        {voice}
      </div>
      <div className="space-y-5 rounded-[24px] border border-white/[0.08] bg-bento p-4">{children}</div>
    </motion.section>
  );
}
