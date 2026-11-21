'use client';
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';

/** Gently tilts its children toward the pointer. Disabled for reduced motion and touch (no pointer move events). */
export function HeroParallax({ children, className, id }: { children: React.ReactNode; className?: string; id?: string }) {
  const reduce = useReducedMotion();
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 90, damping: 18 });
  const sy = useSpring(my, { stiffness: 90, damping: 18 });
  const x = useTransform(sx, [-0.5, 0.5], [-14, 14]);
  const y = useTransform(sy, [-0.5, 0.5], [-10, 10]);
  const rotate = useTransform(sx, [-0.5, 0.5], [-1.2, 1.2]);
  return (
    <div
      id={id}
      className={className}
      onPointerMove={(e) => {
        if (reduce) return;
        const r = e.currentTarget.getBoundingClientRect();
        mx.set((e.clientX - r.left) / r.width - 0.5);
        my.set((e.clientY - r.top) / r.height - 0.5);
      }}
      onPointerLeave={() => { mx.set(0); my.set(0); }}
    >
      <motion.div className="w-full" style={{ x, y, rotate }}>{children}</motion.div>
    </div>
  );
}
