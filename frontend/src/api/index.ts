// The typed EduSched client. Every call goes through one transport: the real one (fetch with the session cookie)
// or the in-memory mock (VITE_API=mock), which answers the same paths with the same shapes and status codes.

import type {
  ApiError, Batch, Change, ClassRow, Clash, Course, ErrorCode, FollowedBatch, ImportReport, Invite, Me, Member, Occurrence, Period, Room,
  SessionInfo, SlotAvailability, Teacher, Week, WorkspaceFull, WorkspaceSummary,
} from '../contract';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export interface RawResponse { status: number; body: unknown; text?: string }
export type Transport = (method: Method, path: string, body?: unknown) => Promise<RawResponse>;

export const API_URL = (import.meta.env.VITE_API_URL || 'https://edusched-api.amittal.dev').replace(/\/+$/, '');
export const IS_MOCK = import.meta.env.VITE_API === 'mock';

/** A failed call. `offline` is set when the request never reached the API. */
export class ApiFailure extends Error {
  status: number;
  code: ErrorCode;
  offline: boolean;
  clashes: Clash[];
  suggestion: SlotAvailability | null;
  constructor(status: number, body: Partial<ApiError> | null, offline = false) {
    super(body?.error || (offline ? 'You are offline, or the timetable server cannot be reached.' : 'Something went wrong on our side. Try again in a moment.'));
    this.status = status;
    this.offline = offline;
    this.code = body?.code || (status === 401 ? 'unauthenticated' : status === 403 ? 'forbidden' : status === 404 ? 'not_found' : status === 429 ? 'rate_limited' : 'server');
    this.clashes = body?.clashes ?? [];
    this.suggestion = body?.suggestion ?? null;
  }
}

export const httpTransport: Transport = async (method, path, body) => {
  const init: RequestInit = { method, credentials: 'include', headers: { Accept: 'application/json' } };
  if (method !== 'GET') {
    // Every state-changing request carries JSON (the API's CSRF defence relies on the preflight this forces).
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body ?? {});
  }
  let res: Response;
  try {
    res = await fetch(API_URL + path, init);
  } catch {
    throw new ApiFailure(0, null, true);
  }
  if (res.status === 204) return { status: 204, body: null };
  const type = res.headers.get('Content-Type') || '';
  if (type.includes('application/json')) {
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  }
  const text = await res.text().catch(() => '');
  return { status: res.status, body: null, text };
};

let transport: Transport = httpTransport;
export const setTransport = (t: Transport) => {
  transport = t;
};

async function call<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const res = await transport(method, path, body);
  if (res.status >= 200 && res.status < 300) return (res.body ?? res.text ?? null) as T;
  throw new ApiFailure(res.status, (res.body as Partial<ApiError>) || null);
}

const q = (params: Record<string, string | number | null | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
};
const enc = encodeURIComponent;

export type WeekFilter = { batch?: number; teacher?: number; room?: number };
export type ImportKind = 'rooms' | 'teachers' | 'batches' | 'courses' | 'classes';

export const api = {
  // Account
  signup: (b: { name: string; email: string; password: string }) => call<Me>('POST', '/api/auth/signup', b),
  login: (b: { email: string; password: string }) => call<Me>('POST', '/api/auth/login', b),
  logout: () => call<null>('POST', '/api/auth/logout'),
  me: () => call<Me>('GET', '/api/auth/me'),
  updateMe: (b: { name?: string; email?: string }) => call<Me>('PATCH', '/api/auth/me', b),
  sessions: () => call<SessionInfo[]>('GET', '/api/auth/sessions'),
  endSession: (id: string) => call<null>('DELETE', `/api/auth/sessions/${enc(id)}`),
  changePassword: (b: { current: string; next: string }) => call<null>('POST', '/api/auth/password', b),
  reset: (b: { email: string; code: string; password: string }) => call<null>('POST', '/api/auth/reset', b),
  deleteAccount: (b: { password: string }) => call<null>('DELETE', '/api/auth/account', b),
  follows: () => call<FollowedBatch[]>('GET', '/api/me/follows'),
  putFollows: (codes: string[]) => call<FollowedBatch[]>('PUT', '/api/me/follows', { codes }),

  // Workspaces
  createWorkspace: (b: { name: string; institution: string; timezone?: string }) => call<WorkspaceSummary>('POST', '/api/workspaces', b),
  join: (code: string) => call<{ workspace: WorkspaceSummary } | FollowedBatch>('POST', '/api/join', { code }),

  // Demo
  startDemo: () => call<Me>('POST', '/api/demo'),
  demoWeek: (start?: string, batch?: string) => call<Week>('GET', `/api/demo/week${q({ start, batch })}`),

  // Students
  publicBatch: (code: string) => call<FollowedBatch>('GET', `/api/public/${enc(code)}`),
  publicWeek: (code: string, start?: string) => call<Week>('GET', `/api/public/${enc(code)}/week${q({ start })}`),
  publicToday: (code: string) => call<Occurrence[]>('GET', `/api/public/${enc(code)}/today`),
  publicChanges: (code: string) => call<Change[]>('GET', `/api/public/${enc(code)}/changes`),

  /** Everything under /api/w/:slug. */
  w(slug: string) {
    const W = `/api/w/${enc(slug)}`;
    const crud = <T, B>(name: string) => ({
      list: () => call<T[]>('GET', `${W}/${name}`),
      create: (b: B) => call<T>('POST', `${W}/${name}`, b),
      update: (id: number, b: Partial<B>) => call<T>('PATCH', `${W}/${name}/${id}`, b),
      remove: (id: number) => call<null>('DELETE', `${W}/${name}/${id}`),
    });
    return {
      get: () => call<WorkspaceFull>('GET', W),
      patch: (b: Partial<{ name: string; institution: string; timezone: string; days: number[] }>) => call<WorkspaceSummary>('PATCH', W, b),
      publish: () => call<WorkspaceSummary>('POST', `${W}/publish`),
      unpublish: () => call<WorkspaceSummary>('POST', `${W}/unpublish`),
      putPeriods: (periods: Period[]) => call<Period[]>('PUT', `${W}/periods`, periods),
      rooms: crud<Room, Omit<Room, 'id'>>('rooms'),
      teachers: crud<Teacher, Omit<Teacher, 'id' | 'hasAccount'>>('teachers'),
      batches: crud<Batch, Omit<Batch, 'id' | 'code'>>('batches'),
      courses: crud<Course, Omit<Course, 'id'>>('courses'),
      classes: crud<ClassRow, Omit<ClassRow, 'id'>>('classes'),
      rotateCode: (batchId: number) => call<Batch>('POST', `${W}/batches/${batchId}/code`),
      import: (b: { kind: ImportKind; csv: string; dryRun: boolean }) => call<ImportReport>('POST', `${W}/import`, b),
      template: (kind: ImportKind) => call<string>('GET', `${W}/import/template/${kind}`),
      members: () => call<Member[]>('GET', `${W}/members`),
      removeMember: (userId: number) => call<null>('DELETE', `${W}/members/${userId}`),
      setRole: (userId: number, role: 'coordinator' | 'teacher') => call<Member>('PATCH', `${W}/members/${userId}`, { role }),
      invites: () => call<Invite[]>('GET', `${W}/invites`),
      invite: (b: { role: 'teacher' | 'coordinator'; teacherId?: number }) => call<{ code: string; expiresAt: string }>('POST', `${W}/invites`, b),
      revokeInvite: (code: string) => call<null>('DELETE', `${W}/invites/${enc(code)}`),
      resetCode: (userId: number) => call<{ code: string; expiresAt: string }>('POST', `${W}/members/${userId}/reset-code`),
      week: (start: string | undefined, f: WeekFilter) => call<Week>('GET', `${W}/week${q({ start, ...f })}`),
      today: (f: { batch?: number; teacher?: number }) => call<Occurrence[]>('GET', `${W}/today${q(f)}`),
      changes: (start?: string, end?: string) => call<Change[]>('GET', `${W}/changes${q({ start, end })}`),
      freeRooms: (b: { date: string; start: string; end: string; exclude?: number }) => call<Room[]>('GET', `${W}/free-rooms${q(b)}`),
      slots: (classId: number, week: string, from?: string) => call<SlotAvailability[]>('GET', `${W}/classes/${classId}/slots${q({ week, from })}`),
      cancel: (classId: number, b: { date: string; reason?: string }) => call<Change>('POST', `${W}/classes/${classId}/cancel`, b),
      move: (classId: number, b: { date: string; toDate: string; toStart: string; toEnd: string; roomId: number; reason?: string }) =>
        call<Change>('POST', `${W}/classes/${classId}/move`, b),
      undo: (changeId: number) => call<null>('DELETE', `${W}/changes/${changeId}`),
      feed: (b: { kind: 'batch' | 'teacher' | 'room'; targetId: number }) => call<{ url: string }>('POST', `${W}/feeds`, b),
      actAs: (b: { role: 'coordinator' } | { role: 'teacher'; teacherId: number } | { role: 'student'; batchId: number }) => call<Me>('POST', `${W}/demo/act-as`, b),
    };
  },
};

/** The .ics address for a batch code (students need no account for it). */
export const batchFeedUrl = (code: string) => `${API_URL}/ics/b/${encodeURIComponent(code)}.ics`;
