'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const HOME: Record<string, string> = { citizen: '/c', helper: '/h', officer: '/o', admin: '/a', auditor: '/au' };

export function LoginForm({ next, labels }: { next?: string; labels: Record<'email' | 'password' | 'submit', string> }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const go = (role: string) => router.push(next ?? HOME[role] ?? '/');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const b = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok && b.mfaRequired) { setError(null); setChallenge(b.challenge); return; }
    if (r.ok) go(b.user.role); else setError(`${b.code}: ${b.detail} (${b.requestId})`);
  };

  // AUTH-1: second step for admins and auditors with MFA on
  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await fetch('/api/v1/auth/mfa/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challenge, code }) });
    const b = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) go(b.user.role); else { setError(`${b.code}: ${b.detail}`); setCode(''); }
  };

  return (
    <div className="space-y-6">
      {challenge ? (
        <form onSubmit={submitCode} className="space-y-4" data-testid="mfa-form">
          <div className="space-y-2"><Label htmlFor="mfa-code">6-digit code from your authenticator app</Label><Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>Verify</Button>
          <Button type="button" variant="ghost" className="w-full" onClick={() => { setChallenge(null); setCode(''); }}>Back</Button>
        </form>
      ) : (
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2"><Label htmlFor="email">{labels.email}</Label><Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="password">{labels.password}</Label><Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>{labels.submit}</Button>
      </form>
      )}
    </div>
  );
}
