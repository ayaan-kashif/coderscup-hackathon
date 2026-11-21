import { z } from 'zod';
import { recordAiDecision } from '@/ai/calls';
import { classifyIntent } from '@/ai/jev';
import { route } from '@/lib/api/route';

const body = z.object({ utterance: z.string().min(2).max(500) });

/** citizen intent routing (Help tile): Jev picks a screen; a low probability falls back to the five tiles. Never authorizes anything. */
export const POST = route({
  operationId: 'routeIntent', method: 'POST', path: '/api/v1/assist/intent', summary: 'Route a spoken request to a screen', tags: ['Assistant'],
  auth: 'required', body, idempotency: 'optional',
  authorize: { action: 'assist.policy' },
  audit: { action: 'assist.intent', resourceType: 'ai_decision' },
  handler: async (c, db) => {
    const r = await classifyIntent(db, c.actor!.tenantId ?? null, c.body.utterance);
    const probs = (r.ok ? r.probabilities : null) as Record<string, number> | null;
    const top = r.ok ? r.value.intent : null;
    const confident = !!(top && probs && (probs[top] ?? 0) >= 0.6);
    const screen = confident ? ({ new_application: 'apply', status: 'status', complaint: 'complaint', scam_report: 'real', data_request: 'data' } as Record<string, string>)[top!] ?? 'home' : 'home';
    const id = await recordAiDecision(db, { tenantId: c.actor!.tenantId ?? null, kind: 'intent_routing', input: { utterance: c.body.utterance }, model: r.model, promptVersion: 'jev.intent@1', probabilities: probs, result: { intent: top, screen, confident }, userReason: confident ? `Opened "${screen}".` : 'Not sure what you need; showing the five tiles.' });
    return { body: { screen, intent: top, confident, aiDecisionId: id }, audit: { resourceId: id, details: { screen, confident } } };
  },
});
