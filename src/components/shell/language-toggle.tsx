'use client';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

export function LanguageToggle({ label }: { label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className="rounded border border-warning-foreground/40 px-2 py-0.5 font-semibold hover:bg-warning-foreground/10"
      onClick={() => {
        const current = document.documentElement.lang === 'ur' ? 'ur' : 'en';
        const next = current === 'ur' ? 'en' : 'ur';
        document.cookie = `amanat_locale=${next}; path=/; max-age=31536000; samesite=lax`;
        start(() => router.refresh());
      }}
    >
      {label}
    </button>
  );
}
