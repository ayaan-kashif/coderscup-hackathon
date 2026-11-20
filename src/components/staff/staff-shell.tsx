import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { Actor } from '@/auth/actor';
import { getDb } from '@/db/client';
import { tenants, users } from '@/db/schema/all';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from './sign-out';

export async function StaffShell({ actor, title, children }: { actor: Actor; title: string; children: React.ReactNode }) {
  const t = await getTranslations('staff');
  const db = getDb();
  const [u] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, actor.id));
  const [tenant] = actor.tenantId ? await db.select({ name: tenants.name, sandbox: tenants.isSandbox }).from(tenants).where(eq(tenants.id, actor.tenantId)) : [];
  return (
    <div className="min-h-dvh">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/" className="font-bold">AMANAT AI</Link>
          <span className="text-muted-foreground">/</span>
          <span className="font-medium">{title}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>{u?.name}</span>
          <Badge variant="secondary">{t('role')}: {actor.role}{actor.isSenior ? ' (senior)' : ''}</Badge>
          {tenant && <Badge variant={tenant.sandbox ? 'warning' : 'outline'}>{t('tenant')}: {tenant.name}</Badge>}
          <SignOutButton />
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">{children}</main>
    </div>
  );
}
