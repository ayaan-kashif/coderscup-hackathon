'use client';
import { animate, useInView, useMotionValue, useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';

/** Tabular figure that counts up when scrolled into view. Shows the final value under reduced motion. */
export function CountUp({ to, prefix = '', suffix = '', duration = 1.6, className }: { to: number; prefix?: string; suffix?: string; duration?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const v = useMotionValue(reduce ? to : 0);
  useEffect(() => {
    if (reduce || !inView) return;
    const c = animate(v, to, { duration, ease: [0.22, 1, 0.36, 1] });
    return () => c.stop();
  }, [inView, reduce, to, duration, v]);
  useEffect(() => v.on('change', (n) => { if (ref.current) ref.current.textContent = `${prefix}${Math.round(n).toLocaleString('en-US')}${suffix}`; }), [v, prefix, suffix]);
  return <span ref={ref} dir="ltr" className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>{`${prefix}${(reduce ? to : 0).toLocaleString('en-US')}${suffix}`}</span>;
}
