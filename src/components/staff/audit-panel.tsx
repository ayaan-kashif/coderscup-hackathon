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
  const [anchors, setAnchors] = useState<{ chain_id: string; seq: number; head: string; verified_ok: string; created_at: string }[]>([]);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch('/api/v1/audit/events?limit=50').then((r) => (r.ok ? r.json() : null)).then((b) => { if (alive && b) setEvents(b.events); }, () => {});
    fetch('/api/v1/audit/anchors').then((r) => (r.ok ? r.json() : null)).then((b) => { if (alive && b) setAnchors(b.items); }, () => {});
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
      <Card data-testid="anchors">
        <CardHeader>
          <CardTitle>Anchors (hourly)</CardTitle>
          <CardDescription>Every hour each chain is verified and its head hash is recorded. A later rewrite of history would no longer match the anchored head.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          <Button size="sm" variant="outline" onClick={async () => { await fetch('/api/v1/audit/anchors', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); load(); }}>Anchor now</Button>
          {anchors.length === 0 && <p className="text-muted-foreground">No anchors yet.</p>}
          {anchors.map((a) => (
            <div key={a.chain_id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-1">
              <span className="font-mono">{a.chain_id} · seq {a.seq}</span>
              <span className="font-mono text-muted-foreground">{a.head.slice(0, 16)}…</span>
              <Badge variant={a.verified_ok === 'true' ? 'outline' : 'destructive'}>{a.verified_ok === 'true' ? 'verified' : a.verified_ok}</Badge>
              <span dir="ltr" className="text-muted-foreground">{new Date(a.created_at).toLocaleString()}</span>
            </div>
          ))}
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
