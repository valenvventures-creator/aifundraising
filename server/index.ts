import express, { json } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.js';
import { errorHandler } from './lib/http.js';
import { requireAuth } from './lib/auth.js';
import { authRouter } from './routes/auth.js';
import { resourcesRouter } from './routes/resources.js';
import { donorsRouter } from './routes/donors.js';
import { givingRouter } from './routes/giving.js';
import { outreachRouter } from './routes/outreach.js';
import { moneyRouter } from './routes/money.js';
import { reachRouter, publicRouter } from './routes/reach.js';
import { integrationsRouter, oauthCallbackRouter, webhooksRouter } from './routes/integrations.js';
import { platformRouter } from './routes/platform.js';
import { grantsRouter } from './routes/grants.js';
import { impactRouter } from './routes/impact.js';
import { pool, rlsUnsafe } from './db/pool.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cookieParser());

  // Webhooks need the raw body for signature validation — mount before JSON parsing.
  app.use('/webhooks', webhooksRouter);
  app.use(json({ limit: '2mb' }));

  // CSRF defence: state-changing API calls must come from our own origin (cookies are SameSite=Lax too).
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    let sameHost = false;
    try { sameHost = Boolean(origin) && new URL(origin!).host === req.get('host'); } catch { /* malformed origin */ }
    const allowed = [config.appUrl, config.apiUrl, process.env.DEPLOY_PRIME_URL, process.env.DEPLOY_URL].filter(Boolean) as string[];
    if (origin && !sameHost && !allowed.some((o) => o.startsWith(origin))) return res.status(403).json({ error: 'Cross-origin request blocked.' });
    next();
  });

  app.get('/health', async (_req, res) => { await pool.query('SELECT 1'); res.json({ ok: true }); });
  app.use('/', publicRouter);                       // tracking pixels/links + public event pages (JSON)
  app.use('/api/public', publicRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/integrations', oauthCallbackRouter); // OAuth callbacks (session-authenticated, browser redirect)

  const api = express.Router();
  api.use(requireAuth);
  api.use('/r', resourcesRouter);
  api.use('/donors', donorsRouter);
  api.use('/giving', givingRouter);
  api.use('/outreach', outreachRouter);
  api.use('/money', moneyRouter);
  api.use('/reach', reachRouter);
  api.use('/integrations', integrationsRouter);
  api.use('/', grantsRouter);
  api.use('/', impactRouter);
  api.use('/', platformRouter);
  app.use('/api', api);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // Serve the built web app in production.
  const dist = path.resolve('dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api|webhooks|t\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}

/** Refuse to serve in production if tenant queries could bypass row-level security. */
export async function assertRlsSafe() {
  if (await rlsUnsafe()) {
    const msg = 'Database role bypasses row-level security (superuser/BYPASSRLS) and the ainp_rls role could not be created. Connect as a normal role, or grant this role CREATEROLE so the app can create ainp_rls.';
    if (config.isProd) throw new Error(msg);
    console.warn(`WARNING: ${msg}`);
  }
}
