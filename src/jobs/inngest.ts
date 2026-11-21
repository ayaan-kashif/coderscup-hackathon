import 'server-only';
/**
 * Inngest wiring (PRD §22). case.process runs as durable steps; when Inngest is not configured or not reachable the
 * same code runs inline after the response (next/server `after`), so a missing scheduler never blocks a case.
 */
import { Inngest } from 'inngest';
import { getDb } from '@/db/client';
import { log } from '@/lib/log';
import { runCaseProcess, inlineStepper, type Stepper } from '@/services/pipeline/run';
import { payIfDue, releaseDuePayments } from '@/services/pipeline/steps';
import { completeDuePayoutChanges } from '@/services/payouts';

export const inngest = new Inngest({ id: 'amanat-ai' });

export const caseProcess = inngest.createFunction(
  { id: 'case-process', name: 'case.process', triggers: [{ event: 'case/submitted' }], retries: 3, concurrency: { key: 'event.data.caseId', limit: 1 } },
  async ({ event, step }) => {
    const stepper: Stepper = {
      mode: 'inngest',
      run: (name, fn) => step.run(name, fn) as never,
      sleepUntil: async (name, at) => { await step.sleepUntil(name, at); return true; },
    };
    return runCaseProcess(getDb(), String((event.data as { caseId: string }).caseId), stepper);
  },
);

export const paymentRelease = inngest.createFunction(
  { id: 'payment-release', name: 'payments.release', triggers: [{ cron: '* * * * *' }] },
  async ({ step }) => {
    const paid = await step.run('release', () => releaseDuePayments(getDb()));
    const changes = await step.run('payout-changes', () => completeDuePayoutChanges(getDb()));
    return { paid: paid.length, changes };
  },
);

/** NOT-3 / API-5: retry due outbox rows (notifications and webhooks) */
export const outboxDispatch = inngest.createFunction(
  { id: 'outbox-dispatch', name: 'outbox.dispatch', triggers: [{ cron: '* * * * *' }] },
  async ({ step }) => step.run('dispatch', async () => { const { dispatchOutbox } = await import('@/services/jobs'); return dispatchOutbox(getDb()); }),
);

/** AUD-3: hourly anchor of every chain head (verified first) */
export const auditAnchor = inngest.createFunction(
  { id: 'audit-anchor', name: 'audit.anchor', triggers: [{ cron: '0 * * * *' }] },
  async ({ step }) => step.run('anchor', async () => { const { anchorChains } = await import('@/services/jobs'); return anchorChains(getDb()); }),
);

/** §22.2: daily retention sweep at 02:00 PKT (21:00 UTC) */
export const retention = inngest.createFunction(
  { id: 'retention-sweep', name: 'retention.sweep', triggers: [{ cron: '0 21 * * *' }] },
  async ({ step }) => step.run('sweep', async () => { const { retentionSweep } = await import('@/services/jobs'); return retentionSweep(getDb()); }),
);

export const FUNCTIONS = [caseProcess, paymentRelease, outboxDispatch, auditAnchor, retention];

export const inngestConfigured = () => !!(process.env.INNGEST_EVENT_KEY || process.env.INNGEST_DEV);

/**
 * Start case.process: Inngest if configured and reachable, otherwise inline. Returns the mode used.
 * `defer` runs work after the HTTP response (next/server `after`); tests pass an awaited runner instead.
 */
export async function dispatchCaseProcess(caseId: string, defer: (fn: () => Promise<void>) => void): Promise<'inngest' | 'inline'> {
  if (inngestConfigured()) {
    try {
      await inngest.send({ name: 'case/submitted', data: { caseId } });
      return 'inngest';
    } catch (e) {
      log('warn', 'inngest unreachable; running case.process inline', { caseId, error: String(e) });
    }
  }
  defer(async () => { await runCaseProcess(getDb(), caseId, inlineStepper()); });
  return 'inline';
}

export { payIfDue };
