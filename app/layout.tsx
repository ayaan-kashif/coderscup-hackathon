import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import { MotionProvider } from '@/components/motion/provider';
import { LowBandwidthProbe } from '@/components/shell/low-bandwidth';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import { PrototypeBanner } from '@/components/shell/prototype-banner';
import { ServiceWorkerRegister } from '@/components/shell/sw-register';
import { dirOf, isLocale } from '@/i18n/config';
import './globals.css';

export const metadata: Metadata = {
  title: 'AMANAT AI (prototype)',
  description: 'Trust-first public assistance prototype. Not an official service. All data is synthetic.',
  manifest: '/manifest.webmanifest',
};

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta', weight: ['600', '700', '800'], display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono-data', display: 'swap' });

export const viewport: Viewport = { themeColor: '#0d0d11', width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const l = await getLocale();
  const locale = isLocale(l) ? l : 'en';
  return (
    <html lang={locale} dir={dirOf(locale)} className={`${inter.variable} ${jakarta.variable} ${mono.variable}`}>
      <body className="min-h-dvh antialiased">
        <NextIntlClientProvider>
          <MotionProvider>
            <PrototypeBanner />
            {children}
            <ServiceWorkerRegister />
            <LowBandwidthProbe />
          </MotionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
