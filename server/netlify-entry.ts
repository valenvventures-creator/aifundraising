/**
 * Entry used by the Netlify Functions (netlify/functions/*.mts). The build compiles
 * this file into netlify/server-dist/app.mjs (npm run build:netlify).
 *
 * Everything is loaded lazily, in order: first the database address and keys are
 * resolved (Netlify Database / Netlify Blobs), then the server modules that read them.
 */
export async function createNetlifyApp() {
  const { ensureNetlifySecrets } = await import('./lib/secrets.js');
  await ensureNetlifySecrets();
  const { migrate } = await import('./db/migrate.js');
  const { createApp, assertRlsSafe } = await import('./index.js');
  await migrate(); // idempotent; serialized with an advisory lock
  await assertRlsSafe();
  return createApp();
}

/** One scheduled run: periodic automations, then queued jobs for up to ~20 seconds. */
export async function runScheduledJobs() {
  const { ensureNetlifySecrets } = await import('./lib/secrets.js');
  await ensureNetlifySecrets();
  const { processQueue, periodic } = await import('./jobs/runner.js');
  const stopAt = Date.now() + 20_000;
  await periodic().catch((e: any) => console.error('periodic automations failed', e));
  let ran = 0;
  while (Date.now() < stopAt) {
    const n = await processQueue().catch((e: any) => { console.error('job queue failed', e); return 0; });
    ran += n;
    if (!n) break;
  }
  return ran;
}
