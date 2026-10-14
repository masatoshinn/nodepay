import Redis from 'ioredis';
import { env } from '../config.js';

let conn: Redis | null = null;

export function redis(): Redis {
  if (!conn) {
    conn = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    conn.on('error', (e) => console.error('[redis]', e.message));
  }
  return conn;
}

/** short-lived cache helper */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const v = await redis().get(key);
  return v ? (JSON.parse(v) as T) : null;
}

export async function cacheSet(key: string, value: unknown, ttlSec: number) {
  await redis().set(key, JSON.stringify(value), 'EX', ttlSec);
}
