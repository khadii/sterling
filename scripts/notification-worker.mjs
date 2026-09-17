// Run as a separate process, not inside a Vercel request lifecycle.
// node --env-file=.env scripts/notification-worker.mjs [--once]
import { setTimeout as delay } from 'node:timers/promises';
const secret = process.env.NOTIFICATION_WORKER_SECRET;
const base = process.env.NOTIFICATION_API_URL;
if (!secret || secret.length < 32 || !base)
  throw new Error(
    'Set NOTIFICATION_WORKER_SECRET (32+ characters) and NOTIFICATION_API_URL',
  );
const url = new URL(
  `${base.replace(/\/$/, '')}/internal/notifications/process`,
);
if (!['https:', 'http:'].includes(url.protocol))
  throw new Error('Use an HTTP(S) API URL');
if (
  url.protocol !== 'https:' &&
  !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
)
  throw new Error('Use HTTPS for remote notification workers');
let stopping = false;
process.on('SIGINT', () => {
  stopping = true;
});
process.on('SIGTERM', () => {
  stopping = true;
});
do {
  let busy = false;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(120_000),
      redirect: 'error',
    });
    if (!response.ok)
      throw new Error(`Notification worker HTTP ${response.status}`);
    const result = await response.json();
    console.log(JSON.stringify(result));
    busy = result.processed >= 5;
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Notification worker failed',
    );
    if (process.argv.includes('--once')) process.exitCode = 1;
  }
  if (process.argv.includes('--once') || stopping) break;
  // Drain backlog promptly, otherwise check once per minute.
  await delay(busy ? 1000 : 60_000);
} while (!stopping);
