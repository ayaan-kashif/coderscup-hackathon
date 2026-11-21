import { cn } from '@/lib/utils';

/** AMANAT mark: a mint rounded square holding an "A" glyph, plus the wordmark. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-8', className)} aria-hidden>
      <rect width="32" height="32" rx="10" fill="#A3F7B5" />
      <path d="M16 6 8 24h4.2l1.6-4h4.4l1.6 4H24L16 6Zm0 7.6 1.5 3.8h-3L16 13.6Z" fill="#0D0D11" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5 font-display text-lg font-extrabold tracking-tight text-white', className)}>
      <LogoMark />
      <span>AMANAT<span className="text-mint">AI</span></span>
    </span>
  );
}
