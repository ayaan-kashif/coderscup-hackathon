'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Costs = { wrongApproval: number; review: number; delay: number };

/** The F6 cost threshold, editable live (ADM-3). The full cost slider with route split comes with F14. */
export function CostPanel() {
  const [costs, setCosts] = useState<Costs>({ wrongApproval: 25000, review: 300, delay: 200 });
  const [floor, setFloor] = useState(0.9);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    void fetch('/api/v1/admin/config').then(async (r) => {
      if (!r.ok) return;
      const c = (await r.json()).config;
      if (c['decision.costs']) setCosts(c['decision.costs'].value);
      if (c['decision.floor']) setFloor(c['decision.floor'].value);
    });
  }, []);
  const maxPBad = (costs.review + costs.delay) / (costs.wrongApproval + costs.delay);
  const required = Math.max(1 - maxPBad, floor);
  const save = async () => {
    const r = await fetch('/api/v1/admin/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'decision.costs', value: costs }) });
    const b = await r.json();
    setMsg(r.ok ? `Saved. The next decision needs ${(b.threshold.required * 100).toFixed(1)}% confidence.` : `${b.code}: ${b.detail}`);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Decision costs</CardTitle>
        <CardDescription>Auto-approve only when Pr(bad) · C<sub>wrong</sub> &lt; C<sub>review</sub> + (1 − Pr(bad)) · C<sub>delay</sub>. All costs are labelled assumptions.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {(['wrongApproval', 'review', 'delay'] as const).map((k) => (
            <div key={k} className="space-y-1">
              <Label htmlFor={k}>{{ wrongApproval: 'Wrong approval (Rs)', review: 'Review (Rs)', delay: 'Delay (Rs)' }[k]}</Label>
              <Input id={k} type="number" min={1} value={costs[k]} onChange={(e) => setCosts({ ...costs, [k]: Number(e.target.value) })} />
            </div>
          ))}
        </div>
        <p className="text-lg">Bar: <strong data-testid="cost-bar">{(required * 100).toFixed(1)}%</strong> confidence <span className="text-sm text-muted-foreground">(max Pr(bad) {(maxPBad * 100).toFixed(2)}%, floor {(floor * 100).toFixed(0)}%)</span></p>
        <Button onClick={save}>Save for my tenant</Button>
        {msg && <p className="text-sm" role="status">{msg}</p>}
      </CardContent>
    </Card>
  );
}
