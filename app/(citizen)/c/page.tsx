import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';
import { getPageActor } from '@/auth/session';
import { CitizenApp } from '@/components/citizen/citizen-app';

export const metadata: Metadata = { title: 'AMANAT — citizen (prototype)' };
export const dynamic = 'force-dynamic';

/** /c — the voice-first citizen PWA shell. Everything personal loads client-side only after the PIN (AUTH-2). A signed-in shopkeeper gets a 403. */
export default async function CitizenPage() {
  if ((await getPageActor())?.role === 'shopkeeper') forbidden();
  return <CitizenApp />;
}
