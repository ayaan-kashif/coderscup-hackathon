'use client';
import { AnimatePresence, motion } from 'motion/react';
import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Logo } from '@/components/brand/logo';
import { cn } from '@/lib/utils';

type NavLink = { href: string; label: string };

/** Landing navbar: logo · pill links with a sliding highlight · Login + white Sign Up. Collapses to a sheet below md. */
export function SiteNav({ links, login, start }: { links: NavLink[]; login: string; start: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const [active, setActive] = useState(links[0]?.href ?? '');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const ids = links.map((l) => l.href.replace('#', '')).filter(Boolean);
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) setActive(`#${e.target.id}`); }),
      { rootMargin: '-45% 0px -50% 0px' },
    );
    ids.forEach((id) => { const el = document.getElementById(id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, [links]);

  const shown = hover ?? active;
  return (
    <header className="sticky top-0 z-40 bg-void/80 backdrop-blur-xl">
      <div className="mx-auto flex h-[72px] max-w-[1400px] items-center justify-between px-4 sm:px-6">
        <Link href="/" aria-label="AMANAT AI home"><Logo /></Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex" onMouseLeave={() => setHover(null)}>
          {links.map((l) => (
            <a key={l.href} href={l.href} onMouseEnter={() => setHover(l.href)} onFocus={() => setHover(l.href)} onBlur={() => setHover(null)} className="relative rounded-full px-[18px] py-2 text-sm font-medium text-white/80 transition-colors hover:text-white">
              {shown === l.href && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-full bg-pill" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
              <span className="relative">{l.label}</span>
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2 sm:gap-4">
          <Link href="/login" className="hidden rounded-lg px-2 py-1 text-sm font-semibold text-white/90 transition-colors hover:text-mint sm:inline">{login}</Link>
          <Link href="/c" className="rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-void transition-[transform,background-color] hover:-translate-y-0.5 hover:bg-mint active:scale-95">{start}</Link>
          <button type="button" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex size-10 items-center justify-center rounded-xl bg-pill text-white md:hidden">
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.nav aria-label="Mobile" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-white/10 md:hidden">
            <ul className="space-y-1 px-4 py-3">
              {links.map((l, i) => (
                <motion.li key={l.href} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}>
                  <a href={l.href} onClick={() => setOpen(false)} className={cn('block rounded-xl px-4 py-3 text-base font-medium', active === l.href ? 'bg-pill text-white' : 'text-white/80')}>{l.label}</a>
                </motion.li>
              ))}
              <li><Link href="/login" className="block rounded-xl px-4 py-3 text-base font-medium text-mint">{login}</Link></li>
            </ul>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
