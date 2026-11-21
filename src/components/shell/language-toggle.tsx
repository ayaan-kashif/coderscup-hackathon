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
      className="shrink-0 rounded-full border border-white/20 bg-white/5 px-3 py-0.5 font-semibold text-white transition-colors hover:border-mint hover:text-mint disabled:opacity-50"
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
