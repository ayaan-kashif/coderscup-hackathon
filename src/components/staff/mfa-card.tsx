'use client';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

/** AUTH-1 (P1): admins and auditors turn on TOTP. The secret is shown once; MFA turns on only after a correct code. */
export function MfaCard() {
  const [st, setSt] = useState<{ enabled: boolean; required: boolean; thisSession: boolean } | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [v, setV] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch('/api/v1/me/mfa/setup').then((r) => (r.ok ? r.json() : null)).then((b) => { if (alive && b) setSt(b); }, () => {});
    return () => { alive = false; };
  }, [v]);
  if (!st?.required) return null;
  return (
    <Card data-testid="mfa-card">
      <CardHeader>
        <CardTitle>Two-step sign-in (TOTP)</CardTitle>
        <CardDescription>Admins and auditors confirm sign-in with a 6-digit code from an authenticator app. Demo-picker sessions skip this step (demo mode only).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>Status: {st.enabled ? <Badge variant="success">on</Badge> : <Badge variant="warning">off</Badge>} {st.thisSession && <Badge variant="outline" className="ms-1">this session passed MFA</Badge>}</p>
        {!st.enabled && !setup && (
          <Button size="sm" onClick={async () => {
            const r = await fetch('/api/v1/me/mfa/setup', { method: 'POST' });
            const b = await r.json();
            if (r.ok) setSetup(b); else setMsg(b.detail);
          }}>Set up MFA</Button>
        )}
        {setup && !st.enabled && (
          <div className="space-y-2">
            <p>Add this key to your authenticator app (shown once):</p>
            <p className="break-all rounded-xl border-2 border-warning p-2 font-mono" data-testid="mfa-secret">{setup.secret}</p>
            <p className="break-all text-xs text-muted-foreground">{setup.otpauthUri}</p>
            <div className="flex gap-2">
              <Input inputMode="numeric" maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="w-32" />
              <Button size="sm" disabled={code.length !== 6} onClick={async () => {
                const r = await fetch('/api/v1/me/mfa/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
                const b = await r.json();
                if (r.ok) { setMsg('MFA is on. Your next sign-in will ask for a code.'); setSetup(null); setV((x) => x + 1); } else setMsg(b.detail);
              }}>Confirm</Button>
            </div>
          </div>
        )}
        {msg && <p role="status">{msg}</p>}
      </CardContent>
    </Card>
  );
}
