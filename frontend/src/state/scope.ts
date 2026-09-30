// A "scope" is whose timetable a screen shows and how to load it: a workspace member (the /api/w routes),
// a student following a batch code (the /api/public routes) or the signed-out preview of the demo college.

import type { Change, FollowedBatch, Occurrence, Week, WorkspaceFull } from '../contract';
import { api, type WeekFilter } from '../api';
import { mondayOf, nowIn } from '../lib/time';

export interface Scope {
  kind: 'member' | 'student' | 'preview';
  id: string;
  base: string;
  timezone: string;
  /** The offline copy's localStorage key for a week (contract: edusched.cache.<code>.<weekStart> for students). */
  cacheKey: (weekStart: string, f: WeekFilter) => string;
  week: (start: string, f: WeekFilter) => Promise<Week>;
  today: (f: WeekFilter) => Promise<Occurrence[]>;
  changes: (start?: string, end?: string) => Promise<Change[]>;
}

const fkey = (f: WeekFilter) => (f.batch ? `b${f.batch}` : f.teacher ? `t${f.teacher}` : f.room ? `r${f.room}` : 'all');

export function memberScope(full: WorkspaceFull): Scope {
  const slug = full.workspace.slug;
  const w = api.w(slug);
  return {
    kind: 'member', id: `w:${slug}`, base: `/w/${slug}`, timezone: full.workspace.timezone,
    cacheKey: (ws, f) => `edusched.cache.w.${slug}.${fkey(f)}.${ws}`,
    week: (start, f) => w.week(start, f),
    today: (f) => w.today({ batch: f.batch, teacher: f.teacher }),
    changes: (s, e) => w.changes(s, e),
  };
}

export function studentScope(fb: FollowedBatch): Scope {
  const code = fb.code;
  return {
    kind: 'student', id: `b:${code}`, base: `/b/${code}`, timezone: fb.workspace.timezone,
    cacheKey: (ws) => `edusched.cache.${code}.${ws}`,
    week: (start) => api.publicWeek(code, start),
    today: () => api.publicToday(code),
    changes: () => api.publicChanges(code),
  };
}

export const previewScope: Scope = {
  kind: 'preview', id: 'demo', base: '/', timezone: 'Asia/Kolkata',
  cacheKey: (ws) => `edusched.cache.demo.${ws}`,
  week: (start) => api.demoWeek(start),
  today: async () => [],
  changes: async () => [],
};

/** The Monday of the week to show: the ?week= parameter or this week in the workspace's timezone. */
export const weekStartFor = (param: string | null, timezone: string) => mondayOf(param && /^\d{4}-\d{2}-\d{2}$/.test(param) ? param : nowIn(timezone).date);
