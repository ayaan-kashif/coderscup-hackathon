import { getTranslations } from 'next-intl/server';
import { LanguageToggle } from './language-toggle';

/** Shown on every screen (root layout). Not dismissible. */
export async function PrototypeBanner() {
  const t = await getTranslations('shell');
  return (
    <div role="note" aria-label="prototype notice" className="sticky top-0 z-50 flex items-center justify-between gap-3 bg-warning px-4 py-1.5 text-xs font-medium text-warning-foreground sm:text-sm" data-testid="prototype-banner">
      <span>⚠ {t('banner')}</span>
      <LanguageToggle label={t('language')} />
    </div>
  );
}
