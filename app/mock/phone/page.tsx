import { MockPhone } from '@/components/mock/mock-phone';

/** The on-screen mock phone: the only place a sign-in code or notification ever arrives. */
export default async function MockPhonePage({ searchParams }: { searchParams: Promise<{ phone?: string }> }) {
  const sp = await searchParams;
  return <MockPhone initialPhone={sp.phone ?? '+920000000001'} />;
}
