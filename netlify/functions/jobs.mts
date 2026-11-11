/**
 * Netlify Scheduled Function (modern format) — runs background automations every
 * minute: queued jobs (journeys, scheduled emails, QuickBooks sync, recalculations)
 * and periodic checks (donor health, reminders, budget alerts).
 */
process.env.AINP_SERVERLESS = '1';
process.env.AINP_STORAGE ??= 'netlify-blobs';
if (!process.env.NETLIFY_DEV) process.env.NODE_ENV ??= 'production';

export default async () => {
  const { runScheduledJobs } = await import('../server-dist/app.mjs');
  const jobs = await runScheduledJobs();
  return Response.json({ ok: true, jobs });
};

export const config = { schedule: '* * * * *' };
