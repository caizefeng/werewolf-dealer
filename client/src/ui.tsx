import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ROLES, type RoleId } from '../../shared/roles.ts';
import { serverNow } from './lib/store.ts';

// ── role icons (simple line art, 24×24) ──
const ICONS: Record<string, JSX.Element> = {
  eye: (
    <>
      <path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3.2" />
    </>
  ),
  spiral: (
    <>
      <circle cx="12" cy="11" r="7.5" />
      <path d="M12 11m-3 0a3 3 0 1 0 6 0a5.5 5.5 0 1 0-11 0" />
      <path d="M8 20.5h8" />
    </>
  ),
  flask: (
    <>
      <path d="M9.5 3h5M10.5 3v5.2L5.6 17.4A2.4 2.4 0 0 0 7.7 21h8.6a2.4 2.4 0 0 0 2.1-3.6L13.5 8.2V3" />
      <path d="M7.4 15h9.2" />
    </>
  ),
  crosshair: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 1.8v5M12 17.2v5M1.8 12h5M17.2 12h5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 2.8 4.5 5.6v6.1c0 4.6 3.1 8.1 7.5 9.5 4.4-1.4 7.5-4.9 7.5-9.5V5.6z" />
      <path d="M12 7v9M8 11h8" />
    </>
  ),
  blank: (
    <>
      <ellipse cx="12" cy="4.5" rx="5" ry="1.7" />
      <rect x="6.5" y="8" width="11" height="13" rx="1.6" />
    </>
  ),
  skull: (
    <>
      <path d="M12 3c-4.4 0-7.5 3.1-7.5 7.2 0 2.6 1.3 4.4 3 5.4V19h9v-3.4c1.7-1 3-2.8 3-5.4C19.5 6.1 16.4 3 12 3z" />
      <circle cx="9" cy="10.8" r="1.6" />
      <circle cx="15" cy="10.8" r="1.6" />
      <path d="M10.5 19v2M13.5 19v2" />
    </>
  ),
  moon: (
    <>
      <path d="M19.5 14.6A8 8 0 1 1 9.4 4.5a6.4 6.4 0 0 0 10.1 10.1z" />
      <path d="M15 3.5h3.5L15 7h3.5" />
    </>
  ),
  feather: (
    <>
      <path d="M20 4c-7 0-13 5-14.5 13.5L4 20" />
      <path d="M20 4c0 7-4.5 12.5-12 13.5" />
      <path d="M10 14l-2.5-2.5M13 11l-2.3-2.3M16 8l-2-2" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="7.5" r="3.6" />
      <path d="M4.5 21c.6-4.4 3.6-7 7.5-7s6.9 2.6 7.5 7" />
    </>
  ),
  half: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none" />
    </>
  ),
  wolf: (
    <>
      <path d="M4 3.5 8.2 8h7.6L20 3.5l-.6 7.3L21 14l-5 3-1.6 3.5h-4.8L8 17l-5-3 1.6-3.2z" />
      <path d="M9 12.2l1.3.8M15 12.2l-1.3.8M11 17.2h2" />
    </>
  ),
  crown: (
    <>
      <path d="M3.5 8.5 7.5 12 12 5l4.5 7 4-3.5-1.8 10H5.3z" fill="currentColor" fill-opacity="0.25" />
      <path d="M5.3 21h13.4" />
    </>
  ),
  'crown-white': (
    <>
      <path d="M3.5 8.5 7.5 12 12 5l4.5 7 4-3.5-1.8 10H5.3z" />
      <path d="M5.3 21h13.4" />
      <circle cx="12" cy="15" r="1.3" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
      <circle cx="12" cy="12" r="6.6" />
    </>
  ),
  mask: (
    <>
      <path d="M3 8.5c3-1.6 6-2.2 9-2.2s6 .6 9 2.2c-.2 5.2-2.4 9.2-5.6 9.2-1.6 0-2.4-1.6-3.4-1.6s-1.8 1.6-3.4 1.6C5.4 17.7 3.2 13.7 3 8.5z" />
      <path d="M6.6 11.2c.9-.7 2.1-.8 3 0M14.4 11.2c.9-.7 2.1-.8 3 0" />
    </>
  ),
  sword: (
    <>
      <path d="M14.5 3.5H20.5V9.5L9.5 20.5 3.5 14.5z" />
      <path d="M6 12l6 6M3.5 20.5l3-3" />
    </>
  ),
  music: (
    <>
      <path d="M9 18V5l11-2v13" />
      <circle cx="6.5" cy="18" r="2.6" />
      <circle cx="17.5" cy="16" r="2.6" />
    </>
  ),
  wand: (
    <>
      <path d="M4 20 15.5 8.5" />
      <path d="M17 3v3M17 9v3M13.5 7.5h3M18.5 7.5h3" />
      <path d="M8.5 4.5l1 1M20 13l1 1" />
    </>
  ),
  hourglass: (
    <>
      <path d="M6 3h12M6 21h12" />
      <path d="M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9" />
    </>
  ),
  rose: (
    <>
      <path d="M12 3c3 0 5.5 2 5.5 5 0 3.5-3 5.5-5.5 5.5S6.5 11.5 6.5 8C6.5 5 9 3 12 3z" />
      <path d="M12 6.5c1.4 0 2.4 1 2.4 2.2M12 13.5V21M12 17c-1.6-1.6-3.6-1.8-5-1.2M12 18.5c1.4-1.3 3.2-1.5 4.6-.9" />
    </>
  ),
  cards: (
    <>
      <rect x="3.5" y="5" width="10" height="14" rx="1.5" transform="rotate(-10 8.5 12)" />
      <rect x="10.5" y="5" width="10" height="14" rx="1.5" transform="rotate(10 15.5 12)" />
    </>
  ),
  'wolf-star': (
    <>
      <path d="M4 5.5 7.6 9h6.8L18 5.5l-.5 6.3L19 14.6l-4.4 2.6-1.4 3h-4.4l-1.4-3L3 14.6l1.5-2.8z" />
      <path d="M19 2.5l.7 1.6 1.8.2-1.3 1.2.4 1.7-1.6-.9-1.6.9.4-1.7-1.3-1.2 1.8-.2z" />
    </>
  ),
  theater: (
    <>
      <path d="M3.5 5c3-1.2 6-1.4 8.5-.6v8.4c0 3.4-2 5.7-4.4 5.7S3.5 15.4 3.5 12z" />
      <path d="M12.5 8.2c2.6-.8 5.4-.6 8 .6v6.4c0 3.2-2 5.3-4.2 5.3-1.7 0-3.1-1-3.8-2.7" />
      <path d="M5.8 9.2h1.6M8.6 9.2h1.4M6.2 13.6c.9.8 2.3.8 3.2 0M15 12.6h1.4M17.8 12.6h1.4M15.4 16.8c.9-.6 2.2-.6 3 0" />
    </>
  ),
  heart: (
    <>
      <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z" />
      <path d="M9.2 3.2 10.6 5M14.8 3.2 13.4 5" />
    </>
  ),
  bot: (
    <>
      <rect x="4.5" y="8" width="15" height="11.5" rx="3" />
      <path d="M12 4.6V8M2.5 12.5v3M21.5 12.5v3M9.5 16.3h5" />
      <circle cx="12" cy="3.6" r="1" />
      <circle cx="9.3" cy="12.5" r="1.1" />
      <circle cx="14.7" cy="12.5" r="1.1" />
    </>
  ),
  chest: (
    <>
      <path d="M3.5 10h17v9.5h-17zM3.5 10V8a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4v2" />
      <rect x="10.2" y="9" width="3.6" height="4.4" rx="0.8" />
    </>
  ),
};

export function RoleIcon({ role, size = 24, icon }: { role?: RoleId; size?: number; icon?: string }) {
  const key = icon ?? (role ? ROLES[role].icon : 'person');
  return (
    <svg
      class="role-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {ICONS[key] ?? ICONS.person}
    </svg>
  );
}

export function factionClass(role: RoleId): string {
  const d = ROLES[role];
  if (d.faction === 'wolf') return 'f-wolf';
  if (d.category === 'god') return 'f-god';
  if (d.category === 'treasure') return 'f-special';
  return 'f-villager';
}

// ── buttons ──
type BtnProps = JSX.HTMLAttributes<HTMLButtonElement> & {
  kind?: 'primary' | 'danger' | 'ghost' | 'gold' | 'plain';
  small?: boolean;
  block?: boolean;
  disabled?: boolean;
};
export function Btn({ kind = 'plain', small, block, class: cls, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      class={`btn btn-${kind}${small ? ' btn-sm' : ''}${block ? ' btn-block' : ''}${cls ? ` ${cls}` : ''}`}
      {...rest}
    />
  );
}

// ── modal / sheet ──
let openModals = 0;
export function Modal({
  title,
  onClose,
  children,
  variant = 'sheet',
  wide,
}: {
  title?: ComponentChildren;
  onClose: () => void;
  children: ComponentChildren;
  variant?: 'sheet' | 'center';
  wide?: boolean;
}) {
  useEffect(() => {
    openModals++;
    document.body.classList.add('modal-open');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      openModals--;
      if (openModals <= 0) document.body.classList.remove('modal-open');
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  return (
    <div class={`modal-backdrop ${variant}`} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class={`modal ${variant}${wide ? ' wide' : ''}`} role="dialog" aria-modal="true">
        <div class="modal-head">
          <div class="modal-title">{title}</div>
          <button type="button" class="modal-close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>
        <div class="modal-body">{children}</div>
      </div>
    </div>
  );
}

// ── timers ──
export function useTicker(ms = 250): number {
  const [n, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
  return n;
}

export function Countdown({ deadline, paused }: { deadline: number | null; paused?: boolean }) {
  useTicker(250);
  const total = useRef<{ d: number | null; len: number }>({ d: null, len: 1 });
  if (deadline == null) return null;
  const left = Math.max(0, deadline - serverNow());
  if (total.current.d !== deadline) total.current = { d: deadline, len: Math.max(left, 1) };
  const frac = Math.min(1, left / total.current.len);
  const secs = Math.ceil(left / 1000);
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <div class={`countdown${secs <= 5 ? ' urgent' : ''}${paused ? ' paused' : ''}`} aria-label={`剩余${secs}秒`}>
      <svg viewBox="0 0 36 36" width="40" height="40">
        <circle cx="18" cy="18" r={r} class="cd-track" />
        <circle
          cx="18"
          cy="18"
          r={r}
          class="cd-bar"
          stroke-dasharray={`${c}`}
          stroke-dashoffset={`${c * (1 - frac)}`}
          transform="rotate(-90 18 18)"
        />
      </svg>
      <span>{paused ? '‖' : secs}</span>
    </div>
  );
}

export function Elapsed({ since }: { since: number }) {
  useTicker(500);
  const s = Math.max(0, Math.floor((serverNow() - since) / 1000));
  return (
    <span class="elapsed">
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
    </span>
  );
}

export function seatList(seats: number[]): string {
  return seats.length ? seats.map((s) => `${s}号`).join('、') : '无';
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // WeChat / older iOS: fall back to a hidden textarea
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}
