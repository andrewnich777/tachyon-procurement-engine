import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

export function database(url: string) {
  const connection=new URL(url);
  if (connection.searchParams.get('sslmode')==='require') connection.searchParams.set('sslmode','verify-full');
  const pool = new pg.Pool({ connectionString: connection.toString(), max: 8, connectionTimeoutMillis: 15000, idleTimeoutMillis: 10000 });
  const db = drizzle(pool, { schema });
  return { pool, db };
}
export type Database = ReturnType<typeof database>['db'];
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
