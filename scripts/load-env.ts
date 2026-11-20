import fs from 'node:fs';

/** Minimal .env.local / .env loader for scripts (Next.js loads these itself for the app). */
export function loadEnvFiles(files = ['.env.local', '.env']) {
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const [, k, raw] = m;
      if (process.env[k!] !== undefined) continue;
      process.env[k!] = raw!.replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}
