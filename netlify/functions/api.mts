/**
 * Netlify Function that runs the whole A.I. Nonprofits API (Express) — every
 * /api/*, /webhooks/* and /t/* request is routed here by netlify.toml.
 */
import express from 'express';
import serverless from 'serverless-http';
import { connectLambda } from '@netlify/blobs';

// Must be set before the server modules load (they read config at import time).
process.env.AINP_SERVERLESS = '1';
process.env.AINP_STORAGE ??= 'netlify-blobs';
process.env.NODE_ENV ??= 'production';

type Handler = (event: any, context: any) => Promise<any>;
let ready: Promise<Handler> | null = null;

async function init(): Promise<Handler> {
  const { createApp, assertRlsSafe } = await import('../../server/index.js');
  const { migrate } = await import('../../server/db/migrate.js');
  await migrate();          // idempotent; serialized with an advisory lock
  await assertRlsSafe();
  const outer = express();
  // Requests arrive as /.netlify/functions/api/<original path>; restore the original path.
  outer.use((req, _res, next) => { req.url = req.url.replace(/^\/\.netlify\/functions\/api/, '') || '/'; next(); });
  outer.use(createApp());
  return serverless(outer, {
    binary: ['application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream', 'image/*', 'application/zip'],
  }) as unknown as Handler;
}

export const handler = async (event: any, context: any) => {
  if (event?.blobs) connectLambda(event); // enables Netlify Blobs (attachment storage) in this function
  context.callbackWaitsForEmptyEventLoop = false;
  try {
    ready ??= init();
    const h = await ready;
    return await h(event, context);
  } catch (e: any) {
    ready = null; // retry setup on the next request
    console.error('A.I. Nonprofits failed to start', e);
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: `Server setup problem: ${e?.message ?? 'unknown error'}. Check the site's environment variables (DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY).` }),
    };
  }
};
