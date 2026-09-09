import { attachDatabasePool } from '@vercel/functions';
import { database } from '../src/db/index.js';
import { Engine } from '../src/engine.js';
import { createHandler } from '../src/server.js';
import { required } from '../src/config.js';

// Only the restricted service connection belongs in the hosting environment.
const { db, pool } = database(required('DATABASE_URL'));
attachDatabasePool(pool);
export default createHandler(new Engine(db));
