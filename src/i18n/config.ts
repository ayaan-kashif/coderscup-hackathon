export const locales = ['en', 'ur'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';
export const LOCALE_COOKIE = 'amanat_locale';
export const dirOf = (l: Locale) => (l === 'ur' ? 'rtl' : 'ltr');
export const isLocale = (v: unknown): v is Locale => v === 'en' || v === 'ur';
