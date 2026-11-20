import type { Metadata } from 'next';
import { CitizenApp } from '@/components/citizen/citizen-app';

export const metadata: Metadata = { title: 'AMANAT — citizen (prototype)' };

/** /c — the voice-first citizen PWA shell. Everything personal loads client-side only after the PIN (AUTH-2). */
export default function CitizenPage() {
  return <CitizenApp />;
}
