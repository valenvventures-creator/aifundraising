import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: any) { super(message); }
}

const NO_SERVER = 'Can’t reach the A.I. Nonprofits server. The web app is running without its API — it must be started with `npm start` (or Docker), not hosted as static files. See README › Deploying.';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method, credentials: 'include',
      headers: body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, NO_SERVER);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    // A non-JSON 404/405/502 means the web pages were served without the A.I. Nonprofits API behind them.
    if (!ct.includes('json') && [404, 405, 502, 503, 504].includes(res.status)) throw new ApiError(res.status, NO_SERVER);
    if (res.status === 401 && !url.startsWith('/auth')) window.dispatchEvent(new CustomEvent('ainp:unauthorized'));
    throw new ApiError(res.status, (data as any)?.error ?? `Request failed (${res.status})`, (data as any)?.details);
  }
  return data as T;
}

export const api = {
  get: <T = any>(url: string) => request<T>('GET', url),
  post: <T = any>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T = any>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  patch: <T = any>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  del: <T = any>(url: string) => request<T>('DELETE', url),
  upload: <T = any>(url: string, form: FormData) => request<T>('POST', url, form),
};

/** Open a server-generated file (PDF/CSV/XLSX) in a new tab/download. */
export function download(url: string) { window.open(`/api${url}`, '_blank', 'noopener'); }

/** POST that returns a file (e.g. batch receipt PDFs). */
export async function downloadPost(url: string, body: unknown, filename: string) {
  const res = await fetch(`/api${url}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).error ?? 'Download failed');
  const blob = await res.blob();
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}

export function qs(params: Record<string, unknown>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Fetch hook with loading/error state and reload(). */
export function useApi<T = any>(url: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!url) { setLoading(false); return; }
    const n = ++seq.current;
    setLoading(true); setError(null);
    try { const d = await api.get<T>(url); if (n === seq.current) setData(d); }
    catch (e: any) { if (n === seq.current) setError(e.message); }
    finally { if (n === seq.current) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}
