import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 'server-only' guards modules from client bundles; in tests it resolves to its empty server build
  resolve: { tsconfigPaths: true, alias: { 'server-only': new URL('./node_modules/server-only/empty.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 120000,
    coverage: { include: ['src/domain/**'], thresholds: { lines: 70 } },
  },
});
