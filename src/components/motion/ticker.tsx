import { cn } from '@/lib/utils';

export type TickerItem = { label: string; value: string };

/** Bottom data ticker: LABEL (muted) VALUE (bold) separated by mint //. Pure CSS marquee, pauses on hover. */
export function Ticker({ items, className }: { items: TickerItem[]; className?: string }) {
  const row = (hidden: boolean) => (
    <ul className="flex shrink-0 items-center gap-6 pe-6" aria-hidden={hidden || undefined}>
      {items.map((it, i) => (
        <li key={i} className="flex items-center gap-6 whitespace-nowrap">
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.06em]">
            <span className="text-label">{it.label}</span> <span className="ms-1 text-sm font-bold text-white">{it.value}</span>
          </span>
          <span className="font-mono text-mint/80" aria-hidden>{'//'}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <div className={cn('group relative overflow-hidden bg-void py-4', className)}>
      <div dir="ltr" className="flex w-max animate-marquee group-hover:[animation-play-state:paused]">{row(false)}{row(true)}</div>
      <div className="pointer-events-none absolute inset-y-0 start-0 w-16 bg-gradient-to-r from-void to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 end-0 w-16 bg-gradient-to-l from-void to-transparent" />
    </div>
  );
}
