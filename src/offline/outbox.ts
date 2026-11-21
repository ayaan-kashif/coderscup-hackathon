/**
 * OFF-2: every answer and photo is written to an IndexedDB outbox with a client UUID BEFORE any upload.
 * Entry shape follows PRD §22.4: { id, type, payload, attempts, status }.
 */
import Dexie, { type EntityTable } from 'dexie';

export type OutboxStatus = 'saved' | 'sending' | 'sent' | 'failed';
/** OFF-5 ticks: one grey = saved on phone; two grey = reached the office; two blue = an officer opened it */
export type Tick = 'grey1' | 'grey2' | 'blue2' | 'failed';
export type OutboxType = 'case.create' | 'case.answers' | 'case.document' | 'case.submit' | 'case.proof';

export type OutboxEntry = {
  /** client UUID; also the Idempotency-Key, so a replay is one submission (OFF-4) */
  id: string;
  type: OutboxType;
  /** entries for a case created offline point at the create entry; its server id fills {caseId} at send time */
  caseRef?: string;
  caseId?: string;
  /** a short label for the outbox list ("Photo: CNIC front") */
  label?: string;
  payload: Record<string, unknown>;
  createdAt: number;
  attempts: number;
  status: OutboxStatus;
  nextAttemptAt: number;
  /** server response once acknowledged */
  serverId?: string;
  serverStatus?: number;
  /** last known tick from the server (blue once an officer opens the case) */
  tick: Tick;
  lastError?: string;
};

export class OutboxDb extends Dexie {
  outbox!: EntityTable<OutboxEntry, 'id'>;
  constructor(name = 'amanat-offline') {
    super(name);
    this.version(1).stores({ outbox: 'id, status, nextAttemptAt, createdAt' });
  }
}

let db: OutboxDb | undefined;
export const outboxDb = () => (db ??= new OutboxDb());

export function newClientId() {
  return crypto.randomUUID();
}

export async function enqueue(d: OutboxDb, type: OutboxEntry['type'], payload: Record<string, unknown>, now = Date.now(), link: { caseRef?: string; caseId?: string; label?: string } = {}): Promise<OutboxEntry> {
  const entry: OutboxEntry = { id: newClientId(), type, payload, createdAt: now, attempts: 0, status: 'saved', nextAttemptAt: now, tick: 'grey1', ...link };
  await d.outbox.add(entry);
  return entry;
}
