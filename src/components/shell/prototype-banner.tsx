import { getTranslations } from 'next-intl/server';
import { LanguageToggle } from './language-toggle';

/** Shown on every screen (root layout). Not dismissible. */
export async function PrototypeBanner() {
  const t = await getTranslations('shell');
  return (
    <div role="note" aria-label="prototype notice" className="relative z-50 flex items-center justify-between gap-3 border-b border-white/10 bg-elevated px-4 py-2 text-xs font-medium text-white/80 sm:px-6 sm:text-[13px]" data-testid="prototype-banner">
      <span className="flex items-center gap-2.5"><span className="relative flex size-2 shrink-0"><span className="absolute inset-0 animate-pulse-ring rounded-full bg-warning" /><span className="relative size-2 rounded-full bg-warning" /></span><span>{t('banner')}</span></span>
      <LanguageToggle label={t('language')} />
    </div>
  );
}
