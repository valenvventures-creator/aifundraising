/**
 * Keys for Netlify, set up the same way as the other Thought Authorities sites:
 * if JWT_SECRET / ENCRYPTION_KEY are not set as environment variables, a random
 * value is generated once and kept in a private Netlify Blobs store, separate from
 * the database. Values you set yourself always win. Must run before server modules
 * load, because config reads these at import time.
 *
 * Uses Blobs' default (eventual) consistency: "strong" reads need Netlify's newer
 * function format. Correctness comes from `onlyIfNew`: whichever start-up saves
 * first wins, and every other one adopts that saved value.
 *
 * ENCRYPTION_KEY protects saved integration credentials. Never change or delete it
 * once data exists, or those credentials become unreadable.
 */
import crypto from 'node:crypto';

const STORE = 'ainp-keys';
export const KEYS = [
  { env: 'JWT_SECRET', blob: 'session-secret-v1', make: () => crypto.randomBytes(48).toString('base64url') },
  { env: 'ENCRYPTION_KEY', blob: 'encryption-key-v1', make: () => crypto.randomBytes(32).toString('base64') },
] as const;

/** The subset of a Netlify Blobs store used here (lets tests supply a fake). */
export interface KeyStore {
  get(key: string, opts: { type: 'text' }): Promise<string | null>;
  set(key: string, value: string, opts: { onlyIfNew: true }): Promise<{ modified: boolean }>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Returns the stored value for `blob`, creating it once if it doesn't exist yet. */
export async function getOrCreateKey(store: KeyStore, blob: string, make: () => string, retryMs = 1000, attempts = 10) {
  const existing = await store.get(blob, { type: 'text' });
  if (existing) return existing;
  const candidate = make();
  const res = await store.set(blob, candidate, { onlyIfNew: true });
  if (res.modified) return candidate; // our value is the one saved
  // Another start-up saved first; its value may take a moment to become readable here.
  for (let i = 0; i < attempts; i++) {
    const v = await store.get(blob, { type: 'text' });
    if (v) return v;
    await sleep(retryMs);
  }
  throw new Error('Security keys are still being created. Please try again in a minute.');
}

export async function ensureNetlifySecrets(storeOverride?: KeyStore) {
  const missing = KEYS.filter((k) => !process.env[k.env]);
  if (!missing.length) return;
  const store: KeyStore = storeOverride ?? ((await import('@netlify/blobs')).getStore({ name: STORE }) as unknown as KeyStore);
  for (const k of missing) process.env[k.env] = await getOrCreateKey(store, k.blob, k.make);
}
