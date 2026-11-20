'use client';
import { useEffect, useState } from 'react';
import { SimulatedBadge } from '@/components/shell/simulated-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type Row = { service: string; latencyMs: number; timeoutRate: number; errorRate: number };

/** ADM-2: latency, timeout rate and error rate per mock service. Changes apply to the next request. */
export function ChaosPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch('/api/v1/admin/chaos').then((r) => (r.ok ? r.json() : null)).then((b) => { if (alive && b) setRows(b.services); }, () => {});
    return () => { alive = false; };
  }, [version]);
  const save = async (row: Row) => {
    const r = await fetch('/api/v1/admin/chaos', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(row) });
    const b = await r.json();
    setMsg(r.ok ? `${row.service}: saved (audited)` : `${b.code}: ${b.detail}`);
    setVersion((v) => v + 1);
  };
  const set = (i: number, k: keyof Row, v: number) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Chaos panel <SimulatedBadge what="mock services" /></CardTitle>
        <CardDescription>Break the mock services live. An outage turns cases into human reviews (stop S8), never into approvals.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="divide-y divide-border">
          {rows.map((r, i) => (
            <div key={r.service} className="grid grid-cols-3 items-end gap-2 py-3 sm:grid-cols-[8rem_1fr_1fr_1fr_auto]">
              <span className="col-span-3 font-medium sm:col-span-1 sm:self-center">{r.service}</span>
              <label className="text-xs text-muted-foreground">Latency ms
                <Input type="number" min={0} max={30000} step={100} value={r.latencyMs} onChange={(e) => set(i, 'latencyMs', Number(e.target.value))} />
              </label>
              <label className="text-xs text-muted-foreground">Timeout rate
                <Input type="number" min={0} max={1} step={0.1} value={r.timeoutRate} onChange={(e) => set(i, 'timeoutRate', Number(e.target.value))} />
              </label>
              <label className="text-xs text-muted-foreground">Error rate
                <Input type="number" min={0} max={1} step={0.1} value={r.errorRate} onChange={(e) => set(i, 'errorRate', Number(e.target.value))} />
              </label>
              <div className="col-span-3 flex gap-2 sm:col-span-1">
                <Button size="sm" onClick={() => save(r)}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => save({ ...r, latencyMs: 0, timeoutRate: 0, errorRate: 0 })}>Heal</Button>
              </div>
            </div>
          ))}
        </div>
        {msg && <p className="text-sm" role="status">{msg}</p>}
      </CardContent>
    </Card>
  );
}
