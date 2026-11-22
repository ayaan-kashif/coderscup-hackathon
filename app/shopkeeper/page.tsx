import { getLocale } from 'next-intl/server';
import { requireRole } from '@/auth/session';
import { getDb } from '@/db/client';
import { PageFrame } from '@/components/shell/page-frame';
import { SimulatedBadge } from '@/components/shell/simulated-badge';
import { ShopDashboard } from '@/components/shop/dashboard';
import { shopProfileFor } from '@/services/shop';

export const dynamic = 'force-dynamic';

/** The shopkeeper's dashboard. Signed-out visitors go to /login/shopkeeper; any other role gets a 403. */
export default async function ShopkeeperPage({ searchParams }: { searchParams: Promise<{ check?: string; from?: string }> }) {
  const actor = await requireRole('shopkeeper');
  const sp = await searchParams;
  const me = await shopProfileFor(getDb(), actor.id);
  const ur = (await getLocale()) === 'ur';
  return (
    <PageFrame title={<>{ur ? 'میری دکان' : 'My shop'} <SimulatedBadge what="Saaya programme" /></>} width="max-w-3xl">
      <ShopDashboard shop={{ shopName: me.shopName, username: me.username, district: { code: me.district.code, name: me.district.name, nameUr: me.district.nameUr } }}
        initialText={(sp.check ?? '').slice(0, 2000)} initialSender={(sp.from ?? '').slice(0, 40)} />
    </PageFrame>
  );
}
