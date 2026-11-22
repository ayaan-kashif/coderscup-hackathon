import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const isDev = process.env.NODE_ENV !== 'production';
/** OpenStreetMap raster tiles for the Scam Map */
const TILES = 'https://tile.openstreetmap.org';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  // camera and microphone only on capture screens (enabled per route later)
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
  // scripts and styles only from us (Next.js needs inline bootstraps and eval in dev for callstacks)
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' ${isDev ? "'unsafe-eval'" : ''} https://cdn.jsdelivr.net`.trim(),
      "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
      `img-src 'self' data: blob: ${TILES}`,
      "media-src 'self' blob: data:",
      "font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com https://fonts.scalar.com",
      `connect-src 'self' ${TILES} ${isDev ? 'ws: http:' : ''}`.trim(),
      "worker-src 'self' blob:", // maplibre runs its workers from blob URLs
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['@node-rs/argon2', '@electric-sql/pglite'],
  // the evaluation run and Break It read the frozen datasets and SPECIMEN images at runtime
  outputFileTracingIncludes: { '/api/**': ['./data/models/**', './data/seed/**', './data/datasets/**', './data/documents/**', './data/policy/**'] },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }, { key: 'Service-Worker-Allowed', value: '/' }] },
    ];
  },
};

export default createNextIntlPlugin('./src/i18n/request.ts')(nextConfig);
