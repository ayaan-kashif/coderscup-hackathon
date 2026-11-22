/** The WhatsApp login must never be committed, and the gateway secret must never reach the browser. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const git = (...args: string[]) => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } };

describe('repo hygiene', () => {
  it('git tracks nothing under wa-gateway/auth/ (it is a live WhatsApp login)', () => {
    const tracked = git('ls-files', 'wa-gateway/auth');
    if (tracked === null) return; // not a git checkout
    expect(tracked.trim()).toBe('');
  });

  it('wa-gateway/auth/, wa-gateway/.env and the sign-in list are git-ignored', () => {
    if (git('rev-parse', '--is-inside-work-tree') === null) return;
    for (const f of ['wa-gateway/auth/creds.json', 'wa-gateway/auth/app-state-sync-key-1.json', 'wa-gateway/.env', 'STAFF-LOGINS.txt']) {
      expect(git('check-ignore', f), f).not.toBeNull();
    }
  });

  it('no WA_GATEWAY_URL or WA_GATEWAY_SECRET is exposed through a NEXT_PUBLIC_ variable', () => {
    const files = [...walk('src'), ...walk('app')].filter((f) => /\.(ts|tsx)$/.test(f));
    for (const f of files) expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/NEXT_PUBLIC_(WA_|OTP_)/);
    expect(fs.readFileSync('.env.example', 'utf8')).not.toMatch(/NEXT_PUBLIC_(WA_|OTP_)/);
  });

  it('the secret value is not in the built client bundle (.next/static), when a build and WA_GATEWAY_SECRET are present', () => {
    const secret = process.env.WA_GATEWAY_SECRET;
    const dir = path.join(root, '.next', 'static');
    if (!secret || secret.length < 24 || !fs.existsSync(dir)) return;
    for (const f of walk(dir)) {
      if (!/\.(js|css|html|json|txt|map)$/.test(f)) continue;
      expect(fs.readFileSync(f, 'utf8').includes(secret), f).toBe(false);
    }
  });
});

function walk(d: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(d)) return out;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') out.push(...walk(p)); } else out.push(p);
  }
  return out;
}
