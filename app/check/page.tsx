import { redirect } from 'next/navigation';
import { getPageActor } from '@/auth/session';

export const dynamic = 'force-dynamic';

/**
 * The mock phone's "Is this real?" link. A signed-in shopkeeper gets the check on his dashboard and a signed-in citizen the citizen check,
 * both with the text and sender filled in. Anyone else goes to the shopkeeper sign-in, and the message waits until he is signed in.
 */
export default async function CheckRouter({ searchParams }: { searchParams: Promise<{ text?: string; from?: string }> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams({ check: (sp.text ?? '').slice(0, 2000), from: (sp.from ?? '').slice(0, 40) }).toString();
  const actor = await getPageActor();
  if (actor?.role === 'shopkeeper') redirect(`/shopkeeper?${qs}`);
  if (actor?.role === 'citizen') redirect(`/c?${qs}`);
  redirect(`/login/shopkeeper?next=${encodeURIComponent(`/shopkeeper?${qs}`)}`);
}
