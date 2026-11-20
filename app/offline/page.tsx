import { useTranslations } from 'next-intl';
import { VoicePrompt } from '@/components/voice/voice-prompt';


export default function OfflinePage() {
  const t = useTranslations();
  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-6 px-4 py-12 text-center">
      <p className="text-xl font-semibold">{t('shell.offline')}</p>
      <VoicePrompt clip="offline" label={t('citizen.playPrompt')} />
      <a className="underline" href="/c">AMANAT</a>
    </main>
  );
}
