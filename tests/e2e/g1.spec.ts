import { expect, test } from '@playwright/test';

/** Gate G1 (PRD §28.2): every role logs in, the prototype banner shows, and a prompt plays with the network off. */

test('every screen carries the prototype banner', async ({ page }) => {
  for (const path of ['/', '/c', '/login', '/mock/phone', '/status']) {
    await page.goto(path);
    await expect(page.getByTestId('prototype-banner')).toContainText('Prototype — not an official service');
  }
});

test('Urdu switches the layout to right-to-left', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'اردو' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ur');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

for (const [role, path, text] of [['officer', '/o', 'Review queue'], ['admin', '/a', 'Rules & Twin'], ['auditor', '/au', 'Decision search'], ['helper', '/h', 'Families (']] as const) {
  test(`${role} signs in from the demo picker`, async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId(`demo-${role}`).click();
    await page.waitForURL(`**${path}`);
    await expect(page.getByText(text).first()).toBeVisible();
  });
}

test('citizen signs in with the phone code from the mock inbox and the PIN', async ({ page, context, request }) => {
  const pin = process.env.DEMO_CITIZEN_PIN;
  test.skip(!pin, 'DEMO_CITIZEN_PIN not set');
  await page.goto('/c');
  // C1: first run starts with two language pictures
  await page.getByTestId('lang-en').click();
  for (const d of '00001') await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByText('Enter the code')).toBeVisible();
  const inbox = await (await request.get('/api/mock/sms/inbox?phone=%2B920000000001')).json();
  const code = String(inbox.messages[0].body).match(/code is (\d{6})/)![1]!;
  for (const d of code) await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Enter your 4-digit PIN')).toBeVisible();
  for (const d of pin!) await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByLabel('trust picture')).toBeVisible();
  await expect(page.getByText('Zarina Bibi')).toBeVisible();

  // C5: five large tiles
  for (const t of ['apply', 'status', 'real', 'data', 'help']) await expect(page.getByTestId(`tile-${t}`)).toBeVisible();
  void context;
});

test('a voice prompt plays with the network off (OFF-1, G1)', async ({ page, context }) => {
  await page.goto('/c');
  // wait until the service worker controls the page and has precached the shell and the clips
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect.poll(() => page.evaluate(async () => {
    const c = await caches.open('amanat-v2');
    return !!(await c.match('/voice/ur/offline.wav')) && !!(await c.match('/c'));
  }), { timeout: 20_000 }).toBe(true);

  await context.setOffline(true);
  await page.reload();
  // the shell loads from the cache; with /api unreachable the app shows the offline screen
  await expect(page.getByText('Offline — your answers are saved on this phone').first()).toBeVisible({ timeout: 15_000 });
  const played = await page.evaluate(async () => {
    const a = document.querySelector('audio[data-testid="voice-offline"]') as HTMLAudioElement;
    a.currentTime = 0;
    await a.play();
    await new Promise((r) => setTimeout(r, 400));
    return { duration: a.duration, time: a.currentTime, paused: a.paused, error: a.error?.code ?? null };
  });
  expect(played.error).toBeNull();
  expect(played.duration).toBeGreaterThan(0.5);
  expect(played.time).toBeGreaterThan(0);
  await context.setOffline(false);
});
