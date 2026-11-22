import { getLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { getPageActor } from '@/auth/session';
import { getDb } from '@/db/client';
import { PageFrame } from '@/components/shell/page-frame';
import { ShopSignupForm, safeNext } from '@/components/shop/auth-forms';
import { programmeDistricts } from '@/services/shop';

export const dynamic = 'force-dynamic';

/** Shopkeeper sign-up: shop name, username, password (twice), district, optional .test email, and "I am using made-up details". */
export default async function ShopSignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  const actor = await getPageActor();
  if (actor?.role === 'shopkeeper') redirect(safeNext(sp.next));
  const ur = (await getLocale()) === 'ur';
  const districts = (await programmeDistricts(getDb())).map((d) => ({ code: d.code, name: d.name, nameUr: d.nameUr }));
  return (
    <PageFrame title={ur ? 'نئی دکان کا اکاؤنٹ' : 'New shop account'} width="max-w-xl">
      <ShopSignupForm districts={districts} next={sp.next ? safeNext(sp.next) : undefined} />
    </PageFrame>
  );
}
