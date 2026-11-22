/**
 * A new citizen signs in with her own WhatsApp number, makes a PIN, finishes onboarding, and deletes her account.
 * Runs only with WA_E2E=1, against an app started with OTP_PROVIDER=baileys and a FAKE gateway (wa-gateway: pnpm fake), so no real
 * WhatsApp message is sent:
 *   WA_E2E=1 WA_FAKE_URL=http://127.0.0.1:8788 WA_GATEWAY_SECRET=<same secret> pnpm test:e2e whatsapp
 */
import { expect, test, devices, type Page } from '@playwright/test';

const FAKE = process.env.WA_FAKE_URL ?? 'http://127.0.0.1:8788';
const SECRET = process.env.WA_GATEWAY_SECRET ?? '';
test.skip(process.env.WA_E2E !== '1' || SECRET.length < 24, 'needs WA_E2E=1, WA_GATEWAY_SECRET and the fake gateway');

const tap = async (page: Page, digits: string) => { for (const d of digits) await page.getByRole('button', { name: d, exact: true }).click(); };
const lastCode = async (page: Page) => {
  const r = await page.request.get(`${FAKE}/__last-code`, { headers: { authorization: `Bearer ${SECRET}` } });
  return (await r.json()).code as string;
};

test('a new citizen: WhatsApp code, PIN, onboarding, then delete my account and data', async ({ browser }) => {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block', permissions: [] });
  const page = await ctx.newPage();
  const suffix = String(Date.now()).slice(-7);
  await page.goto('/c');
  await page.getByTestId('lang-en').click();

  // the demo phone stays the default; the WhatsApp option is there because the provider is on
  await expect(page.getByTestId('use-whatsapp')).toBeVisible();
  await page.getByTestId('use-whatsapp').click();
  await expect(page.getByTestId('whatsapp-badge')).toContainText('WhatsApp');
  await expect(page.getByText("We'll send the code to your WhatsApp.")).toBeVisible();

  // a typed leading 0 is dropped: 0345… and 345… are the same number
  await tap(page, `0345${suffix}`);
  await expect(page.getByTestId('whatsapp-number')).toContainText(`+92 345 ${suffix}`);
  await page.getByTestId('whatsapp-send').click();
  await expect(page.getByTestId('code-in-whatsapp')).toBeVisible();
  const code = await lastCode(page);
  expect(code).toMatch(/^\d{6}$/);
  await tap(page, code);
  await page.getByRole('button', { name: 'Continue' }).click();

  // first time: straight to "Make a PIN" (twice), then the PIN screen
  await expect(page.getByText('Make a PIN')).toBeVisible();
  await tap(page, '4729'); await page.getByRole('button', { name: 'Continue' }).click();
  await tap(page, '4729'); await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Enter your 4-digit PIN')).toBeVisible();
  await tap(page, '4729'); await page.getByRole('button', { name: 'Continue' }).click();

  // trust picture, consent (with the prototype notice), About you
  await page.getByLabel('trust 3', { exact: true }).click();
  await expect(page.getByTestId('prototype-notice')).toContainText("Don't enter a real CNIC, bank number or address");
  await tap(page, '4729'); await page.getByRole('button', { name: /Yes, I agree/ }).click();
  await page.getByTestId('about-name-input').fill('Amina Test');
  await page.getByTestId('about-name-ok').click();
  await tap(page, '20051975'); await page.getByTestId('about-dob-ok').click();
  await page.getByTestId('about-district-HYD').click();
  await expect(page.getByTestId('trust-header')).toBeVisible();

  // reopening resumes at home (everything was saved as it was given)
  await page.reload();
  await expect(page.getByTestId('trust-header')).toBeVisible();

  // My data: log out and delete my account and data
  await page.getByTestId('tile-data').click();
  await expect(page.getByTestId('account-actions')).toBeVisible();
  await page.getByTestId('delete-account').click();
  await expect(page.getByTestId('delete-confirm')).toBeVisible();
  await page.getByTestId('delete-sure').check();
  await tap(page, '4729');
  await page.getByTestId('delete-go').click();
  await expect(page.getByTestId('lang-en')).toBeVisible({ timeout: 20_000 }); // signed out: the welcome screen again
  const me = await page.request.get('/api/v1/me');
  expect(me.status()).toBe(401);
  await ctx.close();
});
