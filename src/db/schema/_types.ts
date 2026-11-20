import { customType, timestamp, uuid } from 'drizzle-orm/pg-core';

export const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => 'bytea',
  fromDriver: (v) => Buffer.from(v),
});

export const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

export const id = () => uuid('id').primaryKey().defaultRandom();
export const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const ts = (name: string) => timestamp(name, { withTimezone: true });
