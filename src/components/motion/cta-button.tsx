'use client';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/** Dual-tone primary action: mint pill with an embedded obsidian arrow badge (DESIGN.md §5A). */
export function CtaButton({ href, children, className, tone = 'mint' }: { href: string; children: React.ReactNode; className?: string; tone?: 'mint' | 'white' }) {
  return (
    <Link
      href={href}
      className={cn(
        'group inline-flex items-center gap-4 rounded-2xl p-2 ps-6 font-semibold text-void shadow-[0_18px_40px_-18px_rgb(0_0_0/0.6)] transition-[transform,background-color] duration-200 hover:-translate-y-0.5 active:scale-[0.98]',
        tone === 'mint' ? 'bg-mint hover:bg-mint-hover' : 'bg-white hover:bg-white/90',
        className,
      )}
    >
      <span>{children}</span>
      <span className="flex size-10 items-center justify-center rounded-[11px] bg-void text-mint">
        <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
      </span>
    </Link>
  );
}
