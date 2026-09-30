// Rate limits and body size limits (contract "Limits").

import type { Context, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AppEnv, Bindings } from './env';
import { HttpError } from './http';

export const LIMITS = {
  rooms: 200,
  teachers: 300,
  batches: 200,
  courses: 500,
  classes: 3000,
} as const;

export const JSON_BODY_BYTES = 64 * 1024;
export const IMPORT_BODY_BYTES = 512 * 1024;

export const clientIp = (c: Context) => c.req.header('cf-connecting-ip') ?? 'local';

/**
 * Workers rate limit binding, keyed per client IP. A missing binding (tests,
 * dev-local, or a deploy without `ratelimits`) means no limit rather than an error.
 */
export function rateLimit(binding: keyof Pick<Bindings, 'AUTH_LIMITER' | 'PUBLIC_LIMITER'>): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const limiter = c.env?.[binding];
    if (limiter) {
      const { success } = await limiter.limit({ key: `${binding}:${clientIp(c)}` });
      if (!success) throw new HttpError(429, 'rate_limited', 'Too many attempts. Wait a minute and try again.');
    }
    await next();
  };
}

const tooLarge = (bytes: number) => () => {
  throw new HttpError(413, 'too_large', `That request is too large (the limit is ${bytes / 1024} KB).`);
};

const jsonLimit = bodyLimit({ maxSize: JSON_BODY_BYTES, onError: tooLarge(JSON_BODY_BYTES) });
const importLimit = bodyLimit({ maxSize: IMPORT_BODY_BYTES, onError: tooLarge(IMPORT_BODY_BYTES) });

/** CSV imports get 512 KB; every other body 64 KB. */
export const bodyLimits: MiddlewareHandler<AppEnv> = (c, next) =>
  (/^\/api\/w\/[^/]+\/import$/.test(c.req.path) ? importLimit : jsonLimit)(c, next);
