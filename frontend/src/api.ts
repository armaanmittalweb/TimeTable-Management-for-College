// Typed client for the EduSched API (../api). Attaches the bearer token and the
// demo sandbox id, keeps the sandbox id the server issues, and turns failures
// into three typed errors: ClashError (409 with clashes), ApiError (any other
// non-2xx), Unreachable (no response at all).

export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8787').replace(/\/+$/, '');

export type Role = 'student' | 'professor';

export interface ClassRow {
  id: number;
  course_id: number;
  batch: string;
  day_of_week: number; // ISO, 1 = Monday
  start_time: string; // HH:MM:SS
  end_time: string;
  classroom_id: number | null;
  course_name: string;
  course_code: string;
  room_number: string | null;
  building: string | null;
  faculty_name: string | null;
  modification_type: 'cancelled' | 'postponed' | null;
  new_date: string | null; // YYYY-MM-DD
  new_start_time: string | null;
  new_end_time: string | null;
  new_classroom_id: number | null;
  new_room_number: string | null;
  new_building: string | null;
}

export interface Room {
  id: number;
  room_number: string;
  capacity: number;
  building: string | null;
}

export interface Clash {
  type: 'room' | 'professor';
  class_id: number;
  course_code: string;
  course_name: string;
  room_number: string | null;
  start_time: string;
  end_time: string;
}

export interface Slot {
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string;
}

export interface PostponeInput {
  classId: number;
  newDate: string;
  newStartTime: string;
  newEndTime: string;
  newClassroomId: number;
}

/** A successful response plus how long the request took in the browser, in ms. */
export interface Timed<T> {
  data: T;
  status: number;
  ms: number;
}

export class ApiError extends Error {
  readonly status: number;
  readonly ms: number;
  constructor(status: number, message: string, ms: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.ms = ms;
  }
}

export class ClashError extends ApiError {
  readonly clashes: Clash[];
  constructor(message: string, clashes: Clash[], ms: number) {
    super(409, message, ms);
    this.name = 'ClashError';
    this.clashes = clashes;
  }
}

export class Unreachable extends Error {
  constructor() {
    super(`API unreachable at ${API_URL}`);
    this.name = 'Unreachable';
  }
}

// ------------------------------------------------------------------ sandbox id

const SANDBOX_KEY = 'edusched.sandbox';
const SANDBOX_FORMAT = /^[A-Za-z0-9_-]{16,64}$/;

function readStoredSandbox(): string | null {
  try {
    const v = localStorage.getItem(SANDBOX_KEY);
    return v && SANDBOX_FORMAT.test(v) ? v : null;
  } catch {
    return null;
  }
}

let sandboxId: string | null = readStoredSandbox();
/** The first sandboxed request made without an id; others wait so they all share the id it gets back. */
let firstContact: Promise<unknown> | null = null;

function storeSandbox(id: string | null) {
  sandboxId = id;
  try {
    if (id) localStorage.setItem(SANDBOX_KEY, id);
    else localStorage.removeItem(SANDBOX_KEY);
  } catch {
    /* storage blocked: the id still lives for this page */
  }
}

export const getSandboxId = () => sandboxId;

/** Forget the sandbox. The next timetable request gets a fresh, empty one from the server. */
export function dropSandbox() {
  storeSandbox(null);
}

// ------------------------------------------------------------------ requests

interface Options {
  token?: string;
  body?: unknown;
  /** Timetable routes: send and keep X-Sandbox-Id. */
  sandboxed?: boolean;
}

async function request<T>(method: 'GET' | 'POST', path: string, opts: Options = {}): Promise<Timed<T>> {
  // No await before `firstContact` is set below, so concurrent callers queue correctly.
  if (opts.sandboxed && !sandboxId && firstContact) await firstContact.catch(() => {});

  const run = (async () => {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.sandboxed && sandboxId) headers['X-Sandbox-Id'] = sandboxId;

    const t0 = performance.now();
    let res: Response;
    let text: string;
    try {
      res = await fetch(API_URL + path, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });
      text = await res.text();
    } catch {
      throw new Unreachable();
    }
    const ms = Math.round(performance.now() - t0);

    const issued = res.headers.get('X-Sandbox-Id');
    if (opts.sandboxed && issued && SANDBOX_FORMAT.test(issued) && issued !== sandboxId) storeSandbox(issued);

    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body (e.g. a proxy error page) */
    }
    if (!res.ok) {
      const message = typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`;
      if (res.status === 409 && Array.isArray(data?.clashes)) throw new ClashError(message, data.clashes, ms);
      throw new ApiError(res.status, message, ms);
    }
    return { data: data as T, status: res.status, ms };
  })();

  if (opts.sandboxed && !sandboxId && !firstContact) {
    firstContact = run;
    run.then(
      () => (firstContact = null),
      () => (firstContact = null),
    );
  }
  return run;
}

export const api = {
  login: (username: string, password: string) =>
    request<{ token: string }>('POST', '/api/auth/login', { body: { username, password } }),

  timetable: (token: string) => request<ClassRow[]>('GET', '/api/timetable/timetable', { token, sandboxed: true }),

  availableRooms: (token: string, slot: Slot, classId?: number) =>
    request<Room[]>('POST', '/api/timetable/available-rooms', {
      token,
      sandboxed: true,
      body: { ...slot, classId },
    }),

  cancel: (token: string, classId: number) =>
    request<{ message: string }>('POST', '/api/timetable/cancel-class', { token, sandboxed: true, body: { classId } }),

  postpone: (token: string, input: PostponeInput) =>
    request<{ message: string; id: number }>('POST', '/api/timetable/postpone-class', {
      token,
      sandboxed: true,
      body: input,
    }),
};

/** Payload of the API's HS256 JWT ({id, role, batch}); the signature is the server's business. */
export function decodeToken(token: string): { id: number; role: Role; batch: string | null } {
  const part = token.split('.')[1] ?? '';
  const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
  return JSON.parse(json);
}
