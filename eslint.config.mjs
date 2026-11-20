import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'node_modules/**', 'ml/**', 'coverage/**', 'public/sw.js', 'next-env.d.ts', 'src/db/migrations/**']),
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      // the decision core is pure: no clocks, no randomness, no I/O
      'no-restricted-properties': ['error',
        { object: 'Date', property: 'now', message: 'src/domain is pure: pass time in the snapshot.' },
        { object: 'Math', property: 'random', message: 'src/domain is deterministic.' }],
      'no-restricted-syntax': ['error',
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'src/domain is pure: no new Date() without an argument.' }],
      'no-restricted-imports': ['error', { patterns: ['node:*', 'fs', 'path', 'crypto', '@/db/*', '@/services/*', '@/lib/*', 'next/*', 'postgres', 'drizzle-orm*'] }],
    },
  },
]);
