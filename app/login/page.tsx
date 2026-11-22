import { PageFrame } from '@/components/shell/page-frame';
import { getTranslations } from 'next-intl/server';
import { LoginForm } from '@/components/staff/login-form';
import { demoAccessCode, demoSignInAvailable } from '@/lib/env';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; role?: string }> }) {
  const t = await getTranslations('login');
  const sp = await searchParams;
  return (
    <PageFrame title={t('title')} width="max-w-xl">
      <LoginForm
        demo={demoSignInAvailable()}
        needsCode={!!demoAccessCode()}
        next={sp.next?.startsWith('/') ? sp.next : undefined}
        labels={{ email: t('email'), password: t('password'), submit: t('submit'), demo: t('demo'), demoHint: t('demoHint') }}
      />
    </PageFrame>
  );
}
