/**
 * File storage for attachments and receipt photos.
 * - Local disk (STORAGE_DIR) for a normal Node server or Docker.
 * - Netlify Blobs when running as a Netlify Function (AINP_STORAGE=netlify-blobs),
 *   because function file systems are temporary.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const useBlobs = () => process.env.AINP_STORAGE === 'netlify-blobs';

async function blobStore() {
  const { getStore } = await import('@netlify/blobs');
  // Default (eventual) consistency: strong reads need Netlify's newer function format. File keys are
  // random and never read before they are written, so a new upload is readable straight away.
  return getStore({ name: 'attachments' });
}

function localPath(key: string) {
  const root = path.resolve(config.storageDir);
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error('Invalid storage key');
  return full;
}

export async function putFile(key: string, data: Buffer) {
  if (useBlobs()) {
    const store = await blobStore();
    const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    await store.set(key, ab);
    return;
  }
  const full = localPath(key);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, data);
}

/** Returns the file contents, or null if it does not exist. */
export async function getFile(key: string): Promise<Buffer | null> {
  if (useBlobs()) {
    const store = await blobStore();
    const ab = await store.get(key, { type: 'arrayBuffer' });
    return ab ? Buffer.from(ab) : null;
  }
  const full = localPath(key);
  return fs.existsSync(full) ? fs.readFileSync(full) : null;
}
