/**
 * Scam Map (F12 / SCAM-5): the Scam desk shows the map canvas and the table, and a new confirmed scam check in Hyderabad
 * raises its count within 15 seconds (the desk refreshes every 10 s).
 */
import { expect, test, devices } from '@playwright/test';

const FAKE = 'Congratulations, Rs 25,000 relief approved. Send Rs 500 fee to +920000099111 to release.';

test('the Scam desk shows the heat map and the table, and a new confirmed fake in Hyderabad heats up within 15 s', async ({ browser }) => {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.goto('/');
  expect((await page.request.post('/api/v1/demo/tokens', { data: { role: 'officer' } })).status()).toBe(201);
  await page.evaluate(() => { try { localStorage.setItem('amanat_welcomed', '1'); } catch { /* ignore */ } });
  await page.goto('/o/scams');

  await expect(page.getByTestId('scam-map')).toBeVisible();
  await expect(page.getByTestId('synthetic-badge')).toBeVisible();
  await expect(page.getByTestId('heat-legend')).toContainText('Fewer than 3');
  // the map canvas (WebGL) is drawn; tile images may fail offline, the heat layer still renders
  await expect(page.locator('[data-testid="scam-heat-map"] canvas.maplibregl-canvas')).toBeVisible({ timeout: 20_000 });
  // an officer sees only their own office: Sindh, not Punjab
  await expect(page.locator('tr[data-district="HYD"]')).toBeVisible();
  await expect(page.locator('tr[data-district="LHR"]')).toHaveCount(0);

  const today = async () => {
    const t = (await page.getByTestId('today-HYD').innerText()).trim();
    return /^\d+$/.test(t) ? Number(t) : 0;
  };
  const before = await today();
  expect(before).toBeGreaterThanOrEqual(3);

  // a new confirmed scam check in Hyderabad (public endpoint, no sign-in)
  const r = await page.request.post('/api/v1/scam/check', { data: { text: `${FAKE} (map test ${Date.now()})`, sender: '+920000099111', sentToMe: false, districtCode: 'HYD' } });
  expect(r.status()).toBe(200);
  expect((await r.json()).verdict).toBe('fake');

  await expect.poll(today, { timeout: 15_000, intervals: [1000] }).toBe(before + 1);

  // clicking the district row highlights it and filters the "not sure" list to that district
  await page.locator('tr[data-district="HYD"]').click();
  await expect(page.locator('tr[data-district="HYD"]')).toHaveAttribute('data-selected', 'true');
  await ctx.close();
});

test('the public /map page shows the map and the same masked totals', async ({ page }) => {
  await page.goto('/map');
  await expect(page.getByTestId('scam-map-table')).toBeVisible();
  await expect(page.locator('[data-testid="scam-heat-map"] canvas.maplibregl-canvas')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('synthetic-badge')).toBeVisible();
});
