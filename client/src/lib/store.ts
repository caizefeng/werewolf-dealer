// Tiny global store with a Preact hook.
import { useEffect, useReducer } from 'preact/hooks';
import type { RoomView } from '../../../shared/types.ts';

export interface AppState {
  view: RoomView | null;
  conn: 'idle' | 'connecting' | 'open' | 'closed';
  /** fatal problem, e.g. the room does not exist */
  fatal: string | null;
  /** server clock minus local clock (ms) */
  offset: number;
}

export const store: AppState = { view: null, conn: 'idle', fatal: null, offset: 0 };
const subs = new Set<() => void>();

export function setState(p: Partial<AppState>): void {
  Object.assign(store, p);
  for (const f of subs) f();
}

export function useStore(): AppState {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const f = () => force(0);
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  }, []);
  return store;
}

export function serverNow(): number {
  return Date.now() + store.offset;
}

// ── toasts ──
export interface Toast {
  id: number;
  text: string;
  kind: 'error' | 'info';
}
let toastId = 1;
export const toasts: Toast[] = [];
const toastSubs = new Set<() => void>();
export function toast(text: string, kind: Toast['kind'] = 'error'): void {
  const t = { id: toastId++, text, kind };
  toasts.push(t);
  for (const f of toastSubs) f();
  setTimeout(() => {
    const i = toasts.indexOf(t);
    if (i >= 0) toasts.splice(i, 1);
    for (const f of toastSubs) f();
  }, 3200);
}
export function useToasts(): Toast[] {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const f = () => force(0);
    toastSubs.add(f);
    return () => {
      toastSubs.delete(f);
    };
  }, []);
  return toasts;
}
