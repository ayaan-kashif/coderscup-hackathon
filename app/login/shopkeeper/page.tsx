import { getLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { getPageActor } from '@/auth/session';
import { PageFrame } from '@/components/shell/page-frame';
import { ShopLoginForm } from '@/components/shop/auth-forms';
import { safeNext } from '@/lib/shop-next';

export const dynamic = 'force-dynamic';

/** Shopkeeper sign-in: username or email, and password. A message opened from the mock phone waits in ?next= until he is signed in. */
export default async function ShopLoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  const actor = await getPageActor();
  if (actor?.role === 'shopkeeper') redirect(safeNext(sp.next));
  const ur = (await getLocale()) === 'ur';
  return (
    <PageFrame title={ur ? 'دکاندار سائن اِن' : 'Shopkeeper sign-in'} width="max-w-xl">
      <p className="text-white/70">{ur ? 'جعلی "امدادی ادائیگی" پیغامات جانچیں اور اپنے ضلع کے الرٹ دیکھیں۔' : 'Check fake "relief payment" messages and see the scam alerts for your district.'}</p>
      <ShopLoginForm next={sp.next ? safeNext(sp.next) : undefined} />
    </PageFrame>
  );
}
