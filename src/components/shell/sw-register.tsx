'use client';
import { useEffect } from 'react';

/** Registers the service worker and hands it the assets this page already loaded, so they work offline too. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(async (reg) => {
      await navigator.serviceWorker.ready;
      const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => u.includes('/_next/static/') || u.includes('/voice/'));
      (reg.active ?? navigator.serviceWorker.controller)?.postMessage({ type: 'precache', urls: [...urls, location.href] });
    }).catch(() => {});
  }, []);
  return null;
}
