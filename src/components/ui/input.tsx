import * as React from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn('flex h-11 w-full rounded-xl border border-white/12 bg-white/[0.05] px-4 py-2 text-sm text-foreground transition-[border-color,box-shadow,background-color] placeholder:text-white/40 hover:border-white/25 focus-visible:border-mint focus-visible:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint/40 disabled:opacity-50', className)}
      {...props}
    />
  );
}
