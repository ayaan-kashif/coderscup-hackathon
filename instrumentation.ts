/**
 * OBS-1: server errors go to Sentry when SENTRY_DSN is set (no DSN → nothing is sent, nothing breaks).
 * Personal data is never attached: no request bodies, no cookies, no default PII.
 */
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (!process.env.SENTRY_DSN) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    beforeSend(event) {
      if (event.request) { delete event.request.data; delete event.request.cookies; delete event.request.headers; }
      return event;
    },
  });
}

export const onRequestError = Sentry.captureRequestError;
