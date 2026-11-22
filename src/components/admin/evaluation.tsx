'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/components/citizen/screens';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type Preview = {
  threshold: { required: number; costBar: number; floor: number; maxPBad: number };
  at: { split: { auto: number; proof: number; person: number }; wrongApprovals: number; badCases: number; wrongApprovalUpper95: number | null; cleanEscalated: number; cleanCases: number; reviews: number; officerHours: number; expectedCost: number };
  curve: { t: number; cost: number; wrong: number; reviews: number }[];
  empiricalMin: { t: number; cost: number };
  agreesWithinOneBand: boolean; ms: number; dataset: string;
};

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** F14 cost slider: three costs → the threshold, the route split, expected wrong approvals and officer hours, the cost curve */
export function CostSlider() {
  const [costs, setCosts] = useState({ wrongApproval: 25000, review: 300, delay: 200 });
  const [p, setP] = useState<Preview | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [roundTrip, setRoundTrip] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const t0 = performance.now();
      const r = await api('/api/v1/eval/cost-preview', { body: costs });
      if (r.status === 200) { setP(r.body); setRoundTrip(Math.round(performance.now() - t0)); }
    }, 120);
  }, [costs]);
  const slider = (k: keyof typeof costs, label: string, min: number, max: number, step: number) => (
    <label className="block text-sm">
      <span className="flex justify-between"><span>{label}</span><span className="font-mono">Rs {costs[k].toLocaleString('en-US')}</span></span>
      <input type="range" className="w-full accent-[var(--primary)]" min={min} max={max} step={step} value={costs[k]} onChange={(e) => setCosts({ ...costs, [k]: Number(e.target.value) })} data-testid={`slider-${k}`} aria-label={label} />
    </label>
  );
  const maxCost = p ? Math.max(...p.curve.map((c) => c.cost), 1) : 1;
  const x = (t: number) => ((t - 0.8) / 0.199) * 100;
  return (
    <Card data-testid="cost-slider">
      <CardHeader><CardTitle>Cost slider</CardTitle><CardDescription>Approve alone only if Pr(bad) × C<sub>wrong</sub> &lt; C<sub>review</sub> + (1 − Pr(bad)) × C<sub>delay</sub>. Default costs are labelled assumptions. Recomputed on {p?.dataset ?? 'the frozen test set'}.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {slider('wrongApproval', 'Wrong approval', 1000, 100000, 500)}
          {slider('review', 'Officer review', 50, 2000, 50)}
          {slider('delay', "Legitimate applicant's delay", 0, 2000, 50)}
        </div>
        {p && (
          <>
            <div className="flex flex-wrap items-end gap-6">
              <div><p className="text-xs text-muted-foreground">Auto-approval needs</p><p className="text-4xl font-black" data-testid="bar">{pct(p.threshold.required)}</p><p className="text-xs text-muted-foreground">cost bar {pct(p.threshold.costBar)} · floor {pct(p.threshold.floor)}</p></div>
              <div className="text-sm">
                <p>Wrong approvals: <strong>{p.at.wrongApprovals} / {p.at.badCases}</strong>{p.at.wrongApprovalUpper95 !== null && <span className="text-muted-foreground"> (95% upper bound {pct(p.at.wrongApprovalUpper95)}, rule of three)</span>}</p>
                <p>Clean cases sent to a person: {p.at.cleanEscalated} / {p.at.cleanCases}</p>
                <p>Officer hours per 100 cases: {p.at.officerHours} · expected cost Rs {p.at.expectedCost.toLocaleString('en-US')}</p>
                <p className="text-xs text-muted-foreground">computed in {p.ms} ms on the server{roundTrip !== null ? `, ${roundTrip} ms round trip` : ''}</p>
              </div>
            </div>
            <div aria-label="route split" data-testid="split">
              <div className="flex h-8 overflow-hidden rounded-xl">
                <div className="flex items-center justify-center bg-success text-xs text-void transition-[width] duration-700 ease-out" style={{ width: `${p.at.split.auto}%` }}>{p.at.split.auto} auto</div>
                <div className="flex items-center justify-center bg-warning text-xs text-warning-foreground transition-[width] duration-700 ease-out" style={{ width: `${p.at.split.proof}%` }}>{p.at.split.proof} proof</div>
                <div className="flex items-center justify-center bg-muted-foreground text-xs text-void transition-[width] duration-700 ease-out" style={{ width: `${p.at.split.person}%` }}>{p.at.split.person} person</div>
              </div>
            </div>
            <figure>
              <svg viewBox="0 0 100 40" className="h-40 w-full" preserveAspectRatio="none" role="img" aria-label="cost curve">
                <polyline fill="none" stroke="var(--muted-foreground)" strokeWidth="0.6" points={p.curve.map((c) => `${x(c.t)},${38 - (c.cost / maxCost) * 34}`).join(' ')} />
                <line x1={x(Math.min(0.999, p.threshold.required))} x2={x(Math.min(0.999, p.threshold.required))} y1="2" y2="38" stroke="var(--primary)" strokeWidth="0.6" />
                <circle cx={x(p.empiricalMin.t)} cy={38 - (p.empiricalMin.cost / maxCost) * 34} r="1.1" fill="var(--warning)" />
              </svg>
              <figcaption className="text-xs text-muted-foreground">Cost of routing the test set at each threshold from 80% to 99.9%. Line: the rule&apos;s threshold. Dot: the empirical minimum ({pct(p.empiricalMin.t)}). {p.agreesWithinOneBand ? 'They agree within one band.' : 'They disagree by more than one band: calibration is off on this set.'} The synthetic scores are bimodal, so moving the bar between 90% and 98% changes few routes on this set.</figcaption>
            </figure>
            <Button variant="outline" onClick={async () => {
              const r = await api('/api/v1/admin/config', { method: 'PUT', body: { key: 'decision.costs', value: { ...costs, note: 'set with the cost slider' } } });
              setMsg(r.status === 200 ? `Saved: the next decision needs ${pct(r.body.threshold.required)}.` : `${r.body.code}: ${r.body.detail}`);
            }} data-testid="save-costs">Save costs for this office</Button>
            {msg && <p role="status" className="text-sm">{msg}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

type Ratio = { value: number | null; num: number; den: number };
const R = ({ r }: { r: Ratio | null | undefined }) => (r ? <span className="font-mono">{r.value === null ? '—' : pct(r.value)} <span className="text-muted-foreground">({r.num}/{r.den})</span></span> : <span className="text-muted-foreground">not measured</span>);

/** EVAL-1: §25.2 metrics, each with its denominator and dataset, plus live operations */
export function EvalDashboard() {
  const [m, setM] = useState<{ report: Record<string, any> | null; live: Record<string, any> } | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [msg, setMsg] = useState<string | null>(null);
  const [v, setV] = useState(0);
  useEffect(() => { let alive = true; void api('/api/v1/eval/metrics').then((r) => { if (alive && r.status === 200) setM(r.body); }); return () => { alive = false; }; }, [v]);
  const rep = m?.report;
  const row = (cap: string, metric: string, value: React.ReactNode, target: string, ok: boolean | null, ds: string) => (
    <tr className="border-t border-border"><td className="p-2">{cap}</td><td className="p-2">{metric}</td><td className="p-2">{value}</td><td className="p-2 text-muted-foreground">{target}</td><td className="p-2">{ok === null ? <Badge variant="outline">n/a</Badge> : ok ? <Badge variant="success">met</Badge> : <Badge variant="destructive">not met</Badge>}</td><td className="p-2 text-xs text-muted-foreground">{ds}</td></tr>
  );
  return (
    <Card data-testid="eval-dashboard">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <div><CardTitle>Evaluation dashboard</CardTitle><CardDescription>Every figure with its denominator. {rep ? `Report from ${new Date(rep.generatedAt).toLocaleString()} · ${rep.versions.scorer} · ${rep.versions.matcher} · ${rep.versions.datasets}` : 'No report yet.'}</CardDescription></div>
        <Button size="sm" variant="outline" onClick={async () => { const r = await api('/api/v1/eval/runs', { method: 'POST' }); setMsg(r.status === 202 ? 'Evaluation started; refresh in a minute.' : r.body.detail); setTimeout(() => setV((x) => x + 1), 20000); }}>Run evaluation</Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {msg && <p role="status" className="text-sm">{msg}</p>}
        {rep && (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-muted-foreground"><th className="p-2 text-start">Capability</th><th className="p-2 text-start">Metric</th><th className="p-2 text-start">Result</th><th className="p-2 text-start">Target</th><th className="p-2 text-start" /><th className="p-2 text-start">Dataset</th></tr></thead>
            <tbody>
              {row('Decision routing', 'Wrong approvals (bad auto-approved ÷ bad)', <><R r={rep.routing.wrongApprovals} /> {rep.routing.wrongApprovalUpper95 !== null && <span className="text-xs text-muted-foreground">95% upper bound {pct(rep.routing.wrongApprovalUpper95)}</span>}</>, '0', rep.routing.wrongApprovals.num === 0, rep.routing.dataset)}
              {row('Decision routing', 'Unnecessary escalations (clean → person ÷ clean)', <R r={rep.routing.unnecessaryEscalations} />, '≤ 50%', rep.routing.unnecessaryEscalations.value <= 0.5, rep.routing.dataset)}
              {row('Calibration', 'ECE (calibration set / test, scored categories)', <span className="font-mono">{rep.calibration.eceCalibration} / {rep.calibration.eceTestScored}</span>, '≤ 0.05', rep.calibration.eceTestScored <= 0.05, `${rep.calibration.dataset}; all categories ${rep.calibration.eceTestAll}`)}
              {row('Scam check', 'Precision of "fake"', <R r={rep.scam.precisionFake} />, '≥ 95%', rep.scam.precisionFake.value >= 0.95, rep.scam.dataset)}
              {row('Scam check', 'Recall of "fake"', <R r={rep.scam.recallFake} />, '≥ 90%', rep.scam.recallFake.value >= 0.9, rep.scam.dataset)}
              {row('Scam check', 'False alarms on genuine', <R r={rep.scam.falseAlarmsOnGenuine} />, '≤ 2%', rep.scam.falseAlarmsOnGenuine.value <= 0.02, rep.scam.dataset)}
              {row('Scam check', '"Not sure" rate', <R r={rep.scam.notSureRate} />, '≤ 15%', rep.scam.notSureRate.value <= 0.15, rep.scam.dataset)}
              {row('Record matching', 'Auto-match precision / recall / review zone', <span className="font-mono">{rep.matcher.auto_match_precision} / {rep.matcher.recall_auto_match} / {pct(rep.matcher.review_zone_rate)}</span>, '1.00 / ≥ 0.90 / ≤ 10%', rep.matcher.auto_match_precision === 1 && rep.matcher.recall_auto_match >= 0.9 && rep.matcher.review_zone_rate <= 0.1, rep.matcher.dataset)}
              {row('Document integrity', 'Edited and forged caught', <R r={rep.documents.editedAndForgedCaught} />, '100%', rep.documents.editedAndForgedCaught.value === 1, rep.documents.dataset)}
              {row('Document integrity', 'Clean documents flagged', <R r={rep.documents.cleanFlagged} />, '≤ 1%', rep.documents.cleanFlagged.value <= 0.01, rep.documents.dataset)}
              {row('RAG', 'Expected clause in the top 4 retrieved', <R r={rep.rag.retrievalHitAt4} />, '—', null, rep.rag.dataset)}
              {row('RAG', 'Citation accuracy / correct refusals', <span className="text-muted-foreground">needs the answering model</span>, '≥ 95% / ≥ 90%', null, rep.rag.dataset)}
              {row('Voice', 'WER on names; digit accuracy', <span className="text-muted-foreground">needs audio + a speech key</span>, 'report; ≥ 95%', null, rep.voice.dataset)}
              {row('Jev', 'Label-swap changes', rep.jevLabelSwap.changed ? <R r={rep.jevLabelSwap.changed} /> : <span className="text-muted-foreground">{rep.jevLabelSwap.note ?? 'needs the gateway key'}</span>, '≤ 5%', rep.jevLabelSwap.changed ? (rep.jevLabelSwap.changed.value ?? 1) <= 0.05 : null, rep.jevLabelSwap.dataset)}
            </tbody></table></div>
        )}
        {rep && (
          <div>
            <h4 className="mb-1 text-sm font-semibold">Reliability by probability band (D1 test)</h4>
            <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-muted-foreground"><th className="p-1 text-start">Band</th><th className="p-1 text-start">n</th><th className="p-1 text-start">Mean predicted</th><th className="p-1 text-start">Observed legitimate</th></tr></thead>
              <tbody>{rep.calibration.reliability.map((b: { band: string; n: number; meanP: number | null; observedLegit: number | null }) => <tr key={b.band} className="border-t border-border"><td className="p-1 font-mono">{b.band}</td><td className="p-1">{b.n}</td><td className="p-1">{b.meanP ?? '—'}</td><td className="p-1">{b.observedLegit ?? '—'}</td></tr>)}</tbody></table></div>
          </div>
        )}
        {m?.live && (
          <div className="text-sm">
            <h4 className="mb-1 font-semibold">Live (this office)</h4>
            <p>Pipeline p50 / p95: {m.live.pipelineMs.p50 ?? '—'} / {m.live.pipelineMs.p95 ?? '—'} ms (n={m.live.pipelineMs.n}) · cost per case {m.live.costPerCaseUsd === null ? '—' : `$${m.live.costPerCaseUsd}`} · officer overrides <R r={m.live.officerOverrides} /></p>
            <div className="mt-2 overflow-x-auto" data-testid="stage-latency">
              <h5 className="text-xs font-semibold">Speed per pipeline stage</h5>
              {m.live.stageMs.length === 0 ? <p className="text-xs text-muted-foreground">No finished cases with timings yet.</p> : (
                <table className="w-full text-xs"><thead><tr className="text-muted-foreground"><th className="text-start">Stage</th><th className="text-end">p50 ms</th><th className="text-end">p95 ms</th><th className="text-end">cases</th><th className="text-start ps-3">period</th></tr></thead>
                  <tbody>{m.live.stageMs.map((x: { stage: string; n: number; p50: number; p95: number; from: string | null; to: string | null }) => <tr key={x.stage} className="border-t border-border"><td>{x.stage}</td><td className="text-end tabular-nums">{x.p50}</td><td className="text-end tabular-nums">{x.p95}</td><td className="text-end tabular-nums">{x.n}</td><td className="ps-3">{x.from?.slice(0, 10)} to {x.to?.slice(0, 10)}</td></tr>)}</tbody></table>
              )}
            </div>
            <p className="mt-2 text-xs" data-testid="ai-cost">AI cost: {m.live.cost.perCaseUsd === null ? 'no model calls on cases yet' : `$${m.live.cost.perCaseUsd} per case (total $${m.live.cost.totalUsd} over ${m.live.cost.cases} cases, ${m.live.cost.aiCalls} model calls, ${m.live.cost.from?.slice(0, 10)} to ${m.live.cost.to?.slice(0, 10)})`}</p>
            <p className="text-xs text-muted-foreground">AI calls: {m.live.aiCalls.map((a: { purpose: string; n: number; errors: number; p50: number | null }) => `${a.purpose} ${a.n} (${a.errors} not ok, p50 ${a.p50 ?? '—'} ms)`).join(' · ') || 'none yet'}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
