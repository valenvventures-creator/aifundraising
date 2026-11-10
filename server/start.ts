/** Long-running server entry point (npm start / Docker). Netlify uses netlify/functions/api.mts instead. */
import { createApp, assertRlsSafe } from './index.js';
import { migrate } from './db/migrate.js';
import { startJobs } from './jobs/runner.js';
import { config } from './config.js';

async function main() {
  await migrate();
  await assertRlsSafe();
  createApp().listen(config.port, () => console.log(`A.I. Nonprofits API listening on :${config.port}`));
  startJobs();
}
main().catch((e) => { console.error(e); process.exit(1); });
