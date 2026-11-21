/**
 * pnpm test:summary — runs the whole Vitest suite with the JSON reporter and writes data/test-summary.json, which
 * /status shows as "last test-suite pass count" (PRD P3). Commit the file with a release.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const out = path.join(os.tmpdir(), `vitest-${Date.now()}.json`);
try {
  execSync(`pnpm exec vitest run --reporter=json --outputFile=${out}`, { stdio: ['ignore', 'ignore', 'inherit'] });
} catch { /* failures are recorded below */ }
const r = JSON.parse(fs.readFileSync(out, 'utf8')) as { numPassedTests: number; numFailedTests: number; testResults: { name: string; assertionResults: { status: string }[] }[] };
const suites: Record<string, number> = {};
for (const f of r.testResults) {
  const kind = f.name.replace(/\\/g, '/').match(/tests\/(\w+)\//)?.[1] ?? 'other';
  suites[kind] = (suites[kind] ?? 0) + f.assertionResults.filter((a) => a.status === 'passed').length;
}
const summary = { passed: r.numPassedTests, failed: r.numFailedTests, files: r.testResults.length, at: new Date().toISOString(), suites };
fs.writeFileSync('data/test-summary.json', JSON.stringify(summary, null, 1) + '\n');
console.log(JSON.stringify(summary));
process.exit(r.numFailedTests ? 1 : 0);
