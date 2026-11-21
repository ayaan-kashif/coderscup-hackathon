'use client';
import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Console navigation: horizontal pills; the active one is a dark pill that slides between routes. */
export function NavPills({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname();
  // longest matching href wins so /o/payouts does not also light up /o
  const active = items.filter((n) => path === n.href || path.startsWith(`${n.href}/`)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav className="flex gap-1 overflow-x-auto px-4 pb-3 sm:px-6" aria-label="console">
      {items.map((n) => (
        <Link key={n.href} href={n.href} aria-current={active === n.href ? 'page' : undefined} className="relative whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium text-white/70 transition-colors hover:text-white aria-[current=page]:text-white">
          {active === n.href && <motion.span layoutId="console-pill" className="absolute inset-0 rounded-full bg-pill ring-1 ring-white/10" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
          <span className="relative">{n.label}</span>
        </Link>
      ))}
    </nav>
  );
}
