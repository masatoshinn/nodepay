import { badRequest } from './errors.js';

const PRIVATE_V4 = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
];

/** block obvious SSRF targets for merchant-supplied webhook URLs */
export function assertSafeWebhookUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest('Invalid webhook URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw badRequest('Webhook URL must be http(s)');
  }
  if (process.env.ALLOW_PRIVATE_WEBHOOKS === 'true') return url.toString();

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw badRequest('Webhook URL host is not allowed');
  }
  if (/^[0-9.]+$/.test(host) && PRIVATE_V4.some((re) => re.test(host))) {
    throw badRequest('Webhook URL host is not allowed');
  }
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) {
    throw badRequest('Webhook URL host is not allowed');
  }
  if (host.startsWith('::ffff:')) {
    const v4 = host.slice(7);
    if (PRIVATE_V4.some((re) => re.test(v4))) throw badRequest('Webhook URL host is not allowed');
  }
  return url.toString();
}
