import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

export function loadEnv(path = process.env.PROCUREMENT_ENV_FILE ?? '.env.local') {
  if (existsSync(path)) for (const [key, value] of Object.entries(parseEnv(readFileSync(path, 'utf8')))) {
    process.env[key] ??= value;
  }
}
export function required(key: string) {
  const value = process.env[key];
  if (!value) throw new Error(`Set ${key}; see .env.example.`);
  return value;
}
