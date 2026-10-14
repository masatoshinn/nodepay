import { Queue } from 'bullmq';
import { redis } from './redis.js';

const connection = () => redis();

export const webhookQueue = new Queue('webhook-deliveries', { connection: connection() });
export const scanQueue = new Queue('chain-scan', { connection: connection() });
export const maintenanceQueue = new Queue('maintenance', { connection: connection() });

export const WEBHOOK_MAX_ATTEMPTS = 6;
