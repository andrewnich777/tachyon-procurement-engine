import { defineConfig } from 'drizzle-kit';
import { loadEnv } from './src/config.js';
loadEnv();
export default defineConfig({ dialect: 'postgresql', schema: './src/db/schema.ts', out: './migrations' });
