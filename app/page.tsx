import { ArrowUpRight, Store, BookOpenCheck, Gift, HandHeart, Landmark, MessageSquareText, Mic, ScanText, ShieldCheck, SlidersHorizontal, Smartphone, Wifi, Link2, Siren, UserCheck, Scale, Cpu } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { HeroParallax } from '@/components/brand/hero-parallax';
import { IsoFlow } from '@/components/brand/iso-flow';
import { Logo } from '@/components/brand/logo';
import { ScrollEffects } from '@/components/brand/scroll-effects';
import { SiteNav } from '@/components/brand/site-nav';
import { CountUp } from '@/components/motion/count-up';
import { CtaButton } from '@/components/motion/cta-button';
import { Reveal, Stagger, StaggerItem, WordRise } from '@/components/motion/reveal';
import { Ticker } from '@/components/motion/ticker';
import { SimulatedBadge } from '@/components/shell/simulated-badge';

const STEP_ICONS = [ScanText, Landmark, Scale, UserCheck];
const FEAT_ICONS = [Mic, Wifi, Link2, SlidersHorizontal, Siren, Smartphone];

export default function Home() {
  const t = useTranslations('home');
  const l = useTranslations('landing');
  const steps = l.raw('steps') as { t: string; d: string }[];
  const feats = l.raw('feats') as { t: string; d: string }[];
  const tk = (k: string) => ({ label: l(`ticker.${k}`), value: l(`tickerV.${k}`) });
  const ticker = ['roles', 'languages', 'token', 'audit', 'rules', 'sms', 'tables'].map(tk);

  const links = [
    { href: '#top', label: l('nav.home') },
    { href: '#how', label: l('nav.how') },
    { href: '#roles', label: l('nav.roles') },
    { href: '#features', label: l('nav.features') },
  ];

  return (
    <div className="bg-void" id="top">
      <ScrollEffects />
      <SiteNav links={links} login={l('nav.login')} start={l('nav.start')} />

      <main className="mx-auto max-w-[1400px] px-4 sm:px-6">
        {/* ───────── HERO ───────── */}
        <section id="hero-canvas" className="canvas-violet iso-grid relative overflow-hidden rounded-[28px] sm:rounded-[32px]" aria-labelledby="hero-title">
          <div className="grid gap-8 p-6 sm:p-10 lg:grid-cols-12 lg:gap-4 lg:p-14">
            <div className="flex flex-col justify-between gap-10 lg:col-span-7">
              <div className="space-y-7">
                <h1 id="hero-title" className="display-xl max-w-[18ch]">
                  <WordRise text={t('title')} delay={0.15} />
                </h1>
                <Reveal delay={0.5} y={16}>
                  <p className="max-w-[48ch] text-base text-white/75 sm:text-lg">{l('heroBody')}</p>
                </Reveal>
                <Reveal delay={0.65} y={16} className="flex flex-wrap items-center gap-4">
                  <CtaButton href="/c">{l('ctaPrimary')}</CtaButton>
                  <span className="glass inline-flex items-center gap-2.5 rounded-2xl px-5 py-3.5 text-sm font-medium">
                    <Gift className="size-4" aria-hidden /> {l('promo')}
                  </span>
                </Reveal>
                <Reveal delay={0.75} y={10}><SimulatedBadge what="Saaya Relief Programme" /></Reveal>
              </div>

              {/* bento stat row */}
              <Reveal delay={0.85} className="grid max-w-[560px] grid-cols-2 gap-4">
                <div className="rounded-[20px] bg-void px-6 py-6 sm:px-7">
                  <CountUp to={1030} className="stat-num block text-white" />
                  <p className="micro-label mt-2 text-label">{l('statA')}</p>
                </div>
                <div className="glass flex items-center justify-between gap-3 rounded-[20px] px-6 py-6 sm:px-7">
                  <div>
                    <CountUp to={19} className="stat-num block text-white" />
                    <p className="micro-label mt-2 text-white/70">{l('statB')}</p>
                  </div>
                  <div className="hidden -space-x-2 min-[440px]:flex rtl:space-x-reverse" aria-hidden>
                    {[Mic, HandHeart, ShieldCheck].map((I, i) => (
                      <span key={i} className="flex size-8 items-center justify-center rounded-full border-2 border-violet-2 bg-void text-mint"><I className="size-3.5" /></span>
                    ))}
                  </div>
                </div>
              </Reveal>
            </div>

            <HeroParallax id="hero-art" className="relative -mx-2 flex items-center justify-center lg:col-span-5 lg:-mx-6">
              <IsoFlow className="h-auto w-full max-w-[640px] drop-shadow-[0_30px_40px_rgb(40_20_110/0.35)]" />
            </HeroParallax>
          </div>
        </section>

        <Ticker items={ticker} className="-mx-4 sm:-mx-6" />

        {/* ───────── HOW IT WORKS ───────── */}
        <section id="how" className="scroll-mt-24 space-y-10 py-16 sm:py-24" aria-labelledby="how-title">
          <Reveal className="max-w-3xl space-y-4">
            <p className="micro-label text-mint">{l('howEyebrow')}</p>
            <h2 id="how-title" className="display-lg">{l('howTitle')}</h2>
          </Reveal>
          <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s, i) => {
              const Icon = STEP_ICONS[i]!;
              return (
                <StaggerItem key={s.t} className="group relative overflow-hidden rounded-3xl border border-white/[0.08] bg-bento p-6 transition-[border-color,transform] duration-300 hover:-translate-y-1 hover:border-mint/40">
                  <span className="flex size-11 items-center justify-center rounded-2xl bg-mint text-void transition-transform duration-300 group-hover:rotate-[-8deg] group-hover:scale-110"><Icon className="size-5" /></span>
                  <h3 className="mt-5 text-xl font-bold tracking-tight">{s.t}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/65">{s.d}</p>
                  <span aria-hidden className="pointer-events-none absolute -bottom-10 -end-10 size-32 rounded-full bg-mint/0 blur-2xl transition-colors duration-500 group-hover:bg-mint/20" />
                </StaggerItem>
              );
            })}
          </Stagger>
        </section>

        {/* ───────── ROLES ───────── */}
        <section id="roles" className="scroll-mt-24 space-y-10 pb-16 sm:pb-24" aria-labelledby="roles-title">
          <Reveal className="max-w-3xl space-y-4">
            <p className="micro-label text-mint">{l('rolesEyebrow')}</p>
            <h2 id="roles-title" className="display-lg">{l('rolesTitle')}</h2>
          </Reveal>
          <Stagger className="grid gap-4 lg:grid-cols-3">
            <StaggerItem className="lg:col-span-2">
              <Link href="/c" className="canvas-violet iso-grid group flex h-full min-h-[280px] flex-col justify-between overflow-hidden rounded-[28px] p-8 transition-transform duration-300 hover:-translate-y-1">
                <Mic className="size-10 text-mint transition-transform duration-300 group-hover:scale-110" aria-hidden />
                <div className="space-y-3">
                  <h3 className="display-lg !text-[clamp(1.5rem,2.6vw,2.25rem)] uppercase">{t('citizen')}</h3>
                  <p className="max-w-[44ch] text-white/80">{l('roleCitizenD')}</p>
                  <span className="inline-flex items-center gap-2 font-semibold">{l('open')} <ArrowUpRight className="size-4 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 rtl:-scale-x-100" /></span>
                </div>
              </Link>
            </StaggerItem>
            <div className="grid gap-4">
              {[
                { href: '/login?role=helper', Icon: HandHeart, title: t('helper'), body: l('roleHelperD') },
                { href: '/login', Icon: BookOpenCheck, title: t('staff'), body: l('roleStaffD') },
                { href: '/login/shopkeeper', Icon: Store, title: t('shopkeeper'), body: l('roleShopD') },
              ].map(({ href, Icon, title, body }) => (
                <StaggerItem key={href}>
                  <Link href={href} className="group flex h-full flex-col justify-between gap-4 rounded-[28px] border border-white/[0.08] bg-bento p-6 transition-[border-color,transform] duration-300 hover:-translate-y-1 hover:border-mint/40">
                    <span className="flex items-center justify-between">
                      <span className="flex size-11 items-center justify-center rounded-2xl bg-pill text-mint"><Icon className="size-5" /></span>
                      <ArrowUpRight className="size-5 text-white/50 transition-[transform,color] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-mint rtl:-scale-x-100" />
                    </span>
                    <span className="space-y-1.5">
                      <span className="block text-lg font-bold leading-snug tracking-tight">{title}</span>
                      <span className="block text-sm text-white/60">{body}</span>
                    </span>
                  </Link>
                </StaggerItem>
              ))}
            </div>
          </Stagger>
        </section>

        {/* ───────── FEATURES ───────── */}
        <section id="features" className="scroll-mt-24 space-y-10 pb-16 sm:pb-24" aria-labelledby="feat-title">
          <Reveal className="max-w-3xl space-y-4">
            <p className="micro-label text-mint">{l('featEyebrow')}</p>
            <h2 id="feat-title" className="display-lg">{l('featTitle')}</h2>
          </Reveal>
          <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {feats.map((f, i) => {
              const Icon = FEAT_ICONS[i] ?? Cpu;
              return (
                <StaggerItem key={f.t} className="group rounded-3xl border border-white/[0.08] bg-bento p-6 transition-[border-color,background-color,transform] duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-elevated">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-mint text-void"><Icon className="size-[18px]" /></span>
                  <h3 className="mt-5 text-lg font-bold tracking-tight">{f.t}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-white/60">{f.d}</p>
                </StaggerItem>
              );
            })}
          </Stagger>
        </section>

        {/* ───────── CTA BANNER ───────── */}
        <Reveal>
          <section className="canvas-violet iso-grid overflow-hidden rounded-[28px] p-8 sm:p-14" aria-labelledby="cta-title">
            <div className="grid items-end gap-8 lg:grid-cols-12">
              <div data-parallax="14" className="space-y-4 lg:col-span-8">
                <h2 id="cta-title" className="display-xl !text-[clamp(2rem,4.5vw,3.75rem)]">{l('ctaTitle')}</h2>
                <p className="max-w-[52ch] text-white/80">{l('ctaBody')}</p>
              </div>
              <div className="flex flex-wrap items-center gap-4 lg:col-span-4 lg:justify-end">
                <CtaButton href="/c">{t('citizen')}</CtaButton>
                <Link href="/login" className="glass rounded-2xl px-5 py-3.5 text-sm font-semibold transition-colors hover:bg-white/25">{l('ctaStaff')}</Link>
              </div>
            </div>
          </section>
        </Reveal>

        {/* ───────── FOOTER ───────── */}
        <footer className="flex flex-col gap-6 py-12 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-md space-y-3">
            <Logo />
            <p className="text-sm text-label">{l('footer')}</p>
            <p className="text-xs text-white/40">{t('subtitle')}</p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium text-white/70" aria-label="Footer">
            <Link className="inline-flex items-center gap-1.5 transition-colors hover:text-mint" href="/mock/phone"><MessageSquareText className="size-4" />{t('mockPhone')}</Link>
            <Link className="transition-colors hover:text-mint" href="/status">{t('status')}</Link>
            <a className="transition-colors hover:text-mint" href="/api/docs">{t('docs')}</a>
          </nav>
        </footer>
      </main>
    </div>
  );
}
