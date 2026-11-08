// Test driver: runs a Game against a fake clock.
import { DEFAULT_RULES, type GameConfig, type RuleOptions } from '../../shared/config.ts';
import type { RoleId } from '../../shared/roles.ts';
import type { GameAction, NightStepId, OwnerCommand } from '../../shared/types.ts';
import { Game } from '../../server/game/engine.ts';

export function cfgFor(seats: RoleId[], rules: Partial<RuleOptions> = {}, extra: RoleId[] = []): GameConfig {
  const roles: Partial<Record<RoleId, number>> = {};
  for (const r of [...seats, ...extra]) roles[r] = (roles[r] ?? 0) + 1;
  return { boardName: 'test', roles, rules: { ...DEFAULT_RULES, ...rules } };
}

export class Driver {
  g: Game;
  now = 1_000_000;

  constructor(seats: RoleId[], rules: Partial<RuleOptions> = {}, buried: RoleId[] | null = null, seed = 7) {
    const cfg = cfgFor(seats.filter((r) => true), rules, buried ?? []);
    this.g = Game.fromSeats(cfg, seats, buried, seed);
  }

  get s() {
    return this.g.s;
  }

  get phase() {
    return this.g.s.phase;
  }

  /** jump to the next scheduled wake-up */
  step(): void {
    const w = this.g.nextWakeup();
    if (w == null) throw new Error(`no wakeup in phase ${this.phase.kind}`);
    this.now = Math.max(this.now, w);
    this.g.tick(this.now);
  }

  advance(ms: number): void {
    this.now += ms;
    this.g.tick(this.now);
  }

  until(pred: () => boolean, max = 400): void {
    for (let i = 0; i < max; i++) {
      if (pred()) return;
      this.step();
    }
    throw new Error(`condition not reached; phase=${JSON.stringify(this.phase).slice(0, 300)}`);
  }

  act(seat: number, a: GameAction): void {
    const err = this.g.act(seat, a, this.now);
    if (err) throw new Error(`act ${seat} ${a.type}: ${err}`);
  }

  tryAct(seat: number, a: GameAction): string | null {
    return this.g.act(seat, a, this.now);
  }

  owner(cmd: OwnerCommand): void {
    const err = this.g.ownerCmd(cmd, this.now);
    if (err) throw new Error(`owner ${cmd.type}: ${err}`);
  }

  start(): void {
    this.owner({ type: 'start' });
  }

  nightStep(): NightStepId | null {
    const ph = this.phase;
    if (ph.kind !== 'night' || ph.idx < 0 || ph.idx >= ph.steps.length) return null;
    return ph.steps[ph.idx];
  }

  /** advance until the given night step is open for input */
  toStep(step: NightStepId): void {
    this.until(() => {
      const ph = this.phase;
      return ph.kind === 'night' && this.nightStep() === step && (ph.sub === 'open' || ph.sub === 'act');
    });
  }

  pick(seat: number, step: NightStepId, targets: number[]): void {
    this.toStep(step);
    this.act(seat, { type: 'pick', step, targets });
  }

  /** all alive pack wolves pick and confirm the same target */
  wolves(target: number | null): void {
    this.toStep('wolves');
    for (const w of this.g.packSeats(true)) this.act(w, { type: 'wolfPick', target, confirm: true });
  }

  witch(seat: number, save: number | null, poison: number | null): void {
    this.toStep('witch');
    this.act(seat, { type: 'witch', save, poison });
  }

  /** run to the end of the night (day phases begin) */
  toDay(): void {
    this.until(() => this.phase.kind !== 'night');
  }

  /** until a phase of this kind */
  toPhase(kind: string, extra?: (ph: any) => boolean): void {
    this.until(() => this.phase.kind === kind && (!extra || extra(this.phase)));
  }

  /** everyone eligible votes for `target` (or abstains with null) */
  voteAll(target: number | null, except: Record<number, number | null> = {}): void {
    const ph = this.phase;
    if (ph.kind !== 'vote') throw new Error(`not voting: ${ph.kind}`);
    for (const v of ph.voters.slice()) {
      if (this.phase.kind !== 'vote') break;
      const t = v in except ? except[v] : target === v ? null : target;
      this.act(v, { type: 'vote', target: t });
    }
  }

  /** end every speech in the current speech phase (stops when the phase changes) */
  endSpeeches(): void {
    const start = this.phase;
    while (this.phase === start && start.kind === 'speech') {
      this.act(start.order[start.idx], { type: 'endSpeech' });
    }
  }

  /** skip death skills and last words until the day's discussion starts */
  toDiscussion(): void {
    for (let i = 0; i < 400; i++) {
      const ph = this.phase as { kind: string; context?: string };
      if (ph.kind === 'speech' && ph.context === 'discussion') return;
      if (ph.kind === 'deathSkills') this.skipSkills();
      else if (ph.kind === 'speech') this.endSpeeches();
      else this.step();
    }
    throw new Error('discussion not reached');
  }

  /** confirm every pending death-skill entry without using skills */
  skipSkills(): void {
    const ph = this.phase;
    if (ph.kind !== 'deathSkills') return;
    for (const e of ph.entries.slice()) {
      if (this.phase.kind !== 'deathSkills') return;
      if (e.done) continue;
      if (e.badge && !e.badgeDone) this.act(e.seat, { type: 'badge', target: null });
      if (this.phase.kind !== 'deathSkills') return;
      const cur = (this.phase as any).entries.find((x: any) => x.seat === e.seat);
      if (cur && !cur.done) this.act(e.seat, { type: 'skillDone' });
    }
  }

  alive(): number[] {
    return this.g.aliveSeats();
  }

  lastAnnouncement(): string {
    const a = this.s.announcements;
    return a.length ? a[a.length - 1].text : '';
  }

  announcements(): string[] {
    return this.s.announcements.map((a) => a.text);
  }
}
