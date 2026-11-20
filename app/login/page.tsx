import { getTranslations } from 'next-intl/server';
import { LoginForm } from '@/components/staff/login-form';
import { isDemoMode } from '@/lib/env';
import { DEMO_STAFF } from '@/services/seed/demo-accounts';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; role?: string }> }) {
  const t = await getTranslations('login');
  const sp = await searchParams;
  return (
    <main className="mx-auto max-w-md space-y-6 px-4 py-10">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <LoginForm
        demo={isDemoMode()}
        next={sp.next?.startsWith('/') ? sp.next : undefined}
        accounts={DEMO_STAFF.map((s) => ({ email: s.email, role: s.role, tenant: s.tenant }))}
        labels={{ email: t('email'), password: t('password'), submit: t('submit'), demo: t('demo'), demoHint: t('demoHint') }}
      />
    </main>
  );
}
