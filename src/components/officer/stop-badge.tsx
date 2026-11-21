const NAMES: Record<string, string> = {
  S1: 'Identity ambiguous', S2: 'Evidence conflict', S3: 'Unreadable', S4: 'No rule decides', S5: 'Duplicate', S6: 'Integrity',
  S7: 'Anomaly', S8: 'Service down', S9: 'Injection', S10: 'Second opinion', S11: 'Rule change harm', S12: 'High stakes',
};
const SEVERE = new Set(['S2', 'S6', 'S7']);

export function StopBadge({ code, suffix = '' }: { code: string; suffix?: string }) {
  return (
    <span title={NAMES[code] ?? code} className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ${SEVERE.has(code) ? 'bg-destructive text-void' : 'bg-warning text-warning-foreground'}`}>
      {code} {NAMES[code] ?? ''}{suffix}
    </span>
  );
}

/** source chips on every fact (§16.2) */
const SOURCE: Record<string, [string, string]> = {
  registry: ['Registry', 'bg-primary text-primary-foreground'], qr_signed: ['Signed QR', 'bg-success text-success-foreground'], officer: ['Officer', 'bg-foreground text-background'],
  ocr: ['OCR', 'bg-secondary text-secondary-foreground'], voice: ['Voice', 'bg-secondary text-secondary-foreground'], self_declared: ['Self-declared', 'bg-muted text-muted-foreground'],
};
export function SourceChip({ source }: { source: string }) {
  const [label, cls] = SOURCE[source] ?? [source, 'bg-muted'];
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${cls}`}>{label}</span>;
}
