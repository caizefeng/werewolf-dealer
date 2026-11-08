// Per-browser identity and preferences in localStorage (with an in-memory
// fallback for private modes where storage throws).
const mem = new Map<string, string>();

export function getItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return mem.get(key) ?? null;
  }
}

export function setItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    mem.set(key, value);
  }
}

function randomId(bytes = 18): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  let s = '';
  for (const b of a) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function clientId(): string {
  let id = getItem('wwd.client');
  if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
    id = randomId();
    setItem('wwd.client', id);
  }
  return id;
}

export function savedName(): string {
  return getItem('wwd.name') ?? '';
}

export function saveName(n: string): void {
  setItem('wwd.name', n);
}

/** owner key from the URL hash (#k=...) or storage */
export function ownerKey(roomId: string): string | null {
  const m = /[#&]k=([a-z0-9]+)/.exec(location.hash);
  if (m) {
    setItem(`wwd.owner.${roomId}`, m[1]);
    history.replaceState(null, '', location.pathname + location.search);
    return m[1];
  }
  return getItem(`wwd.owner.${roomId}`);
}

export function rememberOwnerKey(roomId: string, key: string): void {
  setItem(`wwd.owner.${roomId}`, key);
}
