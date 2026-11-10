import 'dotenv/config';
import crypto from 'node:crypto';

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 4000),
  // On Netlify, URL is the site's primary address (pages and API share it).
  appUrl: process.env.APP_URL ?? process.env.URL ?? 'http://localhost:5173',
  apiUrl: process.env.API_URL ?? process.env.URL ?? 'http://localhost:4000',
  // NETLIFY_DATABASE_URL is set automatically by Netlify DB (Neon).
  databaseUrl: process.env.DATABASE_URL ?? process.env.NETLIFY_DATABASE_URL ?? (isProd ? req('DATABASE_URL') : 'postgres://ainp:ainp@localhost:5432/ainp'),
  jwtSecret: isProd ? req('JWT_SECRET') : (process.env.JWT_SECRET ?? 'dev-only-jwt-secret-change-me'),
  // 32-byte key (hex or base64) used to encrypt integration credentials at rest.
  encryptionKey: (() => {
    const raw = process.env.ENCRYPTION_KEY;
    if (!raw) {
      if (isProd) throw new Error('ENCRYPTION_KEY is required in production');
      return crypto.createHash('sha256').update('dev-only-encryption-key').digest();
    }
    const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (buf.length !== 32) throw new Error('ENCRYPTION_KEY must decode to 32 bytes');
    return buf;
  })(),
  storageDir: process.env.STORAGE_DIR ?? './storage',
  anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-opus-5-5',
  aiEnabled: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
  smtp: process.env.SMTP_HOST ? {
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER, pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM ?? 'A.I. Nonprofits <no-reply@example.org>',
  } : null,
  quickbooks: {
    clientId: process.env.QBO_CLIENT_ID, clientSecret: process.env.QBO_CLIENT_SECRET,
    environment: (process.env.QBO_ENVIRONMENT ?? 'sandbox') as 'sandbox' | 'production',
  },
  google: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            mapsKey: process.env.GOOGLE_MAPS_API_KEY },
  stripe: { clientId: process.env.STRIPE_CONNECT_CLIENT_ID },
  plaid: { clientId: process.env.PLAID_CLIENT_ID, secret: process.env.PLAID_SECRET, env: process.env.PLAID_ENV ?? 'sandbox' },
  runJobs: process.env.RUN_JOBS !== 'false',
};
