/**
 * Netlify Function (modern format, same as the other Thought Authorities sites) that
 * runs the A.I. Nonprofits API for every /api/*, /webhooks/* and /t/* request.
 * Netlify Database (NETLIFY_DB_URL) and Netlify Blobs are available automatically.
 * The server itself is compiled into ../server-dist/app.mjs during the build.
 */
import serverless from 'serverless-http';

process.env.AINP_SERVERLESS = '1';
process.env.AINP_STORAGE ??= 'netlify-blobs';
if (!process.env.NETLIFY_DEV) process.env.NODE_ENV ??= 'production';

type LambdaHandler = (event: any, context: any) => Promise<any>;
let ready: Promise<LambdaHandler> | null = null;

const BINARY = ['application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream', 'image/*', 'application/zip'];

async function init(): Promise<LambdaHandler> {
  const { createNetlifyApp } = await import('../server-dist/app.mjs');
  const app = await createNetlifyApp();
  return serverless(app, { binary: BINARY }) as unknown as LambdaHandler;
}

/** Translate a web Request into the event shape the Express adapter expects, and back. */
async function toEvent(request: Request, context: any) {
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  const multiValueHeaders: Record<string, string[]> = {};
  request.headers.forEach((v, k) => { headers[k] = v; (multiValueHeaders[k] ??= []).push(v); });
  const query: Record<string, string> = {};
  const multiQuery: Record<string, string[]> = {};
  url.searchParams.forEach((v, k) => { query[k] = v; (multiQuery[k] ??= []).push(v); });
  const hasBody = !['GET', 'HEAD'].includes(request.method);
  const body = hasBody ? Buffer.from(await request.arrayBuffer()) : null;
  if (context?.ip && !headers['x-nf-client-connection-ip']) headers['x-nf-client-connection-ip'] = context.ip;
  headers.host ??= url.host; // used by the same-site check on form submissions
  return {
    httpMethod: request.method, path: url.pathname, headers, multiValueHeaders,
    queryStringParameters: query, multiValueQueryStringParameters: multiQuery,
    body: body && body.length ? body.toString('base64') : null, isBase64Encoded: Boolean(body && body.length),
    requestContext: { identity: { sourceIp: context?.ip } },
  };
}

function toResponse(r: any) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(r.headers ?? {})) if (v !== undefined) headers.set(k, String(v));
  for (const [k, vs] of Object.entries(r.multiValueHeaders ?? {})) {
    headers.delete(k);
    for (const v of vs as unknown[]) headers.append(k, String(v));
  }
  const noBody = r.statusCode === 204 || r.statusCode === 304 || !r.body;
  const body = noBody ? null : r.isBase64Encoded ? Buffer.from(r.body, 'base64') : r.body;
  return new Response(body, { status: r.statusCode ?? 200, headers });
}

export default async (request: Request, context: any) => {
  try {
    ready ??= init();
    const handler = await ready;
    return toResponse(await handler(await toEvent(request, context), { callbackWaitsForEmptyEventLoop: false }));
  } catch (e: any) {
    ready = null; // retry setup on the next request
    console.error('A.I. Nonprofits failed to start', e);
    const msg = String(e?.message ?? 'unknown error').replace(/\.\s*$/, '');
    return Response.json({ error: `Server setup problem: ${msg}. If this keeps happening, see README › Deploying on Netlify.` }, { status: 500 });
  }
};

export const config = { path: ['/api/*', '/webhooks/*', '/t/*'] };
