/**
 * The shopkeeper (the brief's second person). Needs SHOPKEEPER_DEMO_PASSWORD (the demo shopkeeper akram.hyd is seeded with it).
 * The README walk-through: sign in as akram.hyd → mock phone → demo scam SMS → Is this real? → Fake → Report → Hyderabad rises on the
 * Scam Map → an officer approves the alert → it appears under "Alerts in my district". Plus sign-up, 403 elsewhere and delete.
 */
import { expect, test, devices, type Browser, type Page } from '@playwright/test';

const PASSWORD = process.env.SHOPKEEPER_DEMO_PASSWORD ?? '';
test.skip(!PASSWORD, 'SHOPKEEPER_DEMO_PASSWORD not set');

async function fresh(browser: Browser, ip?: string) {
  // sign-up is limited to 3 per hour per IP, so a test that signs up presents its own client address
  const ctx = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block', ...(ip ? { extraHTTPHeaders: { 'x-forwarded-for': ip } } : {}) });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.evaluate(() => { try { localStorage.setItem('amanat_welcomed', '1'); } catch { /* ignore */ } });
  return { ctx, page };
}
const signInAkram = async (page: Page) => {
  await page.getByLabel(/Username or email|یوزر نیم یا ای میل/).fill('akram.hyd');
  await page.getByLabel(/^Password$|^پاس ورڈ$/).fill(PASSWORD);
  await page.getByTestId('shop-login-submit').click();
};
// the public map, read anonymously: a shopkeeper's own session is refused on every route that is not his
const hydToday = async (anon: Page) => {
  const r = await anon.request.get('/api/v1/scam/map?days=1&empty=1');
  return ((await r.json()).districts.find((d: { code: string }) => d.code === 'HYD').countToday ?? 0) as number;
};

test('the README walk-through: mock phone → Is this real? → Fake → Report → Hyderabad rises → approved alert in my district', async ({ browser }) => {
  const { ctx, page } = await fresh(browser);
  // signed out, the mock phone's link goes to the shopkeeper sign-in and keeps the message for after it
  await page.goto('/mock/phone?phone=%2B920000000001');
  await page.getByTestId('demo-scam-sms').click();
  await page.locator('li', { hasText: 'Rs 25,000 relief approved' }).first().getByRole('link', { name: /Is this real/ }).click();
  await expect(page).toHaveURL(/\/login\/shopkeeper\?next=/);
  await signInAkram(page);
  await expect(page).toHaveURL((u) => u.pathname === '/shopkeeper' && u.searchParams.has('check'));
  await expect(page.getByTestId('shop-text')).toHaveValue(/25,000 relief approved/);
  await expect(page.getByTestId('shop-sender')).toHaveValue('+920000099111');

  await page.getByTestId('shop-sent-to-customer').click();
  await page.getByTestId('shop-check-go').click();
  const verdict = page.getByTestId('shop-verdict');
  await expect(verdict).toHaveAttribute('data-verdict', 'fake');
  await expect(verdict).toContainText(/fee/i);
  await expect(page.getByTestId('tell-customer')).toBeVisible();

  const anon = await fresh(browser);
  const before = await hydToday(anon.page);
  await page.getByTestId('report-scam').click();
  await expect(page.getByTestId('reported')).toBeVisible();
  expect(await hydToday(anon.page)).toBe(before + 1);
  await anon.ctx.close();

  // an officer approves Hyderabad's alert (if it is still a draft)
  const off = await fresh(browser);
  expect((await off.page.request.post('/api/v1/demo/tokens', { data: { role: 'officer' } })).status()).toBe(201);
  const alerts = await (await off.page.request.get('/api/v1/scam/alerts')).json();
  const draft = alerts.items.find((a: { district: string; status: string }) => a.district === 'HYD' && a.status === 'draft');
  if (draft) expect((await off.page.request.post(`/api/v1/scam/alerts/${draft.id}/approve`)).status()).toBe(200);
  await off.ctx.close();

  await page.reload();
  await expect(page.getByTestId('shop-alerts').locator('[data-alert]').first()).toBeVisible();
  await expect(page.getByTestId('shop-checks').locator('[data-check]').first()).toBeVisible();
  await ctx.close();
});

test('a shopkeeper gets a 403 on every other portal, and the staff login shows a Shopkeeper card', async ({ browser }) => {
  const { ctx, page } = await fresh(browser);
  await page.goto('/login');
  await page.getByTestId('portal-shopkeeper').click();
  await expect(page).toHaveURL(/\/login\/shopkeeper$/);
  await signInAkram(page);
  await expect(page).toHaveURL((u) => u.pathname === '/shopkeeper');
  for (const path of ['/o', '/o/scams', '/a', '/au', '/h', '/c']) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(403);
  }
  const api = await page.request.get('/api/v1/me/cases');
  expect(api.status()).toBe(403);
  await page.goto('/shopkeeper');
  await page.getByTestId('shop-logout').click();
  await expect(page).toHaveURL(/\/login\/shopkeeper$/);
  await ctx.close();
});

test('a new shop signs up with made-up details, checks a message, and deletes its account', async ({ browser }) => {
  const { ctx, page } = await fresh(browser, `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`);
  const user = `shop_${Date.now().toString(36)}`.slice(0, 20);
  await page.goto('/login/shopkeeper');
  await page.getByTestId('shop-signup-link').click();
  await page.locator('#shopName').fill('Noor Kiryana Store');
  await page.locator('#username').fill(user);
  await page.locator('#password').fill('made-up-pass-9');
  await page.getByTestId('password-toggle').click();
  await expect(page.locator('#password')).toHaveAttribute('type', 'text');
  await page.locator('#passwordConfirm').fill('made-up-pass-9');
  await page.locator('#district').selectOption('SKR');
  await page.locator('#email').fill('owner@gmail.com');
  await page.getByTestId('shop-signup-submit').click();
  await expect(page.getByTestId('err-email')).toBeVisible(); // only a made-up .test address
  await expect(page.getByTestId('err-prototype')).toBeVisible();
  await page.locator('#email').fill('');
  await page.getByTestId('shop-prototype').check();
  await page.getByTestId('shop-signup-submit').click();
  await expect(page).toHaveURL((u) => u.pathname === '/shopkeeper');
  await expect(page.getByTestId('shop-dashboard')).toContainText('Noor Kiryana Store');

  await page.getByTestId('shop-text').fill('SAAYA: Rs 12000 has been sent to your wallet ending 1356 on 2026-02-15. No fee is ever charged. Never share your PIN.');
  await page.getByTestId('shop-sender').fill('SAAYA');
  await page.getByTestId('shop-sent-to-customer').click();
  await page.getByTestId('shop-check-go').click();
  await expect(page.getByTestId('shop-verdict')).not.toHaveAttribute('data-verdict', 'fake');

  await page.getByTestId('shop-delete').click();
  await page.getByTestId('shop-delete-sure').check();
  await page.getByTestId('shop-delete-password').fill('made-up-pass-9');
  await page.getByTestId('shop-delete-go').click();
  await expect(page).toHaveURL(/\/login\/shopkeeper$/);
  expect((await page.request.get('/api/v1/shop/me')).status()).toBe(401);
  await ctx.close();
});
