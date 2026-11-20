import { defineConfig, devices } from '@playwright/test';

/** E2E against a running app: E2E_BASE_URL (default http://localhost:3100, i.e. `pnpm start` on port 3100). */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3100',
    ...devices['Pixel 7'],
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
    serviceWorkers: 'allow',
  },
  projects: [{ name: 'mobile-chromium', use: { browserName: 'chromium' } }],
});
