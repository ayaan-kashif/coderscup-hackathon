'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const HOME: Record<string, string> = { helper: '/h', officer: '/o', admin: '/a', auditor: '/au' };

/** TEN-4: lists only tenants where this user holds a membership; the server re-checks on switch */
export function TenantSwitcher({ current, tenants }: { current: string | null; tenants: { code: string; name: string; role: string }[] }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  if (tenants.length < 2) return null;
  return (
    <span className="flex items-center gap-1">
      <label htmlFor="tenant-switch" className="sr-only">Switch tenant</label>
      <select id="tenant-switch" data-testid="tenant-switcher" className="h-8 rounded-full border border-white/15 bg-pill px-3 text-sm text-white transition-colors hover:border-mint" value={current ?? ''}
        onChange={async (e) => {
          const r = await fetch('/api/v1/auth/switch-tenant', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode: e.target.value }) });
          const b = await r.json().catch(() => ({}));
          if (r.ok) { router.push(HOME[b.user.role] ?? '/'); router.refresh(); } else setErr(b.detail ?? 'Could not switch.');
        }}>
        {tenants.map((t) => <option key={t.code} value={t.code}>{t.name} · {t.role}</option>)}
      </select>
      {err && <span role="alert" className="text-xs text-destructive">{err}</span>}
    </span>
  );
}
