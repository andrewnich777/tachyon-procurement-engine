import { pgTable, uuid, text, jsonb, timestamp, integer, boolean, uniqueIndex } from 'drizzle-orm/pg-core';

const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey(), name: text('name').notNull(),
  mode: text('mode').notNull().default('simulation'), policy: jsonb('policy').notNull().default({}), policyVersion: integer('policy_version').notNull().default(0), createdAt: created(),
});
export const actors = pgTable('actors', {
  id: uuid('id').primaryKey(), workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(), role: text('role').notNull(), keyHash: text('key_hash').notNull().unique(),
  enabled: boolean('enabled').notNull().default(true), createdAt: created(),
});
export const categories = pgTable('categories', {
  id: uuid('id').primaryKey(), workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(), parentId: uuid('parent_id'), defaults: jsonb('defaults').notNull().default({}),
  archived: boolean('archived').notNull().default(false), createdAt: created(),
});
export const vendors = pgTable('vendors', {
  id: uuid('id').primaryKey(), workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(), identity: text('identity').notNull(), data: jsonb('data').notNull(), createdAt: created(),
}, t => [uniqueIndex('vendors_identity').on(t.workspaceId, t.identity)]);
export const requests = pgTable('requests', {
  id: uuid('id').primaryKey(), workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id), createdAt: created(),
});
export const quotes = pgTable('quotes', {
  id: uuid('id').primaryKey(), workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  requestId: uuid('request_id').notNull().references(() => requests.id), vendorId: uuid('vendor_id').notNull().references(() => vendors.id),
  data: jsonb('data').notNull(), createdAt: created(),
});
export const events = pgTable('procurement_events', {
  id: uuid('id').primaryKey(), workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  requestId: uuid('request_id').references(() => requests.id), actorId: uuid('actor_id').notNull().references(() => actors.id),
  sequence: integer('sequence').notNull(), type: text('type').notNull(), payload: jsonb('payload').notNull(),
  commandKey: text('command_key').notNull(), schemaVersion: integer('schema_version').notNull().default(1), createdAt: created(),
}, t => [uniqueIndex('events_request_sequence').on(t.requestId, t.sequence)]);
export const commands = pgTable('commands', {
  id: uuid('id').primaryKey(), workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  actorId: uuid('actor_id').notNull().references(() => actors.id), key: text('key').notNull(),
  hash: text('hash').notNull(), result: jsonb('result').notNull(), createdAt: created(),
}, t => [uniqueIndex('commands_key').on(t.workspaceId, t.actorId, t.key)]);
export const orders = pgTable('orders', {
  id: uuid('id').primaryKey(), workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  requestId: uuid('request_id').notNull().references(() => requests.id), quoteId: uuid('quote_id').notNull().references(() => quotes.id),
  state: text('state').notNull(), simulation: boolean('simulation').notNull(), totalCents: integer('total_cents').notNull(),
  period: text('period').notNull(), data: jsonb('data').notNull(), createdAt: created(),
});
