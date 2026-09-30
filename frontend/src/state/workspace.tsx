import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Occurrence, WorkspaceFull } from '../contract';
import { memberScope, type Scope } from './scope';

export interface WsValue {
  full: WorkspaceFull;
  scope: Scope;
  reload: () => void;
  offlineSince: number | null;
}

const Ctx = createContext<WsValue | null>(null);

export function WorkspaceProvider({ full, reload, offlineSince, children }: { full: WorkspaceFull; reload: () => void; offlineSince: number | null; children: ReactNode }) {
  const scope = useMemo(() => memberScope(full), [full]);
  const value = useMemo(() => ({ full, scope, reload, offlineSince }), [full, scope, reload, offlineSince]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useWs = () => useContext(Ctx);

/** Whether the current person may cancel, move or undo this occurrence. */
export function canChange(full: WorkspaceFull | null | undefined, o: Occurrence) {
  if (!full) return false;
  if (full.role === 'coordinator') return true;
  return full.role === 'teacher' && full.teacherId === o.teacher.id;
}
