import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 120000,
    coverage: { include: ['src/domain/**'], thresholds: { lines: 70 } },
  },
});
