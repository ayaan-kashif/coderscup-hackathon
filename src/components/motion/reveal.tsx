'use client';
import { motion, type HTMLMotionProps } from 'motion/react';

const ease = [0.22, 1, 0.36, 1] as const;

type Props = { children: React.ReactNode; className?: string } & Omit<HTMLMotionProps<'div'>, 'children'>;

/** Scroll-triggered fade-up. Runs once, so content never flickers back out. */
export function Reveal({ children, delay = 0, y = 28, className, ...rest }: Props & { delay?: number; y?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -8% 0px' }}
      transition={{ duration: 0.7, delay, ease }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

const container = { hidden: {}, show: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } } };
const item = { hidden: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0, transition: { duration: 0.65, ease } } };

/** Parent that staggers its StaggerItem children when it scrolls into view. */
export function Stagger({ children, className, ...rest }: Props) {
  return (
    <motion.div className={className} variants={container} initial="hidden" whileInView="show" viewport={{ once: true, margin: '0px 0px -8% 0px' }} {...rest}>
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className, ...rest }: Props) {
  return <motion.div className={className} variants={item} {...rest}>{children}</motion.div>;
}

/** Splits a headline into words that rise out of a mask: the hero's page-load moment. */
export function WordRise({ text, className, delay = 0 }: { text: string; className?: string; delay?: number }) {
  return (
    <span className={className} aria-label={text}>
      {text.split(' ').map((w, i) => (
        <span key={i} className="inline-block overflow-hidden pb-[0.08em] align-bottom" aria-hidden>
          <motion.span className="inline-block" initial={{ y: '110%' }} animate={{ y: 0 }} transition={{ duration: 0.8, delay: delay + i * 0.07, ease }}>
            {w}&nbsp;
          </motion.span>
        </span>
      ))}
    </span>
  );
}
