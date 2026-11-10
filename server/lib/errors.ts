export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}
export const badRequest = (m: string, d?: unknown) => new HttpError(400, m, d);
export const forbidden = (m = 'You do not have permission to do that.') => new HttpError(403, m);
export const notFound = (what = 'Record') => new HttpError(404, `${what} not found.`);
export const conflict = (m: string, d?: unknown) => new HttpError(409, m, d);
