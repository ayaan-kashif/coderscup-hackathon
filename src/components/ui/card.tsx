import * as React from 'react';
import { cn } from '@/lib/utils';

/** Bento card: #16161D surface, 24px radius, hairline border, soft entrance (CSS-only so server components stay light). */
export function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('rounded-3xl border border-white/[0.08] bg-card text-card-foreground transition-[border-color,transform] duration-300 animate-in fade-in-0 slide-in-from-bottom-2 fill-mode-both duration-500 hover:border-white/20', className)}
      {...props}
    />
  );
}
export function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1.5 p-6', className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.ComponentProps<'h3'>) {
  return <h3 className={cn('text-lg font-bold leading-tight tracking-tight', className)} {...props} />;
}
export function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}
export function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('p-6 pt-0', className)} {...props} />;
}
