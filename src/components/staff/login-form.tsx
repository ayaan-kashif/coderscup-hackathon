'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const HOME: Record<string, string> = { citizen: '/c', helper: '/h', officer: '/o', admin: '/a', auditor: '/au' };

export function LoginForm({ demo, needsCode = false, next, labels }: { demo: boolean; needsCode?: boolean; next?: string; labels: Record<'email' | 'password' | 'submit' | 'demo' | 'demoHint', string> }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [accessCode, setAccessCode] = useState('');

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

  const demoLogin = async (role: string, account?: string) => {
    setBusy(true);
    const r = await fetch('/api/v1/demo/tokens', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role, ...(account ? { email: account } : {}), ...(needsCode ? { accessCode } : {}) }) });
    const b = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) router.push(HOME[role] ?? '/'); else setError(`${b.code}: ${b.detail}`);
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
      {demo && (
        <Card>
          <CardHeader><CardTitle>{labels.demo}</CardTitle><CardDescription>{labels.demoHint}</CardDescription></CardHeader>
          <CardContent className="grid gap-2">
            {needsCode && (
              <div className="space-y-2"><Label htmlFor="demo-code">Demo access code</Label><Input id="demo-code" type="password" autoComplete="off" value={accessCode} onChange={(e) => setAccessCode(e.target.value)} data-testid="demo-code" /></div>
            )}
            {(['officer', 'admin', 'auditor', 'helper', 'citizen'] as const).map((role) => (
              <Button key={role} variant="outline" disabled={busy || (needsCode && !accessCode)} onClick={() => demoLogin(role)} data-testid={`demo-${role}`}>
                Open as {role}
              </Button>
            ))}
            <Button variant="ghost" disabled={busy || (needsCode && !accessCode)} onClick={() => demoLogin('officer', 'officer.bilal@punjab.amanat.test')}>officer — Punjab office</Button>
            <Button variant="ghost" disabled={busy || (needsCode && !accessCode)} onClick={() => demoLogin('admin', 'admin.breakit@sandbox.amanat.test')}>admin — sandbox office</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
