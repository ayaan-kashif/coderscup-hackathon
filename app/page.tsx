import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { SimulatedBadge } from '@/components/shell/simulated-badge';

export default function Home() {
  const t = useTranslations('home');
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
        <SimulatedBadge what="Saaya Relief Programme" />
      </header>
      <nav className="grid gap-3">
        <Button asChild size="xl"><Link href="/c">{t('citizen')}</Link></Button>
        <Button asChild size="lg" variant="secondary"><Link href="/login?role=helper">{t('helper')}</Link></Button>
        <Button asChild size="lg" variant="outline"><Link href="/login">{t('staff')}</Link></Button>
        <div className="flex flex-wrap gap-2 pt-2 text-sm">
          <Link className="underline" href="/mock/phone">{t('mockPhone')}</Link>
          <Link className="underline" href="/status">{t('status')}</Link>
          <a className="underline" href="/api/docs">{t('docs')}</a>
        </div>
      </nav>
    </main>
  );
}
