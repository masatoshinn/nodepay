import crypto from 'node:crypto';
import { env } from '../config.js';

const KEY = Buffer.from(env.ENCRYPTION_KEY.slice(0, 64).padEnd(64, '0'), 'hex');

/** AES-256-GCM. Output: v1.<iv-b64>.<tag-b64>.<cipher-b64> */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

export function decrypt(payload: string): string {
  const [v, ivB, tagB, dataB] = payload.split('.');
  if (v !== 'v1') throw new Error('unsupported ciphertext version');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivB!, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB!, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB!, 'base64')), decipher.final()]).toString('utf8');
}

export const sha256 = (input: string | Buffer): string =>
  crypto.createHash('sha256').update(input).digest('hex');

export const hmac = (payload: string, secret: string): string =>
  crypto.createHmac('sha256', secret).update(payload).digest('hex');

export const randomToken = (bytes = 32): string => crypto.randomBytes(bytes).toString('base64url');

/** constant-time string compare */
export const timingSafeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
};
