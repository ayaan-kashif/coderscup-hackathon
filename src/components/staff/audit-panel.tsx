'use client';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type Ev = { id: number; seq: number; ts: string; actorType: string; actorId: string; action: string; resourceType: string; resourceId: string | null; outcome: string; details: Record<string, unknown>; hash: string };
type Verify = { intact: boolean; length: number; brokenAt: number | null; missingTail: boolean; meaning: string; checkedAt: string };

export function AuditPanel() {
  const [events, setEvents] = useState<Ev[]>([]);
  const [verify, setVerify] = useState<Verify | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch('/api/v1/audit/events?limit=50').then((r) => (r.ok ? r.json() : null)).then((b) => { if (alive && b) setEvents(b.events); }, () => {});
    return () => { alive = false; };
  }, [version]);
  const load = () => setVersion((v) => v + 1);
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Evidence chain</CardTitle>
          <CardDescription>Every action is hash-chained by a database trigger. Verification walks the chain and names the first broken row.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={async () => { const r = await fetch('/api/v1/audit/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); setVerify(await r.json()); void load(); }}>Verify my tenant&apos;s chain</Button>
          {verify && (
            <p className={verify.intact ? 'flex items-center gap-2 text-success' : 'flex items-center gap-2 text-destructive'} role="status">
              {verify.intact ? <ShieldCheck /> : <ShieldAlert />} {verify.intact ? `Intact: ${verify.length} events` : verify.meaning}
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Recent events</CardTitle><CardDescription>Ids and hashes only — never raw personal data.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-muted-foreground"><th className="text-start">seq</th><th className="text-start">time</th><th className="text-start">actor</th><th className="text-start">action</th><th className="text-start">outcome</th><th className="text-start">hash</th></tr></thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="py-1 font-mono">{e.seq}</td>
                  <td dir="ltr">{new Date(e.ts).toLocaleString()}</td>
                  <td>{e.actorType}</td>
                  <td className="font-mono">{e.action}</td>
                  <td><Badge variant={e.outcome === 'allowed' ? 'outline' : 'destructive'}>{e.outcome}{typeof e.details.code === 'string' ? ` · ${e.details.code}` : ''}</Badge></td>
                  <td className="font-mono text-muted-foreground">{e.hash.slice(0, 12)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}
