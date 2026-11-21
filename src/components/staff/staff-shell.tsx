import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { Actor } from '@/auth/actor';
import { getDb } from '@/db/client';
import { tenants, users } from '@/db/schema/all';
import { Badge } from '@/components/ui/badge';
import { listMyTenants } from '@/services/auth';
import { Logo } from '@/components/brand/logo';
import { NavPills } from './nav-pills';
import { SignOutButton } from './sign-out';
import { TenantSwitcher } from './tenant-switcher';

export type NavItem = { href: string; label: string };

export const OFFICER_NAV: NavItem[] = [
  { href: '/o', label: 'Queue' }, { href: '/o/payouts', label: 'Payout changes' }, { href: '/o/scams', label: 'Scam desk' }, { href: '/o/complaints', label: 'Complaints & corrections' },
];

export const ADMIN_NAV: NavItem[] = [
  { href: '/a', label: 'Rules & Twin' }, { href: '/a/evaluation', label: 'Cost & evaluation' }, { href: '/a/break-it', label: 'Break It' }, { href: '/a/chaos', label: 'Chaos & config' }, { href: '/a/analytics', label: 'Analytics' }, { href: '/a/org', label: 'Organisation' },
];

export const AUDITOR_NAV: NavItem[] = [
  { href: '/au', label: 'Decisions' }, { href: '/au/chain', label: 'Chain integrity' }, { href: '/au/access', label: 'Consent & access' },
];

export async function StaffShell({ actor, title, children, nav }: { actor: Actor; title: string; children: React.ReactNode; nav?: NavItem[] }) {
  const t = await getTranslations('staff');
  const db = getDb();
  const [u] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, actor.id));
  const [tenant] = actor.tenantId ? await db.select({ name: tenants.name, code: tenants.code, sandbox: tenants.isSandbox }).from(tenants).where(eq(tenants.id, actor.tenantId)) : [];
  const mine = actor.role && actor.role !== 'citizen' ? await listMyTenants(db, actor.id) : [];
  return (
    <div className="min-h-dvh bg-void">
      <header className="sticky top-0 z-30 bg-void/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link href="/" aria-label="AMANAT AI home"><Logo /></Link>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-white/80">{u?.name}</span>
            <Badge variant="secondary">{t('role')}: {actor.role}{actor.isSenior ? ' (senior)' : ''}</Badge>
            {tenant && <Badge variant={tenant.sandbox ? 'warning' : 'outline'}>{t('tenant')}: {tenant.name}</Badge>}
            <TenantSwitcher current={tenant?.code ?? null} tenants={mine} />
            <SignOutButton />
          </div>
        </div>
        {nav && <div className="mx-auto max-w-[1400px]"><NavPills items={nav} /></div>}
      </header>
      <div className="mx-auto max-w-[1400px] px-4 pb-10 sm:px-6">
        <section className="canvas-violet iso-grid mb-6 overflow-hidden rounded-[28px] px-6 py-8 sm:px-10 sm:py-10" aria-label={title}>
          <p className="micro-label text-white/70">{t('role')} · {actor.role}</p>
          <p className="display-lg mt-2 uppercase">{title}</p>
        </section>
        <main className="space-y-6">{children}</main>
      </div>
    </div>
  );
}
