import { PageFrame } from '@/components/shell/page-frame';
import { getTranslations } from 'next-intl/server';
import { LoginForm } from '@/components/staff/login-form';
import { isDemoMode } from '@/lib/env';
import { DEMO_STAFF } from '@/services/seed/demo-accounts';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; role?: string }> }) {
  const t = await getTranslations('login');
  const sp = await searchParams;
  return (
    <PageFrame title={t('title')} width="max-w-xl">
      <LoginForm
        demo={isDemoMode()}
        next={sp.next?.startsWith('/') ? sp.next : undefined}
        accounts={DEMO_STAFF.map((s) => ({ email: s.email, role: s.role, tenant: s.tenant }))}
        labels={{ email: t('email'), password: t('password'), submit: t('submit'), demo: t('demo'), demoHint: t('demoHint') }}
      />
    </PageFrame>
  );
}
