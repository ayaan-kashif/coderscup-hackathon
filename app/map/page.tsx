import { getDb } from '@/db/client';
import { PageFrame } from '@/components/shell/page-frame';
import { PublicHeatMap } from '@/components/officer/public-heat-map';
import { SimulatedBadge } from '@/components/shell/simulated-badge';
import { scamMap } from '@/services/scam';

export const dynamic = 'force-dynamic';

/** approximate positions of the programme's districts (for a schematic map; not to scale) */
const POS: Record<string, [number, number]> = {
  LHR: [78, 18], FSD: [66, 22], MUL: [55, 38], BWP: [60, 46], RJP: [45, 52], SKR: [38, 62], KHS: [36, 68], HYD: [33, 84], BDN: [36, 92], TTA: [24, 90], THP: [48, 90],
};

/** SCAM-5 public Scam Map: confirmed scams by district (last 7 days), spike flags, no personal data, < 3 shows no count */
export default async function ScamMapPage() {
  const rows = await scamMap(getDb(), 7);
  const n = (v: number | string) => (typeof v === 'number' ? v : 2);
  return (
    <PageFrame width="max-w-5xl" title={<>Scam Map <SimulatedBadge what="Saaya programme" /></>}>
      <p className="text-muted-foreground">Confirmed fake messages reported in the last 7 days. Districts with fewer than 3 reports show no exact count. Nothing here identifies a person.</p>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <PublicHeatMap fallback={
        <svg viewBox="0 0 100 100" className="w-full rounded-3xl border border-white/10 bg-bento" role="img" aria-label="district map">
          {Object.entries(POS).map(([code, [x, y]]) => {
            const d = rows.find((r) => r.code === code);
            const r = d ? 2 + Math.sqrt(n(d.total)) * 1.6 : 1.2;
            return (
              <g key={code}>
                <circle cx={x} cy={y} r={r} fill={d?.spike ? 'var(--destructive)' : d ? 'var(--primary)' : 'var(--muted-foreground)'} fillOpacity={d ? 0.7 : 0.3} />
                <text x={x + r + 1} y={y + 1.2} fontSize="3.2" fill="currentColor">{code}{d?.spike ? ' ⚠' : ''}</text>
              </g>
            );
          })}
        </svg>
        } />
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="scam-map-table">
            <thead><tr className="text-muted-foreground"><th className="p-2 text-start">District</th><th className="p-2 text-start">Today</th><th className="p-2 text-start">7 days</th><th className="p-2 text-start">Most common</th><th className="p-2 text-start">Spike</th></tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.code} className="border-t border-border"><td className="p-2">{d.name}</td><td className="p-2">{String(d.today)}</td><td className="p-2">{String(d.total)}</td><td className="p-2">{d.topType?.replace(/_/g, ' ') ?? '—'}</td><td className="p-2">{d.spike ? <span className="font-bold text-destructive">⚠ spike</span> : '—'}</td></tr>
              ))}
              {!rows.length && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">No confirmed scams this week.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </PageFrame>
  );
}
