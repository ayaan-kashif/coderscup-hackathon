'use client';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useRef } from 'react';

gsap.registerPlugin(useGSAP, ScrollTrigger);

/**
 * Landing-page scroll choreography (GSAP ScrollTrigger, scrubbed):
 *  - a mint progress line across the top of the page
 *  - the hero canvas settles back (scale + radius) while its illustration drifts and tilts
 *  - section badges and the CTA banner pick up a slow parallax
 * Everything is skipped for prefers-reduced-motion.
 */
export function ScrollEffects() {
  const bar = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.to(bar.current, { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: 0.3 } });

      gsap.to('#hero-canvas', {
        scale: 0.965,
        borderRadius: 44,
        ease: 'none',
        scrollTrigger: { trigger: '#hero-canvas', start: 'top top', end: 'bottom top', scrub: true },
      });
      gsap.to('#hero-art', {
        yPercent: -14,
        rotate: 2.5,
        ease: 'none',
        scrollTrigger: { trigger: '#hero-canvas', start: 'top top', end: 'bottom top', scrub: true },
      });
      gsap.utils.toArray<HTMLElement>('[data-parallax]').forEach((el) => {
        const amount = Number(el.dataset.parallax) || 40;
        gsap.fromTo(el, { y: amount }, { y: -amount, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true } });
      });
    });
    return () => mm.revert();
  });

  return <div ref={bar} aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 origin-left scale-x-0 bg-mint" />;
}
