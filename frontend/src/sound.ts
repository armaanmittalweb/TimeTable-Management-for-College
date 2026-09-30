// Split-flap clatter, synthesized: each flap is ~20 ms of band-passed noise.
// Nothing is created until the visitor's first click or key press (browsers
// require a gesture for audio). Reduced motion means no sound at all.

import { useSyncExternalStore } from 'react';

const PREF_KEY = 'edusched.sound';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let unlocked = false;
let enabled = readPref();
const listeners = new Set<() => void>();
const recent = new Set<number>();

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function emit() {
  for (const l of listeners) l();
}

function unlock() {
  if (unlocked) return;
  unlocked = true;
  window.removeEventListener('pointerdown', unlock, true);
  window.removeEventListener('keydown', unlock, true);
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.04), ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    void ctx.resume();
  } catch {
    ctx = null;
  }
  emit();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
}

/** One flap, `delayMs` from now. Near-simultaneous flaps are merged so a big change stays quiet. */
export function flap(delayMs = 0) {
  if (!enabled || !ctx || !master || !noise || ctx.state !== 'running' || reducedMotion()) return;
  const t = ctx.currentTime + delayMs / 1000 + 0.005;
  const bucket = Math.round(t * 150);
  if (recent.has(bucket)) return;
  if (recent.size > 400) recent.clear();
  recent.add(bucket);

  const src = ctx.createBufferSource();
  src.buffer = noise;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1700 + Math.random() * 1600;
  band.Q.value = 1.8;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.09, t + 0.0015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.024);
  src.connect(band).connect(gain).connect(master);
  src.start(t);
  src.stop(t + 0.03);
}

export function setSound(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    /* preference just won't persist */
  }
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** [sound on, audio unlocked by a gesture yet] */
export function useSound(): [boolean, boolean] {
  const on = useSyncExternalStore(subscribe, () => enabled, () => enabled);
  const ready = useSyncExternalStore(subscribe, () => unlocked, () => false);
  return [on, ready];
}
