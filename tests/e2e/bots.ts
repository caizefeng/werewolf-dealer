// Headless players for e2e tests: WebSocket clients that react to their prompts.
import { WebSocket } from 'ws';
import type { ClientMsg, GameAction, Prompt, RoomView, ServerMsg } from '../../shared/types.ts';

export type Strategy = {
  signup?: (seat: number) => boolean;
  vote?: (seat: number, candidates: number[], v: RoomView) => number | null;
  wolfTarget?: (options: number[], mates: number[]) => number | null;
};

export class Bot {
  ws!: WebSocket;
  view: RoomView | null = null;
  errors: string[] = [];
  id: string;
  auto = true;
  strategy: Strategy;
  private listeners = new Set<() => void>();
  private last = '';

  constructor(id: string, strategy: Strategy = {}) {
    this.id = id;
    this.strategy = strategy;
  }

  /** `server` is a local port or a base URL such as https://werewolf.example.com */
  connect(server: number | string, room: string, name: string, ownerKey?: string): Promise<void> {
    const base = typeof server === 'number' ? `http://127.0.0.1:${server}` : server;
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws`, { headers: { origin: base } });
      this.ws.on('open', () => this.send({ t: 'hello', room, client: this.id, name, ownerKey }));
      this.ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as ServerMsg;
        if (msg.t === 'state') {
          this.view = msg.view;
          resolve();
          if (this.auto) this.react();
        } else if (msg.t === 'error') this.errors.push(msg.message);
        for (const l of this.listeners) l();
      });
      this.ws.on('error', reject);
    });
  }

  send(m: ClientMsg): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  act(a: GameAction): void {
    this.send({ t: 'act', action: a });
  }

  waitFor(pred: (v: RoomView) => boolean, ms = 30000): Promise<RoomView> {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.view && pred(this.view)) {
          this.listeners.delete(check);
          clearTimeout(t);
          resolve(this.view);
        }
      };
      const t = setTimeout(() => {
        this.listeners.delete(check);
        reject(new Error(`bot ${this.id} timeout; phase=${JSON.stringify(this.view?.game?.phase)}`));
      }, ms);
      this.listeners.add(check);
      check();
    });
  }

  private react(): void {
    const v = this.view;
    const g = v?.game;
    const seat = v?.you.seat;
    if (!g || !g.you || !seat) return;
    const ph = g.phase;
    if (ph.kind === 'speech' && ph.order[ph.idx] === seat) {
      const key = `speech-${g.gameNo}-${g.day}-${ph.context}-${ph.idx}`;
      if (key !== this.last) {
        this.last = key;
        setTimeout(() => this.act({ type: 'endSpeech' }), 60);
      }
      return;
    }
    const p = g.you.prompt;
    if (!p) return;
    const a = this.decide(p, seat, v!);
    if (!a) return;
    const key = JSON.stringify([g.gameNo, g.day, g.night, ph.kind, (ph as { step?: string }).step ?? '', a]);
    if (key === this.last) return;
    this.last = key;
    setTimeout(() => this.act(a), 60);
  }

  private decide(p: Prompt, seat: number, v: RoomView): GameAction | null {
    switch (p.kind) {
      case 'pick':
        if (p.submitted) return null;
        if (p.allowNone && p.step !== 'seer' && p.step !== 'psychic') return { type: 'pick', step: p.step, targets: [] };
        return { type: 'pick', step: p.step, targets: p.options.length ? [p.options[p.options.length - 1]] : [] };
      case 'wolves': {
        if (p.locked || p.myConfirmed) return null;
        const mates = p.teammates.map((t) => t.seat).concat(seat);
        const follow = p.picks.find((x) => x.seat !== seat && x.target != null);
        const t = follow ? follow.target! : (this.strategy.wolfTarget?.(p.options, mates) ?? p.options.find((x) => !mates.includes(x)) ?? null);
        return { type: 'wolfPick', target: t, confirm: true };
      }
      case 'witch':
        return p.submitted ? null : { type: 'witch', save: null, poison: null };
      case 'treasure':
        return p.submitted ? null : { type: 'treasure', card: p.allowedCards[0], target: null, kill: null };
      case 'status':
        return p.acked ? null : { type: 'ack', step: p.step };
      case 'signup':
        return p.joined === null ? { type: 'signup', join: this.strategy.signup?.(seat) ?? false } : null;
      case 'vote': {
        if (p.myVote !== undefined) return null;
        const t = this.strategy.vote ? this.strategy.vote(seat, p.candidates, v) : (p.candidates[0] ?? null);
        return { type: 'vote', target: t };
      }
      case 'deathSkill':
        if (p.done) return null;
        if (p.mask) return { type: 'mask', use: true };
        if (p.badge && !p.badgeDone) return { type: 'badge', target: p.badgeOptions[0] ?? null };
        if (p.canShoot && p.shot === undefined) return { type: 'shoot', target: null };
        return { type: 'skillDone' };
      case 'orderChoice':
        return { type: 'order', dir: 'cw' };
      default:
        return null;
    }
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}
