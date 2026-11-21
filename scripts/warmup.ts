/**
 * pnpm warmup [BASE_URL] — demo-day warm-up: wakes every function and page the §34 demo touches, signs in each demo
 * role, checks the mocks and the audit chain, and prints a pass/fail table with timings. Exit code 1 if anything fails.
 *
 *   pnpm warmup https://amanat.example.vercel.app
 */
const BASE = (process.argv[2] ?? process.env.BASE_URL ?? 'http://localhost:3100').replace(/\/$/, '');
type Row = { step: string; status: number | string; ms: number; ok: boolean };
const rows: Row[] = [];

async function hit(step: string, path: string, init: RequestInit = {}, ok = (s: number) => s >= 200 && s < 400) {
  const t0 = Date.now();
  try {
    const r = await fetch(BASE + path, { redirect: 'manual', ...init });
    rows.push({ step, status: r.status, ms: Date.now() - t0, ok: ok(r.status) });
    return r;
  } catch (e) {
    rows.push({ step, status: String(e).slice(0, 40), ms: Date.now() - t0, ok: false });
    return null;
  }
}

async function token(role: string, email?: string) {
  const r = await hit(`demo token: ${role}${email ? ` (${email.split('@')[0]})` : ''}`, '/api/v1/demo/tokens', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role, ...(email ? { email } : {}) }) });
  return r ? ((await r.json()) as { token?: string }).token ?? null : null;
}

async function main() {
  await hit('health', '/api/v1/health');
  const status = await hit('status (DB, mocks, chains)', '/api/v1/status');
  for (const p of ['/', '/c', '/h', '/o', '/a', '/au', '/login', '/mock/phone', '/map', '/status', '/api/docs', '/voice/ur/manifest.json', '/sw.js']) await hit(`page ${p}`, p);
  const tokens: Record<string, string | null> = {
    citizen: await token('citizen'), helper: await token('helper'), officer: await token('officer'), admin: await token('admin'), auditor: await token('auditor'),
    sandbox: await token('admin', 'admin.breakit@sandbox.amanat.test'),
  };
  const auth = (t: string | null | undefined) => ({ headers: { authorization: `Bearer ${t}` } });
  await hit('citizen: my cases', '/api/v1/me/cases', auth(tokens.citizen));
  await hit('helper: families', '/api/v1/helper/families', auth(tokens.helper));
  await hit('officer: queue', '/api/v1/queue', auth(tokens.officer));
  await hit('officer: scam alerts', '/api/v1/scam/alerts', auth(tokens.officer));
  await hit('admin: rules', '/api/v1/rules', auth(tokens.admin));
  await hit('admin: cost preview', '/api/v1/eval/cost-preview', { method: 'POST', headers: { authorization: `Bearer ${tokens.admin}`, 'content-type': 'application/json' }, body: JSON.stringify({ wrongApproval: 5000, review: 300, delay: 200 }) });
  await hit('admin: evaluation', '/api/v1/eval/metrics', auth(tokens.admin));
  await hit('sandbox: Break It runs', '/api/v1/eval/runs?kind=break_it', auth(tokens.sandbox));
  await hit('auditor: decision search', '/api/v1/decisions', auth(tokens.auditor));
  await hit('auditor: verify chain', '/api/v1/audit/verify', { method: 'POST', headers: { authorization: `Bearer ${tokens.auditor}`, 'content-type': 'application/json' }, body: '{}' });
  await hit('mock: identity registry', '/api/mock/identity/00000-1234567-2');
  await hit('mock: issuer keys', '/api/mock/issuer/keys');
  await hit('public: scam map', '/api/v1/scam/map');
  console.table(rows.map((r) => ({ ...r, ok: r.ok ? '✓' : '✗' })));
  const s = status ? ((await status.clone().json().catch(() => null)) as { overall?: string } | null) : null;
  const failed = rows.filter((r) => !r.ok);
  console.log(`${BASE}: ${rows.length - failed.length}/${rows.length} ok · status ${s?.overall ?? '?'} · slowest ${Math.max(...rows.map((r) => r.ms))} ms`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
