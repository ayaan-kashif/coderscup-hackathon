import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as chaos from '../../app/api/v1/admin/chaos/route';
import * as config from '../../app/api/v1/admin/config/route';
import * as auditEvents from '../../app/api/v1/audit/events/route';
import * as auditVerify from '../../app/api/v1/audit/verify/route';
import * as demoTokens from '../../app/api/v1/demo/tokens/route';
import * as health from '../../app/api/v1/health/route';
import * as me from '../../app/api/v1/me/route';
import * as statusRoute from '../../app/api/v1/status/route';
import * as docs from '../../app/api/docs/route';
import * as openapiJson from '../../app/api/docs/openapi.json/route';
import { allSpecs } from '@/lib/api/openapi';
import { resetMemoryRateLimits } from '@/lib/rate-limit';
import { call, seededDb } from '../helpers/api';
import type { TestDb } from '../helpers/pglite';

let t: TestDb;
beforeAll(async () => { t = await seededDb(); });
afterAll(async () => { await t.close(); });
beforeEach(() => resetMemoryRateLimits());

const token = async (role: string, email?: string) => {
  const r = await call(demoTokens.POST, '/api/v1/demo/tokens', { body: { role, ...(email ? { email } : {}) } });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.token as string;
};

describe('demo tokens (API-6)', () => {
  it.each(['citizen', 'helper', 'officer', 'admin', 'auditor'])('mints a 15-minute %s token that /me accepts', async (role) => {
    const r = await call(demoTokens.POST, '/api/v1/demo/tokens', { body: { role } });
    expect(r.body.expiresIn).toBe(900);
    const who = await call(me.GET, '/api/v1/me', { token: r.body.token });
    expect(who.body.role).toBe(role);
  });

  it('does not exist outside demo mode', async () => {
    process.env.DEMO_MODE = 'false';
    const r = await call(demoTokens.POST, '/api/v1/demo/tokens', { body: { role: 'admin' } });
    process.env.DEMO_MODE = 'true';
    expect(r.status).toBe(404);
  });
});

describe('admin config and chaos', () => {
  it('admin changes costs live and gets the new bar (90.4% at Rs 5,000)', async () => {
    const admin = await token('admin');
    const r = await call(config.PUT, '/api/v1/admin/config', { method: 'PUT', token: admin, body: { key: 'decision.costs', value: { wrongApproval: 5000, review: 300, delay: 200 } } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((r.body.threshold.costBar * 100).toFixed(1)).toBe('90.4');
    const read = await call(config.GET, '/api/v1/admin/config', { token: await token('auditor') });
    expect(read.body.config['decision.costs'].value.wrongApproval).toBe(5000);
    expect(read.body.config['decision.costs'].scope).toBe('tenant');
  });

  it('rejects invalid values and non-admins', async () => {
    const admin = await token('admin');
    expect((await call(config.PUT, '/api/v1/admin/config', { method: 'PUT', token: admin, body: { key: 'decision.floor', value: 2 } })).status).toBe(422);
    const off = await call(config.PUT, '/api/v1/admin/config', { method: 'PUT', token: await token('officer'), body: { key: 'decision.floor', value: 0.9 } });
    expect(off.status).toBe(403);
    expect(off.body.code).toBe('FORBIDDEN_ROLE');
    const aud = await call(chaos.PUT, '/api/v1/admin/chaos', { method: 'PUT', token: await token('auditor'), body: { service: 'identity', latencyMs: 0, timeoutRate: 1, errorRate: 0 } });
    expect(aud.status).toBe(403);
  });

  it('admin sets chaos for a mock service; auditor reads it', async () => {
    const r = await call(chaos.PUT, '/api/v1/admin/chaos', { method: 'PUT', token: await token('admin'), body: { service: 'civil', latencyMs: 400, timeoutRate: 0.2, errorRate: 0.1 } });
    expect(r.status).toBe(200);
    const g = await call(chaos.GET, '/api/v1/admin/chaos', { token: await token('auditor') });
    expect(g.body.services.find((s: { service: string }) => s.service === 'civil')).toMatchObject({ latencyMs: 400, timeoutRate: 0.2, errorRate: 0.1 });
    await call(chaos.PUT, '/api/v1/admin/chaos', { method: 'PUT', token: await token('admin'), body: { service: 'civil', latencyMs: 0, timeoutRate: 0, errorRate: 0 } });
  });
});

describe('audit events and verify', () => {
  it('auditor searches the tenant chain; admin sees config events only; officer needs a case', async () => {
    const all = await call(auditEvents.GET, '/api/v1/audit/events', { token: await token('auditor'), query: { limit: '100' } });
    expect(all.status).toBe(200);
    expect(all.body.events.length).toBeGreaterThan(0);
    expect(all.body.events[0].hash).toMatch(/^[0-9a-f]{64}$/);
    const cfg = await call(auditEvents.GET, '/api/v1/audit/events', { token: await token('admin') });
    expect(cfg.body.events.every((e: { action: string }) => /^(config|chaos|rules|twin|admin|audit\.verify)/.test(e.action))).toBe(true);
    const off = await call(auditEvents.GET, '/api/v1/audit/events', { token: await token('officer') });
    expect(off.status).toBe(422);
    const cit = await call(auditEvents.GET, '/api/v1/audit/events', { token: await token('citizen') });
    expect(cit.status).toBe(403);
  });

  it('verify reports intact, then the first broken row after a tamper', async () => {
    const auditor = await token('auditor');
    const ok = await call(auditVerify.POST, '/api/v1/audit/verify', { token: auditor, body: {} });
    expect(ok.body.intact).toBe(true);
    const last = await t.pg.query<{ id: number }>(`select id from audit_events where chain_id = $1 order by seq limit 1 offset 1`, [ok.body.chainId]);
    await t.pg.exec(`alter table audit_events disable trigger trg_audit_append_only`);
    await t.pg.query(`update audit_events set actor_id = 'someone-else' where id = $1`, [last.rows[0]!.id]);
    await t.pg.exec(`alter table audit_events enable trigger trg_audit_append_only`);
    const bad = await call(auditVerify.POST, '/api/v1/audit/verify', { token: auditor, body: {} });
    expect(bad.body.intact).toBe(false);
    expect(bad.body.brokenAt).toBe(Number(last.rows[0]!.id));
    expect((await call(auditVerify.POST, '/api/v1/audit/verify', { token: await token('officer'), body: {} })).status).toBe(403);
  });
});

describe('ops endpoints', () => {
  it('health is up', async () => {
    const r = await call(health.GET, '/api/v1/health');
    expect(r.body.status).toBe('ok');
    expect(r.headers.get('x-request-id')).toMatch(/^req_/);
  });

  it('status reports database, 53 tables, mocks and chain status', async () => {
    const r = await call(statusRoute.GET, '/api/v1/status');
    expect(r.body.checks.database.status).toBe('ok');
    expect(r.body.checks.schema.detail.tables).toBe(53);
    expect(r.body.checks.mocks.detail).toHaveLength(6);
    expect(r.body.chains.length).toBeGreaterThanOrEqual(1);
  });

  it('serves the API reference and an OpenAPI 3.1 document with every route', async () => {
    const html = await call(docs.GET, '/api/docs');
    expect(html.headers.get('content-type')).toContain('text/html');
    expect(html.text).toContain('Prototype — not an official service');
    const doc = await call(openapiJson.GET, '/api/docs/openapi.json');
    expect(doc.body.openapi).toBe('3.1.0');
    expect(doc.body.paths['/api/v1/cases'].post.parameters.some((p: { name: string; required: boolean }) => p.name === 'Idempotency-Key' && p.required)).toBe(true);
    expect(Object.keys(doc.body.paths).filter((p) => p.startsWith('/api/mock/')).length).toBeGreaterThanOrEqual(10);
    expect(doc.body.info.description).toContain('/api/v1/demo/tokens');
  });

  it('every API route file is in the OpenAPI catalogue and goes through route()', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p); else if (e.name === 'route.ts') files.push(p);
      }
    };
    walk(path.resolve(__dirname, '../../app/api'));
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      // every exported HTTP handler is built by the single guard chain
      for (const m of src.matchAll(/export const (GET|POST|PUT|PATCH|DELETE) = (\w+)\(/g)) expect(m[2], f).toBe('route');
      expect(src).not.toMatch(/export (async )?function (GET|POST|PUT|PATCH|DELETE)/);
    }
    const documented = new Set(allSpecs().map((s) => s.path));
    const apiRoutes = files.filter((f) => f.includes(`${path.sep}v1${path.sep}`)).map((f) => '/' + path.relative(path.resolve(__dirname, '../..', 'app'), path.dirname(f)).split(path.sep).join('/').replace(/\[(\w+)\]/g, '{$1}'));
    for (const r of apiRoutes) expect(documented.has(r), `${r} missing from openapi.ts ROUTE_MODULES`).toBe(true);
  });
});
