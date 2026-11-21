import Link from 'next/link';
import { Logo } from '@/components/brand/logo';
import { cn } from '@/lib/utils';

/** Shared frame for non-console pages: logo bar, violet title canvas, then content. Server-safe. */
export function PageFrame({ eyebrow, title, aside, children, width = 'max-w-3xl' }: { eyebrow?: string; title: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; width?: string }) {
  return (
    <div className="min-h-dvh bg-void">
      <div className={cn('mx-auto px-4 pb-12 sm:px-6', width)}>
        <header className="flex h-[72px] items-center justify-between">
          <Link href="/" aria-label="AMANAT AI home"><Logo /></Link>
          {aside}
        </header>
        <section className="canvas-violet iso-grid mb-6 space-y-2 overflow-hidden rounded-[28px] px-6 py-8 sm:px-10 sm:py-10">
          {eyebrow && <p className="micro-label text-white/70">{eyebrow}</p>}
          <h1 className="display-lg uppercase">{title}</h1>
        </section>
        <main className="space-y-4">{children}</main>
      </div>
    </div>
  );
}
