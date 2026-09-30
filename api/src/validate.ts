// Field validators for request bodies and query strings. Each throws a 400 with a
// sentence naming the field, so handlers read top to bottom without if-chains.

import type { Context } from 'hono';
import { hhmm, isDate, isTime } from './dates';
import { badRequest, fieldError, notFound } from './http';

export type Body = Record<string, unknown>;

/** The JSON object body; 400 when it is missing or not an object. */
export async function readBody(c: Context): Promise<Body> {
  const body = await c.req.json().catch(() => undefined);
  if (body === undefined) return {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('The request body must be a JSON object.');
  return body as Body;
}

/** A JSON array body (PUT periods). */
export async function readArray(c: Context): Promise<unknown[]> {
  const body = await c.req.json().catch(() => undefined);
  if (!Array.isArray(body)) throw badRequest('The request body must be a JSON array.');
  return body;
}

export function text(v: unknown, field: string, max = 120): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw fieldError(field, `${field} is required.`);
  if (s.length > max) throw fieldError(field, `${field} must be at most ${max} characters.`);
  return s;
}

export function optText(v: unknown, field: string, max = 120): string | null {
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) return null;
  return text(v, field, max);
}

export function int(v: unknown, field: string, min = 1, max = 1_000_000): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
    throw fieldError(field, `${field} must be a whole number from ${min} to ${max}.`);
  }
  return n;
}

export const optInt = (v: unknown, field: string, min = 1, max = 1_000_000) =>
  v === undefined || v === null || v === '' ? null : int(v, field, min, max);

export function id(v: unknown, field: string): number {
  return int(v, field, 1, 2_147_483_647);
}

export const optId = (v: unknown, field: string) => (v === undefined || v === null || v === '' ? null : id(v, field));

/** A path id; anything that is not a positive integer cannot exist, so 404. */
export function pathId(c: Context, name = 'id'): number {
  const v = c.req.param(name);
  const n = Number(v);
  if (!v || !/^\d{1,10}$/.test(v) || n < 1 || n > 2_147_483_647) throw notFound();
  return n;
}

export function date(v: unknown, field: string): string {
  if (!isDate(v)) throw fieldError(field, `${field} must be a date like 2026-09-29.`);
  return v;
}

export function time(v: unknown, field: string): string {
  if (!isTime(v)) throw fieldError(field, `${field} must be a time like 09:00.`);
  return hhmm(v);
}

export function oneOf<T extends string>(v: unknown, field: string, values: readonly T[]): T {
  if (!values.includes(v as T)) throw fieldError(field, `${field} must be one of: ${values.join(', ')}.`);
  return v as T;
}

export function bool(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') throw fieldError(field, `${field} must be true or false.`);
  return v;
}

export function password(v: unknown, field = 'password'): string {
  if (typeof v !== 'string' || v.length < 10) throw fieldError(field, 'Use a password of at least 10 characters.');
  if (v.length > 200) throw fieldError(field, `${field} must be at most 200 characters.`);
  return v;
}

export function email(v: unknown): string {
  const s = text(v, 'email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw fieldError('email', 'Enter a valid email address.');
  return s;
}
