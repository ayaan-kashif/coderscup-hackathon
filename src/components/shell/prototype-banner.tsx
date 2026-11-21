import { getTranslations } from 'next-intl/server';
import { LanguageToggle } from './language-toggle';

/** The notice bar is gone; only the English/Urdu switch remains, as a small floating button. */
export async function PrototypeBanner() {
  const t = await getTranslations('shell');
  return (
    <div className="fixed bottom-4 end-4 z-50 text-sm" data-testid="language-switch">
      <LanguageToggle label={t('language')} />
    </div>
  );
}
