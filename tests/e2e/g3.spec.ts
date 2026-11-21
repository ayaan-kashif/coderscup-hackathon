import { devices, expect, test, type Browser } from '@playwright/test';

/**
 * Demo beats 4 and 7 (PRD §34) plus the auditor console, on fresh demo data (pnpm demo:reset), after g2.
 *  4 the admin edits a rule; the Twin lists affected cases; a second admin approves; publish; in-flight cases → S11
 *  7 the cost slider moves the bar from 98.0% to 90.4%; Break It runs in the sandbox and shows every result
 */
test.describe.configure({ mode: 'serial' });

async function as(browser: Browser, role: string, email?: string) {
  const ctx = await browser.newContext({ ...devices['Desktop Chrome'], serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.goto('/');
  const r = await page.request.post('/api/v1/demo/tokens', { data: { role, ...(email ? { email } : {}) } });
  expect(r.status()).toBe(201);
  return { ctx, page };
}

test('beat 4 — a rule changes: dropdown edit, Twin, second admin, publish, re-decide with S11', async ({ browser }) => {
  const sana = await as(browser, 'admin');
  await sana.page.goto('/a');
  await sana.page.getByTestId('new-draft').click();
  await expect(sana.page.getByText(/Version \d+/).first()).toBeVisible();
  // the income limit becomes Rs 5,000: Fatima's open case (Rs 9,000) would get worse
  await sana.page.getByTestId('value-R-INCOME').fill('5000');
  await sana.page.getByTestId('save-draft').click();
  await expect(sana.page.getByTestId('rules-msg')).toContainText('Saved');
  await sana.page.getByTestId('run-twin').click();
  await expect(sana.page.getByTestId('harm')).not.toContainText(/^0 /, { timeout: 30_000 });
  await sana.page.getByTestId('publish').click();
  await expect(sana.page.getByTestId('rules-msg')).toContainText('second admin');
  const draftVersion = (await sana.page.getByText(/^Version \d+/).first().textContent())!.match(/\d+/)![0];

  const omar = await as(browser, 'admin', 'admin.second.omar@sindh.amanat.test');
  await omar.page.goto('/a');
  await omar.page.getByTestId(`version-${draftVersion}`).click();
  await omar.page.getByTestId('second-approve').click();
  await expect(omar.page.getByTestId('rules-msg')).toContainText('second admin');
  await omar.ctx.close();

  await sana.page.reload();
  await sana.page.getByTestId(`version-${draftVersion}`).click();
  await sana.page.getByTestId('publish').click();
  await expect(sana.page.getByTestId('rules-msg')).toContainText(`Published v${draftVersion}`);
  // the open case that would get worse is now with an officer under S11; old decisions keep their version
  const officer = await as(browser, 'officer');
  await expect.poll(async () => (await (await officer.page.request.get('/api/v1/queue?stop=S11')).json()).items.length, { timeout: 30_000 }).toBeGreaterThan(0);
  await officer.ctx.close();
  await sana.ctx.close();
});

test('beat 7 — the cost slider: 98.0% at Rs 25,000, 90.4% at Rs 5,000, under 2 seconds', async ({ browser }) => {
  const { ctx, page } = await as(browser, 'admin');
  await page.goto('/a/evaluation');
  await expect(page.getByTestId('bar')).toHaveText('98.0%', { timeout: 15_000 });
  const t0 = Date.now();
  await page.getByTestId('slider-wrongApproval').fill('5000');
  await expect(page.getByTestId('bar')).toHaveText('90.4%');
  expect(Date.now() - t0).toBeLessThan(2000);
  await expect(page.getByTestId('eval-dashboard')).toContainText('Wrong approvals');
  await ctx.close();
});

test('beat 7 — Break It runs 18 attacks + controls in the sandbox; every result is listed, misses included', async ({ browser }) => {
  test.setTimeout(240_000);
  const real = await as(browser, 'admin');
  await real.page.goto('/a/break-it');
  await expect(real.page.getByTestId('run-breakit')).toBeDisabled();
  await real.ctx.close();
  const { ctx, page } = await as(browser, 'admin', 'admin.breakit@sandbox.amanat.test');
  await page.goto('/a/break-it');
  await page.getByTestId('run-breakit').click();
  await expect(page.getByTestId('breakit-results').locator('tbody tr')).toHaveCount(43, { timeout: 200_000 });
  await expect(page.getByTestId('breakit-tally')).toContainText('Attacks');
  expect(await page.locator('[data-result="missed"]').count()).toBe(0);
  await ctx.close();
});

test('auditor — search decisions, open a trace, replay identical, verify the chain', async ({ browser }) => {
  const { ctx, page } = await as(browser, 'auditor');
  await page.goto('/au');
  await page.getByTestId('search-decisions').click();
  await page.getByTestId('decision-results').locator('button').filter({ hasText: 'case decision' }).first().click();
  await expect(page.getByTestId('trace')).toContainText('inputHash');
  await page.getByTestId('replay').click();
  await expect(page.getByTestId('replay-verdict')).toContainText('identical');
  await page.goto('/au/chain');
  await page.getByRole('button', { name: /Verify/ }).first().click();
  await expect(page.getByText(/intact/i).first()).toBeVisible();
  await ctx.close();
});
