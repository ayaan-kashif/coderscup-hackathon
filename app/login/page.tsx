import Link from 'next/link';
import { Store } from 'lucide-react';
import { PageFrame } from '@/components/shell/page-frame';
import { getTranslations } from 'next-intl/server';
import { LoginForm } from '@/components/staff/login-form';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; role?: string }> }) {
  const t = await getTranslations('login');
  const sp = await searchParams;
  return (
    <PageFrame title={t('title')} width="max-w-xl">
      <LoginForm
        next={sp.next?.startsWith('/') ? sp.next : undefined}
        labels={{ email: t('email'), password: t('password'), submit: t('submit') }}
      />
      <Link href="/login/shopkeeper" className="group mt-6 flex items-center gap-4 rounded-[24px] border border-white/[0.08] bg-bento p-5 transition-[border-color,transform] duration-300 hover:-translate-y-0.5 hover:border-mint/40" data-testid="portal-shopkeeper">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-pill text-mint"><Store className="size-5" /></span>
        <span className="space-y-1"><span className="block text-lg font-bold">{t('shopTitle')}</span><span className="block text-sm text-white/60">{t('shopBody')}</span></span>
      </Link>
    </PageFrame>
  );
}
