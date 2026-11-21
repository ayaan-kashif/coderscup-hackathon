'use client';
import { motion, useReducedMotion } from 'motion/react';

/*
 * Isometric 2.5D pipeline diagram — the hero's signature. It draws the product's real flow:
 * voice in → AI reads → rules decide → officer signs → payout. Palette is strictly #0D0D11 / #A3F7B5 / #fff / violets.
 */
const INK = '#0D0D11';
const MINT = '#A3F7B5';
const TOP = '#9B87F0';
const SIDE_L = '#7C66DC';
const SIDE_R = '#5F49C2';
const SHADOW = '#5A45BA';

function Platform({ cx, cy, w = 96, t = 22, delay = 0 }: { cx: number; cy: number; w?: number; t?: number; delay?: number }) {
  const h = w * 0.5;
  const top = `${cx},${cy - h} ${cx + w},${cy} ${cx},${cy + h} ${cx - w},${cy}`;
  const left = `${cx - w},${cy} ${cx},${cy + h} ${cx},${cy + h + t} ${cx - w},${cy + t}`;
  const right = `${cx + w},${cy} ${cx},${cy + h} ${cx},${cy + h + t} ${cx + w},${cy + t}`;
  return (
    <motion.g initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay, ease: [0.22, 1, 0.36, 1] }}>
      <polygon points={`${cx - w - 18},${cy + t + 8} ${cx},${cy + h + t + 26} ${cx + w + 18},${cy + t + 8} ${cx},${cy - h + t + 14}`} fill={SHADOW} opacity="0.55" />
      <polygon points={left} fill={SIDE_L} stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
      <polygon points={right} fill={SIDE_R} stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
      <polygon points={top} fill={TOP} stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
      <polygon points={`${cx},${cy - h + 8} ${cx + w - 14},${cy} ${cx},${cy + h - 8} ${cx - w + 14},${cy}`} fill="none" stroke="#fff" strokeOpacity="0.28" strokeWidth="1" />
    </motion.g>
  );
}

function Monitor({ x, y, bars, mint, label, delay = 0, lx = 18, ly = -14 }: { x: number; y: number; bars: number[]; mint: boolean; label: string; delay?: number; lx?: number; ly?: number }) {
  const reduce = useReducedMotion();
  const bg = mint ? MINT : INK;
  const fg = mint ? INK : MINT;
  return (
    <motion.g initial={{ opacity: 0, y: -30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay, ease: [0.22, 1, 0.36, 1] }}>
      <motion.g animate={reduce ? undefined : { y: [0, -6, 0] }} transition={{ duration: 5 + delay, repeat: Infinity, ease: 'easeInOut' }}>
        {/* stand */}
        <polygon points={`${x + 52},${y + 108} ${x + 70},${y + 118} ${x + 52},${y + 128} ${x + 34},${y + 118}`} fill={INK} />
        <rect x={x + 49} y={y + 84} width="6" height="36" fill={INK} />
        {/* screen on the 30° plane */}
        <g transform={`translate(${x} ${y}) matrix(1 0.577 0 1 0 0)`}>
          <rect width="104" height="84" rx="6" fill={bg} stroke={INK} strokeWidth="2" />
          <rect x="8" y="8" width="28" height="8" rx="4" fill="#fff" />
          <rect x="40" y="8" width="6" height="8" rx="3" fill={mint ? INK : '#fff'} opacity="0.5" />
          {bars.map((hgt, i) => (
            <motion.rect
              key={i}
              x={12 + i * 13}
              y={26 + (52 - hgt)}
              width="7"
              height={hgt}
              rx="2"
              fill={fg}
              style={{ transformBox: 'fill-box', transformOrigin: 'bottom' }}
              animate={reduce ? undefined : { scaleY: [1, 0.55 + ((i * 37) % 45) / 100, 1] }}
              transition={{ duration: 2.2 + (i % 3) * 0.5, repeat: Infinity, ease: 'easeInOut', delay: i * 0.12 }}
            />
          ))}
        </g>
      </motion.g>
      <text x={x + lx} y={y + ly} fill={INK} fontSize="11" fontWeight="700" letterSpacing="1.5" fontFamily="var(--font-mono)" transform={`rotate(-30 ${x + lx} ${y + ly})`}>{label}</text>
    </motion.g>
  );
}

function Coin({ x, y, label, delay = 0 }: { x: number; y: number; label: string; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.g initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} style={{ transformBox: 'fill-box', transformOrigin: 'center' }} transition={{ duration: 0.7, delay, ease: [0.34, 1.56, 0.64, 1] }}>
      <ellipse cx={x} cy={y + 2} rx="34" ry="17" fill={INK} />
      <motion.g animate={reduce ? undefined : { y: [0, -9, 0] }} transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut', delay }}>
        <ellipse cx={x} cy={y - 18} rx="22" ry="26" fill={MINT} stroke={INK} strokeWidth="2" />
        <ellipse cx={x} cy={y - 18} rx="15" ry="19" fill="none" stroke={INK} strokeWidth="1.4" opacity="0.5" />
        <text x={x} y={y - 11} textAnchor="middle" fontSize="22" fontWeight="800" fill={INK} fontFamily="var(--font-jakarta)">{label}</text>
      </motion.g>
    </motion.g>
  );
}

function Wire({ d, delay = 0 }: { d: string; delay?: number }) {
  return (
    <>
      <motion.path d={d} fill="none" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.4, delay, ease: 'easeInOut' }} />
      <path d={d} fill="none" stroke={MINT} strokeWidth="2.2" strokeDasharray="3 21" strokeLinecap="round" className="animate-flow" />
    </>
  );
}

const Dot = ({ x, y }: { x: number; y: number }) => <circle cx={x} cy={y} r="4.5" fill={INK} />;
const Tag = ({ x, y, rot, children }: { x: number; y: number; rot: number; children: string }) => (
  <text x={x} y={y} fill={INK} fontSize="10.5" fontWeight="700" letterSpacing="1.6" fontFamily="var(--font-mono)" transform={`rotate(${rot} ${x} ${y})`}>{children}</text>
);

export function IsoFlow({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 640 600" className={className} role="img" aria-label="Isometric diagram: voice in, AI reads the documents, rules decide, an officer signs off, payout is sent">
      <Wire d="M 395 300 L 300 345 L 205 392" delay={0.9} />
      <Wire d="M 330 200 L 460 262 L 525 295" delay={1.1} />
      <Wire d="M 205 392 L 268 424 L 330 455" delay={1.3} />
      <Wire d="M 395 300 L 470 340 L 470 392" delay={1.5} />
      <Wire d="M 525 295 L 570 330 L 570 372" delay={1.7} />
      <Dot x={300} y={345} /><Dot x={460} y={262} /><Dot x={268} y={424} /><Dot x={470} y={340} /><Dot x={570} y={330} />

      <Platform cx={285} cy={190} w={100} delay={0.1} />
      <Monitor x={235} y={82} bars={[38, 24, 44, 18, 36]} mint={false} label="AI READS" delay={0.5} />

      <Platform cx={395} cy={310} w={92} delay={0.25} />
      <Tag x={345} y={314} rot={30}>RULES</Tag>

      <Platform cx={165} cy={420} w={86} delay={0.4} />
      <Coin x={165} y={408} label="Rs" delay={0.9} />
      <Tag x={102} y={452} rot={30}>PAYOUT</Tag>

      <Platform cx={560} cy={325} w={78} delay={0.55} />
      <Coin x={560} y={314} label="UR" delay={1.1} />
      <Tag x={575} y={262} rot={-30}>VOICE IN</Tag>

      <Platform cx={420} cy={462} w={104} delay={0.7} />
      <Monitor x={366} y={352} bars={[22, 40, 30, 46, 26]} mint label="OFFICER SIGNS" delay={1.0} lx={118} ly={104} />
    </svg>
  );
}
