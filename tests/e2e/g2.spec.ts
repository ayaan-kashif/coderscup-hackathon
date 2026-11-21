import path from 'node:path';
import { devices, expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * Gates G2/G3 in the browser, on a freshly reset demo database (pnpm demo:reset), demo beats from PRD §34:
 *  1 fake relief SMS → "Is this real?" → fake; an officer approves the district alert
 *  2 a widow applies on a dropping signal: one grey tick offline, two grey ticks on reconnect, exactly one case
 *  3 the two-Fatima case: stop S1, summary, candidates; the officer approves with a reason; replay identical
 *  5 a helper unlocks a family with the family's PIN; one wallet on two families freezes both; "press 9" on the old number
 *  6 the widow withdraws consent; the officer sees "Access withdrawn" (403); her access log shows the refusal
 */
test.describe.configure({ mode: 'serial' });

const PIN = process.env.DEMO_CITIZEN_PIN ?? '';
const docs = (f: string) => path.resolve(__dirname, '../../data/documents', f);

async function as(browser: Browser, role: 'citizen' | 'officer' | 'helper' | 'auditor'): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.goto('/');
  const r = await page.request.post('/api/v1/demo/tokens', { data: { role } });
  expect(r.status()).toBe(201);
  await page.evaluate(() => { try { localStorage.setItem('amanat_welcomed', '1'); } catch { /* ignore */ } });
  return { ctx, page };
}

test('beat 2 — apply by icons, keypad and camera on a dropping signal; ticks; exactly one case', async ({ browser }) => {
  test.skip(!PIN, 'DEMO_CITIZEN_PIN not set');
  const { ctx, page } = await as(browser, 'citizen');
  await page.goto('/c');
  await expect(page.getByTestId('trust-header')).toBeVisible();
  await page.getByTestId('tile-apply').click();
  // name and husband's name: no microphone here → icons ("use the name on my card"), never a guess
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: /Speak/ }).click();
    await page.getByRole('button', { name: /Use the name on my card/ }).click();
  }
  await page.getByRole('button', { name: /Skip/ }).click(); // CNIC: the card photo carries it
  await page.getByTestId('district-BDN').click();
  await page.getByTestId('answer-yes').click();
  await page.getByTestId('answer-no').click();
  for (const d of '8000') await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByTestId('keypad-ok').click();
  await page.getByRole('button', { name: /Skip/ }).click(); // wallet: already on file
  for (const [f, title] of [['persona-zarina-cnic_front.png', 'front'], ['persona-zarina-cnic_back.png', 'back']] as const) {
    await expect(page.getByRole('heading', { level: 2 })).toContainText(title);
    await page.getByTestId('camera-input').setInputFiles(docs(f));
    await expect(page.getByTestId('blur-meter')).toContainText('Clear');
    await page.getByTestId('photo-accept').click();
  }
  // CIT-5: a blurry certificate is caught on the phone before any upload
  await expect(page.getByRole('heading', { level: 2 })).toContainText('Death certificate');
  await page.getByTestId('camera-input').setInputFiles(docs('persona-zarina-death_certificate-blurred.png'));
  await expect(page.getByTestId('blur-meter')).toContainText('Not clear');
  await expect(page.getByTestId('photo-accept')).toHaveCount(0);
  // the signal drops: the clear retake is saved on the phone only (one grey tick)
  await ctx.setOffline(true);
  await page.getByTestId('camera-input').setInputFiles(docs('persona-zarina-death_certificate.png'));
  await page.getByTestId('photo-accept').click();
  await page.getByTestId('submit').click();
  await page.getByRole('button', { name: /Home/ }).click();
  await expect(page.locator('[data-testid="outbox"] [data-tick="grey1"]').first()).toBeVisible();
  // the signal returns: the outbox resends with the same keys → two grey ticks, no duplicate
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('[data-testid="outbox"] [data-tick="grey1"]')).toHaveCount(0, { timeout: 30_000 });
  const mine = await (await page.request.get('/api/v1/me/cases')).json();
  expect(mine.items).toHaveLength(1);
  // the pipeline runs; the status screen shows the checks as icons
  await page.reload();
  await page.getByTestId('tile-status').click();
  await expect(page.getByTestId('case-status')).not.toHaveAttribute('data-status', /submitted|processing/, { timeout: 60_000 });
  await ctx.close();
});

test('beat 3 — the two-Fatima case: S1, summary and candidates; approve with a reason; replay identical', async ({ browser }) => {
  const { ctx, page } = await as(browser, 'officer');
  await page.goto('/o');
  const row = page.locator('[data-testid="queue"] tr', { hasText: 'S1' }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByTestId('lead')).toContainText('S1');
  await expect(page.getByTestId('summary')).toContainText('Why the system stopped');
  expect(await page.locator('[data-testid="matches"] > div').count()).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId('rule-trace')).toBeVisible();
  // a reject without a reason code is refused by the server
  await page.keyboard.press('r');
  await page.getByTestId('note').fill('trying without a reason code');
  await page.getByTestId('confirm').click();
  await expect(page.getByRole('status')).toContainText('VALIDATION_FAILED');
  await page.keyboard.press('a');
  await page.getByTestId('reason').selectOption('identity_confirmed_by_document');
  await page.getByTestId('note').fill("Husband's name on the certificate matches candidate B");
  await page.getByTestId('confirm').click();
  await expect(page.getByRole('status')).toContainText('APPROVED');
  await page.getByRole('button', { name: 'Replay decision' }).click();
  await expect(page.getByTestId('replay-result')).toContainText('identical');
  await ctx.close();
});

test('beat 5 — helper unlocks with the family PIN; one wallet on two families freezes both; press 9', async ({ browser }) => {
  test.skip(!PIN, 'DEMO_CITIZEN_PIN not set');
  const { ctx, page } = await as(browser, 'helper');
  await page.goto('/h');
  const cards = page.getByTestId('family-card');
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeLessThanOrEqual(40);
  // H2: the family enters its own PIN; H3: a banner with the family's name and a countdown
  await cards.filter({ hasText: 'draft' }).first().click();
  for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByTestId('unlock-ok').click();
  await expect(page.getByTestId('family-banner')).toBeVisible();
  await expect(page.getByTestId('countdown')).toContainText(/1[12]\d:|119:|120:|\d+:/);
  await page.getByRole('button', { name: 'Lock' }).click();
  // the anomaly through the same API the screens use: the helper enters one wallet for two families
  const fam = (await (await page.request.get('/api/v1/helper/families')).json()).families.filter((f: { case: { status: string } | null }) => f.case?.status === 'draft').slice(0, 2);
  for (const f of fam) {
    expect((await page.request.post('/api/v1/helper/grants', { data: { citizenId: f.citizenId, pin: PIN } })).status()).toBe(201);
    const r = await page.request.patch(`/api/v1/cases/${f.case.id}/answers`, { data: { answers: [{ question: 'wallet', value: '0000009999', via: 'keypad' }] } });
    expect(r.status()).toBe(200);
  }
  await page.reload();
  await expect(page.getByText('⚑ frozen')).toHaveCount(2, { timeout: 10_000 });
  await ctx.close();

  // payout change: the citizen asks (PIN), the officer approves, the old number gets "press 9"
  const cit = await as(browser, 'citizen');
  const req = await cit.page.request.post('/api/v1/payout-changes', { data: { walletDigits: '0000004417', pin: PIN }, headers: { 'Idempotency-Key': `e2e-payout-${Date.now()}` } });
  expect(req.status()).toBe(201);
  const off = await as(browser, 'officer');
  await off.page.goto('/o/payouts');
  await off.page.getByTestId('payout-approve').first().click();
  await expect(off.page.getByRole('status')).toContainText('cooling-off');
  await cit.page.goto('/mock/phone?phone=%2B920000000001');
  await cit.page.getByTestId('press-9').first().click();
  await expect(cit.page.getByRole('status')).toContainText('frozen');
  await cit.ctx.close();
  await off.ctx.close();
});

test('beat 1 — the fake relief SMS is fake; Hyderabad drafts an alert; an officer approves it', async ({ browser }) => {
  const { ctx, page } = await as(browser, 'citizen');
  await page.goto('/mock/phone?phone=%2B920000000001');
  await page.getByTestId('demo-scam-sms').click();
  const msg = page.locator('li', { hasText: 'Rs 25,000 relief approved' }).first();
  await msg.getByRole('link', { name: /Is this real/ }).click();
  await expect(page.getByTestId('real-text')).toHaveValue(/25,000/);
  await page.getByTestId('sent-to-me').click();
  await page.getByTestId('real-district').selectOption('HYD');
  await page.getByTestId('real-check').click();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-verdict', 'fake');
  await expect(page.getByTestId('verdict')).toContainText('never charges fees');
  await ctx.close();
  const off = await as(browser, 'officer');
  await off.page.goto('/o/scams');
  await off.page.getByTestId('alert-approve').first().click();
  await expect(off.page.getByRole('status')).toContainText('Alert approved');
  await off.ctx.close();
});

test('beat 6 — consent withdrawn by voice warning + PIN; the officer gets "Access withdrawn"; her log shows the refusal', async ({ browser }) => {
  test.skip(!PIN, 'DEMO_CITIZEN_PIN not set');
  const cit = await as(browser, 'citizen');
  const caseId = (await (await cit.page.request.get('/api/v1/me/cases')).json()).items[0].id as string;
  await cit.page.goto('/c');
  await cit.page.getByTestId('tile-data').click();
  await cit.page.getByTestId('stop-sharing').first().click();
  await expect(cit.page.getByTestId('withdraw-confirm')).toContainText('pause');
  for (const d of PIN) await cit.page.getByRole('button', { name: d, exact: true }).click();
  await cit.page.getByTestId('withdraw-pin-ok').click();
  await expect(cit.page.getByRole('status').first()).toContainText('paused');

  const off = await as(browser, 'officer');
  const api = await off.page.request.get(`/api/v1/cases/${caseId}`);
  expect(api.status()).toBe(403);
  expect((await api.json()).code).toBe('CONSENT_WITHDRAWN');
  await off.page.goto(`/o/cases/${caseId}`);
  await expect(off.page.getByTestId('access-withdrawn')).toContainText('Access withdrawn by the citizen');
  await off.ctx.close();

  await cit.page.reload();
  await cit.page.getByTestId('tile-data').click();
  await expect(cit.page.getByTestId('access-log')).toContainText('refused');
  // she shares again (restores the demo)
  for (const d of PIN) await cit.page.getByTestId('regrant').getByRole('button', { name: d, exact: true }).click();
  await cit.page.getByTestId('regrant').getByRole('button', { name: /Share again/ }).click();
  await cit.ctx.close();
});
