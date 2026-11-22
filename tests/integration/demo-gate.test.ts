/**
 * Demo sign-in must not be open to anyone with the link: with an access code it needs the code; on a Vercel deployment it
 * stays closed unless a code is set; the login page never sends account emails to the browser.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as demoTokens from '../../app/api/v1/demo/tokens/route';
import { resetMemoryRateLimits } from '@/lib/rate-limit';
import { call, seededDb } from '../helpers/api';
import type { TestDb } from '../helpers/pglite';

let t: TestDb;
const saved = { code: process.env.DEMO_ACCESS_CODE, vercel: process.env.VERCEL };
beforeAll(async () => { t = await seededDb(); });
afterAll(async () => { await t.close(); });
beforeEach(() => resetMemoryRateLimits());
afterEach(() => {
  if (saved.code === undefined) delete process.env.DEMO_ACCESS_CODE; else process.env.DEMO_ACCESS_CODE = saved.code;
  if (saved.vercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = saved.vercel;
});

const mint = (body: Record<string, unknown>) => call(demoTokens.POST, '/api/v1/demo/tokens', { body: { role: 'officer', ...body } });

describe('demo sign-in gate', () => {
  it('with DEMO_ACCESS_CODE set, a missing or wrong code is refused and the right one works', async () => {
    process.env.DEMO_ACCESS_CODE = 'judges-only-7391';
    expect((await mint({})).status).toBe(403);
    expect((await mint({ accessCode: 'guess' })).status).toBe(403);
    const ok = await mint({ accessCode: 'judges-only-7391' });
    expect(ok.status).toBe(201);
    expect(ok.body.token).toBeTruthy();
  });

  it('wrong guesses are rate limited hard', async () => {
    process.env.DEMO_ACCESS_CODE = 'judges-only-7391';
    let last = 0;
    for (let i = 0; i < 17; i++) last = (await mint({ accessCode: `bad-${i}` })).status;
    expect(last).toBe(429);
  });

  it('on a Vercel deployment demo sign-in is closed unless a code is set', async () => {
    process.env.VERCEL = '1';
    delete process.env.DEMO_ACCESS_CODE;
    expect((await mint({})).status).toBe(404);
    process.env.DEMO_ACCESS_CODE = 'judges-only-7391';
    expect((await mint({ accessCode: 'judges-only-7391' })).status).toBe(201);
  });

  it('local runs and CI (no VERCEL, no code) keep the open demo', async () => {
    delete process.env.VERCEL;
    delete process.env.DEMO_ACCESS_CODE;
    expect((await mint({})).status).toBe(201);
  });
});
