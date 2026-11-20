import type { Metadata, Viewport } from 'next';
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

export const viewport: Viewport = { themeColor: '#1f6f5c', width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const l = await getLocale();
  const locale = isLocale(l) ? l : 'en';
  return (
    <html lang={locale} dir={dirOf(locale)}>
      <body className="min-h-dvh antialiased">
        <NextIntlClientProvider>
          <PrototypeBanner />
          {children}
          <ServiceWorkerRegister />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
