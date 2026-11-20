import { route } from '@/lib/api/route';

const SCALAR = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.76.4';

/** API-1: interactive reference (Scalar) over the generated OpenAPI document. */
export const GET = route({
  operationId: 'docs', method: 'GET', path: '/api/docs', summary: 'API reference', tags: ['Ops'],
  auth: 'public', audit: false, transaction: false,
  handler: async () => ({
    body: null,
    raw: {
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>AMANAT AI API (prototype)</title></head><body>
<div style="background:#f3d36b;color:#3d3000;font:600 14px system-ui;padding:6px 12px">Prototype — not an official service. All data and government systems are SIMULATED.</div>
<script id="api-reference" data-url="/api/docs/openapi.json"></script>
<script src="${SCALAR}"></script></body></html>`,
    },
  }),
});
