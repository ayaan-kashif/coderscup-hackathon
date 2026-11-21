import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { Actor } from '@/auth/actor';
import { getDb } from '@/db/client';
import { tenants, users } from '@/db/schema/all';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from './sign-out';

export type NavItem = { href: string; label: string };

export const OFFICER_NAV: NavItem[] = [
  { href: '/o', label: 'Queue' }, { href: '/o/payouts', label: 'Payout changes' }, { href: '/o/scams', label: 'Scam desk' }, { href: '/o/complaints', label: 'Complaints & corrections' },
];

export const ADMIN_NAV: NavItem[] = [
  { href: '/a', label: 'Rules & Twin' }, { href: '/a/evaluation', label: 'Cost & evaluation' }, { href: '/a/break-it', label: 'Break It' }, { href: '/a/chaos', label: 'Chaos & config' }, { href: '/a/org', label: 'Organisation' },
];

export const AUDITOR_NAV: NavItem[] = [
  { href: '/au', label: 'Decisions' }, { href: '/au/chain', label: 'Chain integrity' }, { href: '/au/access', label: 'Consent & access' },
];

export async function StaffShell({ actor, title, children, nav }: { actor: Actor; title: string; children: React.ReactNode; nav?: NavItem[] }) {
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
      {nav && (
        <nav className="flex gap-1 overflow-x-auto border-b border-border bg-card px-4" aria-label="console">
          {nav.map((n) => <Link key={n.href} href={n.href} className="whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm hover:border-primary">{n.label}</Link>)}
        </nav>
      )}
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">{children}</main>
    </div>
  );
}
