import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { database } from '../src/db/index.js';
import { loadEnv, required } from '../src/config.js';
loadEnv();
const connection = required('DATABASE_URL_UNPOOLED');
if (new URL(connection).hostname.includes('-pooler')) throw new Error('Migrations require the direct URL.');
if (process.env.NEON_BRANCH === 'production' && process.env.ALLOW_PRODUCTION_MIGRATIONS !== 'yes') {
  throw new Error('Select a development branch; production migrations require explicit opt-in.');
}
const { pool, db } = database(connection);
try { await migrate(db, { migrationsFolder: './migrations' }); console.log('Migrations applied.'); }
finally { await pool.end(); }
