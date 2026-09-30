// Batches a student follows on this device (localStorage['edusched.follows'], per the contract), and the sync
// with /api/me/follows once they sign in.

import { useSyncExternalStore } from 'react';
import type { FollowedBatch } from '../contract';
import { api } from '../api';
import { load, save } from '../lib/store';

const KEY = 'edusched.follows';
const listeners = new Set<() => void>();
let current: FollowedBatch[] = load<FollowedBatch[]>(KEY, []);
if (!Array.isArray(current)) current = [];

function set(next: FollowedBatch[]) {
  current = next;
  save(KEY, next.length ? next : null);
  listeners.forEach((l) => l());
}

export const getFollows = () => current;
export function follow(b: FollowedBatch) {
  set([b, ...current.filter((x) => x.code !== b.code)]);
}
export function unfollow(code: string) {
  set(current.filter((x) => x.code !== code));
}

/** Merge this device's batches with the account's and store the union in both places. */
export async function syncFollows() {
  try {
    const remote = await api.follows();
    const codes = [...new Set([...current.map((f) => f.code), ...remote.map((f) => f.code)])];
    const merged = codes.length !== remote.length ? await api.putFollows(codes) : remote;
    set(merged);
    return true;
  } catch {
    return false;
  }
}

export function useFollows() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getFollows,
  );
}
