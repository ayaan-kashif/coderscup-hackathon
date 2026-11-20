'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const HOME: Record<string, string> = { citizen: '/c', helper: '/h', officer: '/o', admin: '/a', auditor: '/au' };

type Account = { email: string; role: string; tenant: string };

export function LoginForm({ demo, next, accounts, labels }: { demo: boolean; next?: string; accounts: Account[]; labels: Record<'email' | 'password' | 'submit' | 'demo' | 'demoHint', string> }) {
  const router = useRouter();
  const [email, setEmail] = useState('officer.imran@sindh.amanat.test');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = (role: string) => router.push(next ?? HOME[role] ?? '/');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const b = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) go(b.user.role); else setError(`${b.code}: ${b.detail} (${b.requestId})`);
  };

  const demoLogin = async (role: string, account?: string) => {
    setBusy(true);
    const r = await fetch('/api/v1/demo/tokens', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role, ...(account ? { email: account } : {}) }) });
    const b = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) router.push(HOME[role] ?? '/'); else setError(`${b.code}: ${b.detail}`);
  };

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2"><Label htmlFor="email">{labels.email}</Label><Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="password">{labels.password}</Label><Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>{labels.submit}</Button>
      </form>
      {demo && (
        <Card>
          <CardHeader><CardTitle>{labels.demo}</CardTitle><CardDescription>{labels.demoHint}</CardDescription></CardHeader>
          <CardContent className="grid gap-2">
            {(['officer', 'admin', 'auditor', 'helper', 'citizen'] as const).map((role) => (
              <Button key={role} variant="outline" disabled={busy} onClick={() => demoLogin(role)} data-testid={`demo-${role}`}>
                {role} {role === 'citizen' ? '(Zarina, +920000000001)' : `(${accounts.find((a) => a.role === role && a.tenant === 'sindh')?.email})`}
              </Button>
            ))}
            <Button variant="ghost" disabled={busy} onClick={() => demoLogin('officer', 'officer.bilal@punjab.amanat.test')}>officer — Punjab tenant</Button>
            <Button variant="ghost" disabled={busy} onClick={() => demoLogin('admin', 'admin.breakit@sandbox.amanat.test')}>admin — sandbox tenant</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
