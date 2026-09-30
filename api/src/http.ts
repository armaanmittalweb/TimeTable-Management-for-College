// Every non-2xx body is { error, code, ...extra } (contract "Errors"). Handlers and
// helpers throw HttpError; app.onError turns it into the response, so a refusal
// deep in a helper does not need to be threaded back through return values.

import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ErrorCode } from './contract';

export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
    readonly extra: Record<string, unknown> = {},
    /** The body field or CSV column at fault, for import reports; not sent in the body. */
    readonly field?: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, extra?: Record<string, unknown>) =>
  new HttpError(400, 'bad_request', message, extra);
export const fieldError = (field: string, message: string) => new HttpError(400, 'bad_request', message, {}, field);
export const unauthenticated = (message = 'Sign in to continue.') => new HttpError(401, 'unauthenticated', message);
export const forbidden = (message: string) => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Not found.') => new HttpError(404, 'not_found', message);
export const conflict = (message: string, extra?: Record<string, unknown>) =>
  new HttpError(409, 'conflict', message, extra);

export function errorBody(c: Context, err: HttpError) {
  return c.json({ error: err.message, code: err.code, ...err.extra }, err.status);
}

/** Postgres unique_violation, e.g. two rooms with one name; optionally of one named constraint. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string; message?: string } | null;
  if (e?.code !== '23505') return false;
  return !constraint || e.constraint === constraint || String(e.message).includes(constraint);
}
