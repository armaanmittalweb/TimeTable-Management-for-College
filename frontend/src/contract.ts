export type Role = 'coordinator' | 'teacher' | 'student'
export type ErrorCode = 'bad_request' | 'unauthenticated' | 'forbidden' | 'not_found' | 'conflict' | 'clash' | 'rate_limited' | 'too_large' | 'server'
export interface ApiError { error: string; code: ErrorCode; clashes?: Clash[]; suggestion?: SlotAvailability | null }
export interface Me {
  user: { id: number; name: string; email: string } | null        // null for a demo guest
  demo: { workspace: string; actingAs: { role: Role; teacherId?: number; batchId?: number }; expiresAt: string } | null
  memberships: { workspace: WorkspaceSummary; role: 'coordinator' | 'teacher'; teacherId: number | null }[]
}
export interface WorkspaceSummary { id: number; slug: string; name: string; institution: string; timezone: string; published: boolean; isDemo: boolean }
export interface Period { idx: number; start: string; end: string; label: string | null; isBreak: boolean }
export interface Room { id: number; name: string; capacity: number; building: string | null; kind: 'lecture' | 'lab' }
export interface Teacher { id: number; name: string; short: string; email: string | null; hasAccount: boolean }
export interface Batch { id: number; name: string; size: number | null; code: string }
export interface Course { id: number; code: string; name: string; color: number; teacherId: number | null }
export interface ClassRow { id: number; courseId: number; batchId: number; teacherId: number; roomId: number; day: number; start: string; end: string }
export interface WorkspaceFull {
  workspace: WorkspaceSummary & { days: number[] }
  role: Role; teacherId: number | null; batchId: number | null    // batchId only for a demo guest acting as a student
  periods: Period[]; rooms: Room[]; teachers: Teacher[]; batches: Batch[]; courses: Course[]; classes: ClassRow[]
}
export interface Occurrence {
  key: string                    // `${classId}:${date}`; a moved-in copy is `${classId}:${date}:to`
  classId: number
  date: string; start: string; end: string
  course: { id: number; code: string; name: string; color: number }
  teacher: { id: number; name: string; short: string }
  room: { id: number; name: string }
  batch: { id: number; name: string }
  status: 'scheduled' | 'cancelled' | 'moved-away' | 'moved-here'
  change: Change | null
}
export interface Week { start: string; end: string; days: string[]; timezone: string; periods: Period[]; occurrences: Occurrence[]; today: string }
export interface Change {
  id: number; classId: number; kind: 'cancelled' | 'moved'
  course: { code: string; name: string; color: number }; batch: { id: number; name: string }
  from: { date: string; start: string; end: string; room: string }
  to: { date: string; start: string; end: string; room: string } | null
  reason: string | null; by: string; at: string
}
export interface Clash { type: 'room' | 'teacher' | 'batch'; classId: number; course: string; start: string; end: string; room: string | null }
export interface SlotAvailability { date: string; start: string; end: string; teacherBusy: boolean; batchBusy: boolean; freeRooms: { id: number; name: string; capacity: number }[] }
export interface FollowedBatch { code: string; workspace: { name: string; institution: string; timezone: string; days: number[] }; batch: { id: number; name: string }; periods: Period[] }
export interface SessionInfo { id: string; current: boolean; userAgent: string | null; createdAt: string; lastSeenAt: string }
export interface ImportReport { ok: boolean; created: number; updated: number; errors: { line: number; column?: string; message: string }[] }
export interface Member { userId: number; name: string; email: string; role: 'coordinator' | 'teacher'; teacherId: number | null }
export interface Invite { code: string; role: 'teacher' | 'coordinator'; teacherId: number | null; expiresAt: string; createdAt: string }
