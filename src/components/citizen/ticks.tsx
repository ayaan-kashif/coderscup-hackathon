import { Check, CheckCheck, RotateCcw } from 'lucide-react';
import type { Tick } from '@/offline/outbox';
import { cn } from '@/lib/utils';

/** OFF-5: one grey tick saved on the phone, two grey reached the office, two blue an officer opened it. */
export function Ticks({ tick, labels }: { tick: Tick; labels: Record<'saved' | 'sent' | 'opened' | 'failed', string> }) {
  const map = {
    grey1: { Icon: Check, cls: 'text-muted-foreground', label: labels.saved },
    grey2: { Icon: CheckCheck, cls: 'text-muted-foreground', label: labels.sent },
    blue2: { Icon: CheckCheck, cls: 'text-tick-blue', label: labels.opened },
    failed: { Icon: RotateCcw, cls: 'text-destructive', label: labels.failed },
  }[tick];
  return (
    <span className={cn('inline-flex items-center gap-1 text-sm font-medium', map.cls)} data-tick={tick}>
      <map.Icon className="size-5" aria-hidden /> {map.label}
    </span>
  );
}
