/**
 * API-1: OpenAPI 3.1 generated from the same Zod schemas the guard chain validates with, so the docs can
 * never drift from the code. Every route module is listed here; a test fails if a route file is missing.
 */
import { z, type ZodType } from 'zod';
import * as adminChaos from '../../../app/api/v1/admin/chaos/route';
import * as adminConfig from '../../../app/api/v1/admin/config/route';
import * as auditEvents from '../../../app/api/v1/audit/events/route';
import * as auditVerify from '../../../app/api/v1/audit/verify/route';
import * as login from '../../../app/api/v1/auth/login/route';
import * as logout from '../../../app/api/v1/auth/logout/route';
import * as otpRequest from '../../../app/api/v1/auth/otp/request/route';
import * as otpVerify from '../../../app/api/v1/auth/otp/verify/route';
import * as pinSet from '../../../app/api/v1/auth/pin/set/route';
import * as pinVerify from '../../../app/api/v1/auth/pin/verify/route';
import * as cases from '../../../app/api/v1/cases/route';
import * as caseById from '../../../app/api/v1/cases/[id]/route';
import * as caseStatus from '../../../app/api/v1/cases/[id]/status/route';
import * as demoTokens from '../../../app/api/v1/demo/tokens/route';
import * as health from '../../../app/api/v1/health/route';
import * as me from '../../../app/api/v1/me/route';
import * as status from '../../../app/api/v1/status/route';
import { MOCK_ROUTES } from '@/services/mocks/router';
import { ERROR_CODES } from '../errors';
import type { RouteSpec } from './route';

type AnySpec = RouteSpec<unknown, unknown, unknown>;
type Mod = Record<string, unknown>;

export const ROUTE_MODULES: Record<string, Mod> = {
  health, status, me, login, logout, otpRequest, otpVerify, pinSet, pinVerify, demoTokens, cases, caseById, caseStatus,
  adminConfig, adminChaos, auditEvents, auditVerify,
};

export function allSpecs(): AnySpec[] {
  const out: AnySpec[] = [];
  for (const m of Object.values(ROUTE_MODULES)) {
    for (const k of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      const h = m[k] as { spec?: AnySpec } | undefined;
      if (h?.spec) out.push(h.spec);
    }
  }
  return out;
}

const js = (s: ZodType) => {
  const j = z.toJSONSchema(s, { unrepresentable: 'any', io: 'input' }) as Record<string, unknown>;
  delete j.$schema;
  return j;
};

function paramsFrom(schema: ZodType | undefined, where: 'path' | 'query') {
  if (!schema) return [];
  const j = js(schema) as { properties?: Record<string, unknown>; required?: string[] };
  return Object.entries(j.properties ?? {}).map(([name, s]) => ({ name, in: where, required: where === 'path' || (j.required ?? []).includes(name), schema: s }));
}

const problemRef = { $ref: '#/components/schemas/Problem' };

export function buildOpenApi(baseUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const s of allSpecs()) {
    if (s.path.startsWith('/api/mock/')) continue;
    const errorCodes = ['400', '401', '403', '404', '422', '429', '500'];
    const op: Record<string, unknown> = {
      operationId: s.operationId,
      summary: s.summary,
      tags: s.tags,
      security: s.auth === 'public' ? [] : [{ bearer: [] }, { apiKey: [] }, { cookie: [] }],
      parameters: [
        ...paramsFrom(s.params, 'path'),
        ...paramsFrom(s.query, 'query'),
        ...(s.idempotency === 'required' ? [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 8, maxLength: 128 }, description: 'Required on creates and money writes (API-3). Missing → 400 IDEMPOTENCY_KEY_REQUIRED; a repeat returns the stored response with Idempotent-Replayed: true.' }] : []),
        ...(s.idempotency === 'optional' ? [{ name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string' } }] : []),
      ],
      responses: {
        [String(s.responseStatus ?? 200)]: { description: 'OK', content: { 'application/json': { schema: s.response ? js(s.response) : {} } } },
        ...Object.fromEntries(errorCodes.map((c) => [c, { description: Object.entries(ERROR_CODES).filter(([, v]) => String(v.status) === c).map(([k]) => k).join(', ') || 'Error', content: { 'application/problem+json': { schema: problemRef } } }])),
      },
    };
    if (s.body) op.requestBody = { required: true, content: { 'application/json': { schema: js(s.body) } } };
    (paths[s.path] ??= {})[s.method.toLowerCase()] = op;
  }
  // the six SIMULATED services, one operation per endpoint
  for (const r of MOCK_ROUTES) {
    const p = '/api/mock/' + r.pattern.replace(/:([a-z]+)/g, '{$1}');
    const op: Record<string, unknown> = {
      operationId: `mock_${r.service}_${r.method.toLowerCase()}_${r.pattern.replace(/[^a-z]/g, '_')}`,
      summary: `[SIMULATED] ${r.summary}`, tags: ['Mock services (SIMULATED)'], security: [], 'x-simulated': true,
      description: 'A labelled mock. Honours the chaos settings (latency, timeout rate, error rate) of its service.',
      parameters: [...[...r.pattern.matchAll(/:([a-z]+)/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } })), ...paramsFrom(r.query, 'query')],
      responses: { 200: { description: 'OK (simulated: true)' }, 503: { description: 'Simulated outage (chaos)', content: { 'application/problem+json': { schema: problemRef } } } },
    };
    if (r.body) op.requestBody = { required: true, content: { 'application/json': { schema: js(r.body) } } };
    (paths[p] ??= {})[r.method.toLowerCase()] = op;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'AMANAT AI API (prototype)',
      version: '0.1.0',
      description: DESCRIPTION(baseUrl),
    },
    servers: [{ url: baseUrl }],
    tags: [
      { name: 'Auth' }, { name: 'Cases' }, { name: 'Admin' }, { name: 'Audit' }, { name: 'Ops' },
      { name: 'Mock services (SIMULATED)', description: 'Every response carries simulated: true. Nothing reaches a real registry, bank or phone.' },
    ],
    paths,
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: '15-minute access token from /auth/login, /auth/pin/verify or /demo/tokens' },
        apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key', description: 'Tenant-bound, scoped partner key' },
        cookie: { type: 'apiKey', in: 'cookie', name: 'amanat_session', description: 'Browser session; writes also need a same-origin Origin header' },
      },
      schemas: {
        Problem: {
          type: 'object', description: 'RFC 9457 problem details',
          required: ['type', 'title', 'status', 'detail', 'code', 'requestId'],
          properties: {
            type: { type: 'string', format: 'uri' }, title: { type: 'string' }, status: { type: 'integer' }, detail: { type: 'string' },
            code: { type: 'string', enum: Object.keys(ERROR_CODES) }, requestId: { type: 'string' },
          },
        },
      },
    },
  };
}

const DESCRIPTION = (base: string) => `**Prototype — not an official service.** All people, documents and government systems are simulated.

### Try it with curl (API-6, demo mode)

\`\`\`bash
BASE=${base}
# a 15-minute token for any demo role: citizen, helper, officer, admin, auditor
TOKEN=$(curl -s -X POST $BASE/api/v1/demo/tokens -H 'content-type: application/json' -d '{"role":"officer"}' | jq -r .token)
curl -s $BASE/api/v1/me -H "Authorization: Bearer $TOKEN"

# a create without Idempotency-Key → 400 IDEMPOTENCY_KEY_REQUIRED
CIT=$(curl -s -X POST $BASE/api/v1/demo/tokens -H 'content-type: application/json' -d '{"role":"citizen"}' | jq -r .token)
curl -s -X POST $BASE/api/v1/cases -H "Authorization: Bearer $CIT" -H 'content-type: application/json' \\
  -d '{"programCode":"SAAYA-WS","channel":"citizen","clientSubmissionId":"demo-sub-0001"}'
# the same call with a key, sent twice → one case; the second answer has Idempotent-Replayed: true
curl -s -i -X POST $BASE/api/v1/cases -H "Authorization: Bearer $CIT" -H 'Idempotency-Key: demo-key-0001' -H 'content-type: application/json' \\
  -d '{"programCode":"SAAYA-WS","channel":"citizen","clientSubmissionId":"demo-sub-0001"}'

# another tenant's case → 404 NOT_FOUND, identical to an unknown id
PUNJAB=$(curl -s -X POST $BASE/api/v1/demo/tokens -H 'content-type: application/json' -d '{"role":"officer","email":"officer.bilal@punjab.amanat.test"}' | jq -r .token)
curl -s $BASE/api/v1/cases/<sindh-case-id> -H "Authorization: Bearer $PUNJAB"

# admin: chaos panel and audit chain
ADMIN=$(curl -s -X POST $BASE/api/v1/demo/tokens -H 'content-type: application/json' -d '{"role":"admin"}' | jq -r .token)
curl -s -X PUT $BASE/api/v1/admin/chaos -H "Authorization: Bearer $ADMIN" -H 'content-type: application/json' -d '{"service":"identity","latencyMs":0,"timeoutRate":1,"errorRate":0}'
curl -s -X POST $BASE/api/v1/audit/verify -H "Authorization: Bearer $ADMIN" -H 'content-type: application/json' -d '{}'
\`\`\`

Errors are RFC 9457 problem documents with a stable \`code\` and the \`requestId\`. Every response carries \`X-Request-Id\` and \`RateLimit-*\` headers.`;
