/**
 * Netlify Scheduled Function (schedule set in netlify.toml) — runs background
 * automations every minute: queued jobs (journeys, scheduled emails, QuickBooks
 * sync, recalculations) and periodic checks (donor health, reminders, budget alerts).
 * Each run stops taking new jobs after ~20 seconds.
 */
process.env.AINP_SERVERLESS = '1';
process.env.NODE_ENV ??= 'production';

import { connectLambda } from '@netlify/blobs';

export const handler = async (event: any) => {
  if (event?.blobs) connectLambda(event);
  const { ensureNetlifySecrets } = await import('../../server/lib/secrets.js');
  await ensureNetlifySecrets();
  const { processQueue, periodic } = await import('../../server/jobs/runner.js');
  const stopAt = Date.now() + 20_000;
  await periodic().catch((e: any) => console.error('periodic automations failed', e));
  let ran = 0;
  while (Date.now() < stopAt) {
    const n = await processQueue().catch((e: any) => { console.error('job queue failed', e); return 0; });
    ran += n;
    if (!n) break;
  }
  return { statusCode: 200, body: JSON.stringify({ ok: true, jobs: ran }) };
};
