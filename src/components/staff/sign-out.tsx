'use client';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export function SignOutButton() {
  const t = useTranslations('shell');
  const router = useRouter();
  return (
    <Button size="sm" variant="ghost" onClick={async () => { await fetch('/api/v1/auth/logout', { method: 'POST' }); router.push('/'); router.refresh(); }}>
      {t('signOut')}
    </Button>
  );
}
