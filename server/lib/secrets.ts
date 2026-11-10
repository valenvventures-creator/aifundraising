/**
 * Keys for Netlify, set up the same way as the other Thought Authorities sites:
 * if JWT_SECRET / ENCRYPTION_KEY are not set as environment variables, a random
 * value is generated once and kept in a private Netlify Blobs store, separate from
 * the database. Values you set yourself always win. Must run before server modules
 * load, because config reads these at import time.
 *
 * ENCRYPTION_KEY protects saved integration credentials. Never change or delete it
 * once data exists, or those credentials become unreadable.
 */
import crypto from 'node:crypto';

const STORE = 'ainp-keys';
const KEYS = [
  { env: 'JWT_SECRET', blob: 'session-secret-v1', make: () => crypto.randomBytes(48).toString('base64url') },
  { env: 'ENCRYPTION_KEY', blob: 'encryption-key-v1', make: () => crypto.randomBytes(32).toString('base64') },
] as const;

export async function ensureNetlifySecrets() {
  const missing = KEYS.filter((k) => !process.env[k.env]);
  if (!missing.length) return;
  const { getStore } = await import('@netlify/blobs');
  const store = getStore({ name: STORE, consistency: 'strong' });
  for (const k of missing) {
    let value: string | null = await store.get(k.blob, { type: 'text' });
    if (!value) {
      // onlyIfNew: if two cold starts race, both end up with the first value written.
      await store.set(k.blob, k.make(), { onlyIfNew: true });
      value = await store.get(k.blob, { type: 'text' });
    }
    if (!value) throw new Error(`Could not create ${k.env} in Netlify Blobs.`);
    process.env[k.env] = value;
  }
}
