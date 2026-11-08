// The game engine: a deterministic state machine. It never reads the clock or
// Math.random itself — callers pass `now` (ms) and all randomness comes from the
// seeded RNG stored in the state — so tests can drive whole games precisely.
import { allClips, numClip, estimateDuration } from '../../shared/audio.ts';
import type { GameConfig } from '../../shared/config.ts';
import { MECH_SKILL_TEXT, mechSkillFor, ROLES, type MechSkill, type RoleId } from '../../shared/roles.ts';
import type {
  Announcement,
  GameAction,
  HistoryEvent,
  NightStepId,
  OwnerCommand,
  PhaseView,
  Prompt,
  SkillView,
  SpeechContext,
  TreasureSkill,
  VoteContext,
  VoteRow,
  Winner,
} from '../../shared/types.ts';
import { deal, treasureFaction } from './deal.ts';
import { CAUSE_TEXT, disablesSkill, resolveNight, type NightInputs } from './resolve.ts';
import { pick, rand, randInt, shuffle } from './rng.ts';
import type { DayStage, DeathCause, DeathEntry, GameState, NightPhase, NightRecord, Player } from './state.ts';

export type ClipDurations = (id: string) => number;

const CLIP_TEXT: Record<string, string> = allClips();

// ── timing (seconds) ──
export const T = {
  introPad: 2.5,
  openPad: 0.5,
  minAct: 4,
  submitHold: 1.5,
  resultHold: 3.5,
  fakeAct: [6, 13] as const,
  statusAct: [4.5, 6.5] as const,
  stepGap: [1.0, 2.2] as const,
  interlude: 3.5,
  deathSkills: 30,
  deathSkillsExtend: 20,
  orderChoice: 20,
  withdraw: 30,
  treasureExtra: 15,
};

const STEP_NAMES: Record<NightStepId, string> = {
  mixed: '混血儿',
  mechLearn: '机械狼',
  treasure: '盗宝大师',
  dreamer: '摄梦人',
  guard: '守卫',
  wolves: '狼人',
  mechKill: '机械狼',
  witch: '女巫',
  poisoner: '毒师',
  seer: '预言家',
  psychic: '通灵师',
  crow: '乌鸦',
  mechSkill: '机械狼',
  hunterStatus: '猎人',
  wolfkingStatus: '狼王',
  wwkStatus: '白狼王',
  maskedConfirm: '蒙面人',
  whitegodConfirm: '白神',
};

const STEP_ROLE: Record<NightStepId, RoleId | 'pack'> = {
  mixed: 'mixed',
  mechLearn: 'mechwolf',
  treasure: 'treasure',
  dreamer: 'dreamer',
  guard: 'guard',
  wolves: 'pack',
  mechKill: 'mechwolf',
  witch: 'witch',
  poisoner: 'poisoner',
  seer: 'seer',
  psychic: 'psychic',
  crow: 'crow',
  mechSkill: 'mechwolf',
  hunterStatus: 'hunter',
  wolfkingStatus: 'wolfking',
  wwkStatus: 'whitewolfking',
  maskedConfirm: 'masked',
  whitegodConfirm: 'whitegod',
};

const STATUS_STEPS: NightStepId[] = ['hunterStatus', 'wolfkingStatus', 'wwkStatus', 'maskedConfirm', 'whitegodConfirm'];

function stepClips(step: NightStepId, night: number): { open: string[]; close: string[] } {
  switch (step) {
    case 'mixed':
      return { open: ['mixed_open', 'mixed_act'], close: ['mixed_close'] };
    case 'mechLearn':
      return { open: ['mech_open', 'mechlearn_act'], close: ['mech_close'] };
    case 'treasure':
      return { open: ['treasure_open', night === 1 ? 'treasure_act1' : 'treasure_act'], close: ['treasure_close'] };
    case 'dreamer':
      return { open: ['dreamer_open', 'dreamer_act'], close: ['dreamer_close'] };
    case 'guard':
      return { open: ['guard_open', 'guard_act'], close: ['guard_close'] };
    case 'wolves':
      return { open: ['wolves_open', night === 1 ? 'wolves_act1' : 'wolves_act'], close: ['wolves_close'] };
    case 'mechKill':
      return { open: ['mech_open', 'mechkill_act'], close: ['mech_close'] };
    case 'witch':
      return { open: ['witch_open', 'witch_act'], close: ['witch_close'] };
    case 'poisoner':
      return { open: ['poisoner_open', 'poisoner_act'], close: ['poisoner_close'] };
    case 'seer':
      return { open: ['seer_open', 'check_act'], close: ['seer_close'] };
    case 'psychic':
      return { open: ['psychic_open', 'check_act'], close: ['psychic_close'] };
    case 'crow':
      return { open: ['crow_open', 'crow_act'], close: ['crow_close'] };
    case 'mechSkill':
      return { open: ['mech_open', 'mechskill_act'], close: ['mech_close'] };
    case 'hunterStatus':
      return { open: ['hunter_open', 'status_gun'], close: ['hunter_close'] };
    case 'wolfkingStatus':
      return { open: ['wolfking_open', 'status_gun'], close: ['wolfking_close'] };
    case 'wwkStatus':
      return { open: ['wwk_open', 'status_skill'], close: ['wwk_close'] };
    case 'maskedConfirm':
      return { open: ['masked_open', 'confirm_identity'], close: ['masked_close'] };
    case 'whitegodConfirm':
      return { open: ['whitegod_open', 'confirm_identity'], close: ['whitegod_close'] };
  }
}

export function stepsForNight(cfg: GameConfig, night: number): NightStepId[] {
  const has = (r: RoleId) => (cfg.roles[r] ?? 0) > 0;
  const hasPack = (Object.keys(cfg.roles) as RoleId[]).some((r) => ROLES[r].pack && (cfg.roles[r] ?? 0) > 0);
  const steps: NightStepId[] = [];
  if (night === 1 && has('mixed')) steps.push('mixed');
  if (night === 1 && has('mechwolf')) steps.push('mechLearn');
  if (has('treasure')) steps.push('treasure');
  if (has('dreamer')) steps.push('dreamer');
  if (has('guard')) steps.push('guard');
  if (hasPack) steps.push('wolves');
  if (night >= 2 && has('mechwolf')) steps.push('mechKill');
  if (has('witch')) steps.push('witch');
  if (has('poisoner')) steps.push('poisoner');
  if (has('seer')) steps.push('seer');
  if (has('psychic')) steps.push('psychic');
  if (has('crow')) steps.push('crow');
  if (night >= 2 && has('mechwolf')) steps.push('mechSkill');
  if (has('hunter')) steps.push('hunterStatus');
  if (has('wolfking')) steps.push('wolfkingStatus');
  if (has('whitewolfking')) steps.push('wwkStatus');
  if (night === 1 && has('masked')) steps.push('maskedConfirm');
  if (night === 1 && has('whitegod')) steps.push('whitegodConfirm');
  return steps;
}

export function nightStepNames(cfg: GameConfig): string[] {
  const n1 = stepsForNight(cfg, 1);
  const n2 = stepsForNight(cfg, 2);
  const out: string[] = [];
  const all: NightStepId[] = [];
  for (const s of [...n1, ...n2]) if (!all.includes(s)) all.push(s);
  for (const s of all) {
    const label =
      s === 'mechLearn'
        ? '机械狼学习（首夜）'
        : s === 'mechKill'
          ? '机械狼刀人'
          : s === 'mechSkill'
            ? '机械狼技能'
            : s === 'mixed'
              ? '混血儿（首夜）'
              : s === 'whitegodConfirm'
                ? '白神确认身份（首夜）'
                : s === 'maskedConfirm'
                  ? '蒙面人确认身份（首夜）'
                : s.endsWith('Status')
                  ? `${STEP_NAMES[s]}确认状态`
                  : STEP_NAMES[s];
    out.push(label);
  }
  return out;
}

/** seats ordered starting at `from` (inclusive) going around the table */
export function circular(seats: number[], from: number, dir: 'cw' | 'ccw', n: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const s = dir === 'cw' ? ((from - 1 + k) % n) + 1 : ((((from - 1 - k) % n) + n) % n) + 1;
    if (seats.includes(s)) out.push(s);
  }
  return out;
}

function nums(seats: number[]): string {
  return seats.map((s) => `${s}号`).join('、');
}

function newPlayer(seat: number, role: RoleId): Player {
  return {
    seat,
    role,
    alive: true,
    death: null,
    viewed: false,
    revealed: false,
    witch: role === 'witch' ? { antidote: true, poison: true } : null,
    poisonerPoison: role === 'poisoner',
    guardLast: null,
    dreamLast: null,
    crowLast: null,
    checks: [],
    mech: role === 'mechwolf' ? { learned: null, from: null, poison: false, guardLast: null, double: 'unused' } : null,
    treasure: null,
    mixedModel: null,
  };
}

function newNightRecord(night: number): NightRecord {
  return { night, wolfPicks: {}, acks: [], results: {}, deaths: null, log: [] };
}

function treasureSkillOf(card: RoleId): TreasureSkill {
  switch (card) {
    case 'seer':
      return 'seer';
    case 'psychic':
      return 'psychic';
    case 'witch':
    case 'poisoner':
      return 'poison';
    case 'guard':
      return 'guard';
    case 'dreamer':
      return 'dream';
    case 'crow':
      return 'curse';
    default:
      return 'none';
  }
}

const TREASURE_SKILL_LABEL: Record<TreasureSkill, string> = {
  seer: '查验一名玩家是好人还是狼人',
  psychic: '查验一名玩家的具体身份',
  poison: '使用毒药（可以不用）',
  guard: '守护一名玩家（可以不守）',
  dream: '选择一名梦游者（必选）',
  curse: '诅咒一名玩家（必选）',
  none: '这张牌没有夜间技能',
};

export class Game {
  s: GameState;
  dur: ClipDurations;
  /** time scale for all durations (not persisted) */
  scale = 1;

  constructor(state: GameState, dur?: ClipDurations) {
    this.s = state;
    this.dur = dur ?? estimateDuration;
  }

  static create(config: GameConfig, seed: number, gameNo: number, dur?: ClipDurations): Game {
    const s: GameState = {
      version: 1,
      gameNo,
      config: structuredClone(config),
      rng: seed >>> 0,
      players: [],
      buried: null,
      night: 0,
      day: 0,
      phase: { kind: 'dealt' },
      dayQueue: [],
      sheriff: null,
      badgeLost: !config.rules.sheriff,
      election: null,
      exilePk: null,
      pending: [],
      wounded: [],
      pendingNight: 0,
      nights: [],
      curses: [],
      history: [],
      announcements: [],
      nextAnnId: 1,
      winner: null,
      winReason: '',
      paused: null,
      discussionNote: null,
    };
    const dealt = deal(config.roles, s);
    s.players = dealt.seats.map((role, i) => newPlayer(i + 1, role));
    if (dealt.buried) {
      s.buried = dealt.buried;
      const tf = treasureFaction(dealt.buried);
      const tp = s.players.find((p) => p.role === 'treasure');
      if (tp) {
        tp.treasure = {
          cards: dealt.buried.slice(),
          faction: tf.faction,
          countsAs: tf.countsAs,
          current: null,
          last: null,
          poisons: dealt.buried.map((r) => r === 'poisoner' || r === 'witch'),
          lastDream: null,
          maskUsed: false,
          extraKnife: false,
        };
      }
    }
    return new Game(s, dur);
  }

  /** Test/debug hook: a game with an explicit seat → role assignment. */
  static fromSeats(config: GameConfig, seats: RoleId[], buried: RoleId[] | null, seed = 1, dur?: ClipDurations): Game {
    const g = Game.create(config, seed, 1, dur);
    g.s.players = seats.map((role, i) => newPlayer(i + 1, role));
    g.s.buried = buried ? buried.slice() : null;
    if (buried) {
      const tf = treasureFaction(buried);
      const tp = g.s.players.find((p) => p.role === 'treasure');
      if (tp)
        tp.treasure = {
          cards: buried.slice(),
          faction: tf.faction,
          countsAs: tf.countsAs,
          current: null,
          last: null,
          poisons: buried.map((r) => r === 'poisoner' || r === 'witch'),
          lastDream: null,
          maskUsed: false,
          extraKnife: false,
        };
    }
    return g;
  }

  // ───────────────────────── basic queries ─────────────────────────

  get n(): number {
    return this.s.players.length;
  }

  p(seat: number): Player {
    const pl = this.s.players[seat - 1];
    if (!pl) throw new Error(`no seat ${seat}`);
    return pl;
  }

  validSeat(seat: unknown): seat is number {
    return typeof seat === 'number' && Number.isInteger(seat) && seat >= 1 && seat <= this.n;
  }

  /** publicly alive seats (unannounced night deaths still count as alive) */
  aliveSeats(): number[] {
    return this.s.players.filter((p) => p.alive).map((p) => p.seat);
  }

  seatOf(role: RoleId): number | null {
    const pl = this.s.players.find((p) => p.role === role);
    return pl ? pl.seat : null;
  }

  aliveSeatOf(role: RoleId): number | null {
    const pl = this.s.players.find((p) => p.role === role && p.alive);
    return pl ? pl.seat : null;
  }

  factionOf(pl: Player): 'good' | 'wolf' {
    if (pl.role === 'treasure' && pl.treasure) return pl.treasure.faction;
    return ROLES[pl.role].faction === 'wolf' ? 'wolf' : 'good';
  }

  countsAs(pl: Player): 'god' | 'villager' | 'wolf' {
    if (pl.role === 'treasure' && pl.treasure) return pl.treasure.countsAs;
    const c = ROLES[pl.role].category;
    return c === 'god' ? 'god' : c === 'villager' ? 'villager' : 'wolf';
  }

  packSeats(aliveOnly: boolean): number[] {
    return this.s.players.filter((p) => ROLES[p.role].pack && (!aliveOnly || p.alive)).map((p) => p.seat);
  }

  /** who holds the knife tonight: the pack, then 机械狼, then 盗宝狼 */
  knifeHolder(): 'pack' | number | null {
    if (this.packSeats(true).length > 0) return 'pack';
    const mech = this.aliveSeatOf('mechwolf');
    if (mech) return mech;
    const t = this.s.players.find((p) => p.role === 'treasure' && p.alive && p.treasure?.faction === 'wolf');
    if (t) return t.seat;
    return null;
  }

  mechSkill(): MechSkill {
    const m = this.s.players.find((p) => p.role === 'mechwolf');
    return m?.mech?.learned ? mechSkillFor(m.mech.learned) : 'none';
  }

  currentNight(): NightRecord {
    let rec = this.s.nights[this.s.nights.length - 1];
    if (!rec || rec.night !== this.s.night) {
      rec = newNightRecord(this.s.night);
      this.s.nights.push(rec);
    }
    return rec;
  }

  gunHolder(pl: Player): boolean {
    if (pl.role === 'hunter' || pl.role === 'wolfking') return true;
    if (pl.role === 'mechwolf' && pl.mech?.learned && mechSkillFor(pl.mech.learned) === 'gun') return true;
    if (pl.role === 'treasure' && pl.treasure && pl.treasure.current != null)
      return pl.treasure.cards[pl.treasure.current] === 'hunter';
    return false;
  }

  canShootFor(pl: Player, causes: DeathCause[]): boolean {
    if (!this.gunHolder(pl)) return false;
    return causes.length > 0 && causes.every((c) => c === 'knife' || c === 'exile');
  }

  seerResult(seat: number): string {
    const pl = this.p(seat);
    if (pl.role === 'treasure' && pl.treasure) {
      const card = pl.treasure.current != null ? pl.treasure.cards[pl.treasure.current] : null;
      if (card) return ROLES[card].faction === 'wolf' ? '狼人' : '好人';
      return pl.treasure.faction === 'wolf' ? '狼人' : '好人';
    }
    return this.factionOf(pl) === 'wolf' ? '狼人' : '好人';
  }

  psychicResult(seat: number): string {
    const pl = this.p(seat);
    if (pl.role === 'mechwolf') return pl.mech?.learned ? ROLES[pl.mech.learned].name : '机械狼';
    if (pl.role === 'treasure' && pl.treasure) {
      return pl.treasure.current != null ? ROLES[pl.treasure.cards[pl.treasure.current]].name : '盗宝大师';
    }
    return ROLES[pl.role].name;
  }

  // ───────────────────────── announcements & history ─────────────────────────

  announce(now: number, text: string, clips: string[]): void {
    const a: Announcement = { id: this.s.nextAnnId++, at: now, text, clips };
    this.s.announcements.push(a);
    if (this.s.announcements.length > 40) this.s.announcements.splice(0, this.s.announcements.length - 40);
  }

  clipsDuration(clips: string[]): number {
    return clips.reduce((t, c) => t + this.dur(c) + 0.08, 0) * this.k;
  }

  /** ms per second of game time (1000 normally; tests and e2e run faster) */
  get k(): number {
    return 1000 * this.scale;
  }

  log(kind: HistoryEvent['kind'], text: string, votes?: HistoryEvent['votes']): void {
    const day = Math.max(this.s.night, this.s.day, 1);
    let bucket = this.s.history.find((h) => h.day === day);
    if (!bucket) {
      bucket = { day, events: [] };
      this.s.history.push(bucket);
    }
    bucket.events.push(votes ? { kind, text, votes } : { kind, text });
  }

  // ───────────────────────── scheduling ─────────────────────────

  nextWakeup(): number | null {
    const s = this.s;
    if (s.paused) return null;
    const ph = s.phase;
    switch (ph.kind) {
      case 'night': {
        if (ph.sub !== 'act' || ph.fake) return ph.until;
        if (ph.doneAt != null) return Math.min(ph.actMax, Math.max(ph.actMin, ph.doneAt + this.holdFor(ph)));
        return ph.actMax;
      }
      case 'interlude':
        return ph.until;
      case 'signup':
      case 'vote':
      case 'withdraw':
      case 'orderChoice':
      case 'deathSkills':
        return ph.deadline;
      default:
        return null;
    }
  }

  private holdFor(ph: NightPhase): number {
    const step = ph.steps[ph.idx];
    const rec = this.currentNight();
    return (rec.results[step]?.length ?? 0) > 0 ? T.resultHold * this.k : T.submitHold * this.k;
  }

  tick(now: number): void {
    for (let guard = 0; guard < 200; guard++) {
      const w = this.nextWakeup();
      if (w == null || w > now) return;
      this.advance(w);
    }
  }

  private advance(now: number): void {
    const ph = this.s.phase;
    switch (ph.kind) {
      case 'night':
        return this.advanceNight(now);
      case 'interlude':
        return this.nextStage(now);
      case 'signup':
        return this.finishSignup(now);
      case 'vote':
        return this.finishVote(now);
      case 'withdraw':
        return this.startElectionVote(now, false);
      case 'orderChoice':
        return this.chooseOrder(rand(this.s) < 0.5 ? 'cw' : 'ccw', now);
      case 'deathSkills':
        return this.finishDeathSkills(now);
      default:
        return;
    }
  }

  private interlude(now: number, ms?: number): void {
    this.s.phase = { kind: 'interlude', until: now + (ms ?? T.interlude * this.k) };
  }

  private shiftTimes(delta: number): void {
    const ph = this.s.phase;
    switch (ph.kind) {
      case 'night':
        ph.until += delta;
        ph.actMin += delta;
        ph.actMax += delta;
        if (ph.doneAt != null) ph.doneAt += delta;
        break;
      case 'interlude':
        ph.until += delta;
        break;
      case 'signup':
      case 'vote':
      case 'withdraw':
      case 'orderChoice':
      case 'deathSkills':
        ph.deadline += delta;
        break;
      case 'speech':
        ph.startedAt += delta;
        break;
    }
  }

  /** used when a persisted room is restored after downtime */
  resumeAfterDowntime(delta: number): void {
    if (delta > 0 && !this.s.paused) this.shiftTimes(delta);
  }

  // ───────────────────────── entry points ─────────────────────────

  ownerCmd(cmd: OwnerCommand, now: number): string | null {
    const s = this.s;
    switch (cmd.type) {
      case 'start':
        if (s.phase.kind !== 'dealt') return '游戏已经开始';
        this.startNight(now);
        return null;
      case 'pause':
        if (s.paused) return null;
        if (s.phase.kind === 'ended' || s.phase.kind === 'dealt') return '当前无法暂停';
        s.paused = { at: now };
        return null;
      case 'resume':
        if (!s.paused) return null;
        this.shiftTimes(now - s.paused.at);
        s.paused = null;
        return null;
      case 'next':
        return this.ownerNext(now);
      case 'order':
        if (s.phase.kind !== 'orderChoice') return '现在不是选择发言顺序的时候';
        this.chooseOrder(cmd.dir, now);
        return null;
      default:
        return '未知指令';
    }
  }

  private ownerNext(now: number): string | null {
    const ph = this.s.phase;
    if (this.s.paused) return '游戏已暂停';
    switch (ph.kind) {
      case 'speech':
        this.advanceSpeech(now);
        return null;
      case 'vote':
        this.finishVote(now);
        return null;
      case 'signup':
        this.finishSignup(now);
        return null;
      case 'withdraw':
        this.startElectionVote(now, false);
        return null;
      case 'orderChoice':
        this.chooseOrder(rand(this.s) < 0.5 ? 'cw' : 'ccw', now);
        return null;
      case 'deathSkills':
        this.finishDeathSkills(now);
        return null;
      case 'interlude':
        this.nextStage(now);
        return null;
      default:
        return '当前环节不能跳过';
    }
  }

  act(seat: number, a: GameAction, now: number): string | null {
    if (!this.validSeat(seat)) return '你还没有座位';
    const s = this.s;
    if (a.type === 'viewRole') {
      this.p(seat).viewed = true;
      return null;
    }
    if (s.phase.kind === 'ended') return '游戏已经结束';
    if (s.paused) return '游戏已暂停';
    const ph = s.phase;
    switch (a.type) {
      case 'pick':
      case 'wolfPick':
      case 'witch':
      case 'treasure':
      case 'ack':
        if (ph.kind !== 'night') return '现在不是夜间行动时间';
        return this.nightAction(seat, a, now);
      case 'signup': {
        if (ph.kind !== 'signup') return '现在不能上警';
        if (!this.p(seat).alive) return '你已出局';
        ph.responses[String(seat)] = !!a.join;
        if (this.aliveSeats().every((x) => String(x) in ph.responses)) this.finishSignup(now);
        return null;
      }
      case 'withdraw':
        return this.withdraw(seat, now);
      case 'vote':
        return this.vote(seat, a.target, now);
      case 'endSpeech': {
        if (ph.kind !== 'speech') return '现在不是发言阶段';
        if (ph.order[ph.idx] !== seat) return '还没轮到你发言';
        this.advanceSpeech(now);
        return null;
      }
      case 'selfDestruct':
        return this.selfDestruct(seat, a.target, now);
      case 'shoot':
        return this.shoot(seat, a.target, now);
      case 'badge':
        return this.passBadge(seat, a.target, now);
      case 'mask': {
        if (ph.kind !== 'deathSkills') return '现在不能发动蒙面技能';
        const e = ph.entries.find((x) => x.seat === seat);
        if (!e || !e.mask) return '你没有可以发动的蒙面技能';
        this.useMask(e, !!a.use, now);
        if (s.phase.kind === 'deathSkills') this.maybeFinishDeathSkills(now);
        return null;
      }
      case 'skillDone': {
        if (ph.kind !== 'deathSkills') return '现在不能操作';
        const e = ph.entries.find((x) => x.seat === seat);
        if (!e) return '你没有需要确认的技能';
        if (e.mask) return '请选择是否发动蒙面技能';
        if (e.badge && !e.badgeDone) return '请先移交或撕毁警徽';
        if (e.canShoot && e.shot === undefined) e.shot = null;
        e.done = true;
        this.maybeFinishDeathSkills(now);
        return null;
      }
      case 'order': {
        if (ph.kind !== 'orderChoice') return '现在不是选择发言顺序的时候';
        if (this.s.sheriff !== seat) return '只有警长可以选择发言顺序';
        this.chooseOrder(a.dir === 'ccw' ? 'ccw' : 'cw', now);
        return null;
      }
      default:
        return '未知操作';
    }
  }

  // ───────────────────────── night ─────────────────────────

  startNight(now: number): void {
    const s = this.s;
    s.night += 1;
    s.curses = [];
    s.exilePk = null;
    s.discussionNote = null;
    this.currentNight();
    const steps = stepsForNight(s.config, s.night);
    this.announce(now, '天黑请闭眼。', ['night_start']);
    s.phase = {
      kind: 'night',
      steps,
      idx: -1,
      sub: 'intro',
      until: now + this.clipsDuration(['night_start']) + T.introPad * this.k,
      actMin: 0,
      actMax: 0,
      fake: false,
      doneAt: null,
    };
    this.log('info', `第${s.night}夜`);
  }

  /** actors for a step (alive) */
  stepActors(step: NightStepId): number[] {
    const r = STEP_ROLE[step];
    if (r === 'pack') return this.packSeats(true);
    const seat = this.aliveSeatOf(r);
    return seat ? [seat] : [];
  }

  /** whether the actor has a real choice in this step (else timing is randomised) */
  stepInteractive(step: NightStepId): boolean {
    if (STATUS_STEPS.includes(step)) return false;
    const actors = this.stepActors(step);
    if (actors.length === 0) return false;
    const pl = this.p(actors[0]);
    switch (step) {
      case 'mechKill':
        return this.knifeHolder() === pl.seat;
      case 'witch':
        return !!pl.witch && (pl.witch.antidote || pl.witch.poison);
      case 'poisoner':
        return pl.poisonerPoison;
      case 'mechSkill': {
        const sk = this.mechSkill();
        return sk === 'seer' || sk === 'psychic' || sk === 'guard' || (sk === 'poison' && !!pl.mech?.poison);
      }
      default:
        return true;
    }
  }

  private enterStep(idx: number, now: number): void {
    const ph = this.s.phase as NightPhase;
    ph.idx = idx;
    if (idx >= ph.steps.length) {
      this.settleNight(now);
      return;
    }
    const step = ph.steps[idx];
    const clips = stepClips(step, this.s.night);
    const texts = clips.open.map((c) => this.clipText(c));
    this.announce(now, texts.join(''), clips.open);
    ph.sub = 'open';
    ph.until = now + this.clipsDuration(clips.open) + T.openPad * this.k;
    ph.fake = false;
    ph.doneAt = null;
    ph.actMin = 0;
    ph.actMax = 0;
  }

  clipText(id: string): string {
    return CLIP_TEXT[id] ?? '';
  }

  private advanceNight(now: number): void {
    const ph = this.s.phase as NightPhase;
    switch (ph.sub) {
      case 'intro':
        this.enterStep(0, now);
        return;
      case 'open': {
        const step = ph.steps[ph.idx];
        ph.sub = 'act';
        if (STATUS_STEPS.includes(step)) {
          ph.fake = true;
          ph.until = now + randInt(this.s, T.statusAct[0] * this.k, T.statusAct[1] * this.k);
        } else if (!this.stepInteractive(step)) {
          ph.fake = true;
          ph.until = now + randInt(this.s, T.fakeAct[0] * this.k, T.fakeAct[1] * this.k);
        } else {
          ph.fake = false;
          ph.actMin = now + T.minAct * this.k;
          const secs =
            step === 'wolves'
              ? this.s.config.rules.wolfSeconds
              : step === 'treasure'
                ? this.s.config.rules.actionSeconds + T.treasureExtra
                : this.s.config.rules.actionSeconds;
          ph.actMax = now + secs * this.k;
          ph.until = ph.actMax;
        }
        return;
      }
      case 'act': {
        const step = ph.steps[ph.idx];
        if (!ph.fake && ph.doneAt == null) this.applyDefault(step, now);
        const clips = stepClips(step, this.s.night);
        this.announce(now, clips.close.map((c) => this.clipText(c)).join(''), clips.close);
        ph.sub = 'close';
        ph.until = now + this.clipsDuration(clips.close) + randInt(this.s, T.stepGap[0] * this.k, T.stepGap[1] * this.k);
        return;
      }
      case 'close':
        this.enterStep(ph.idx + 1, now);
        return;
      case 'outro':
        return;
    }
  }

  private markDone(now: number): void {
    const ph = this.s.phase as NightPhase;
    if (ph.doneAt == null) ph.doneAt = now;
  }

  /** what the current night step lets `seat` choose from */
  private pickOptions(step: NightStepId, seat: number): { options: number[]; max: number; allowNone: boolean } {
    const alive = this.aliveSeats();
    const others = alive.filter((x) => x !== seat);
    const pl = this.p(seat);
    switch (step) {
      case 'mixed':
        return { options: others, max: 1, allowNone: false };
      case 'mechLearn':
        return { options: others, max: 1, allowNone: true };
      case 'dreamer':
        return { options: others, max: 1, allowNone: false };
      case 'guard':
        return { options: alive.filter((x) => x !== pl.guardLast), max: 1, allowNone: true };
      case 'mechKill': {
        const double = this.mechSkill() === 'double' && pl.mech?.double === 'unused';
        return { options: alive, max: double ? 2 : 1, allowNone: true };
      }
      case 'poisoner':
        return { options: others, max: 1, allowNone: true };
      case 'seer':
      case 'psychic':
        return { options: others, max: 1, allowNone: true };
      case 'crow':
        return { options: others.filter((x) => x !== pl.crowLast), max: 1, allowNone: false };
      case 'mechSkill': {
        const sk = this.mechSkill();
        if (sk === 'guard') return { options: alive.filter((x) => x !== pl.mech?.guardLast), max: 1, allowNone: true };
        return { options: others, max: 1, allowNone: true };
      }
      default:
        return { options: [], max: 0, allowNone: true };
    }
  }

  private nightAction(seat: number, a: GameAction, now: number): string | null {
    const ph = this.s.phase as NightPhase;
    if (ph.sub !== 'open' && ph.sub !== 'act') return '现在不能行动';
    const step = ph.steps[ph.idx];
    if (!this.stepActors(step).includes(seat)) return '现在不是你的行动时间';
    const rec = this.currentNight();
    const pl = this.p(seat);
    if (a.type === 'ack') {
      if (a.step !== step) return '步骤已经变化';
      if (!rec.acks.includes(step)) rec.acks.push(step);
      return null;
    }
    if (STATUS_STEPS.includes(step) || !this.stepInteractive(step)) return '你现在没有可以执行的操作';
    if (ph.doneAt != null && step !== 'wolves') return '你已经完成了操作';

    if (a.type === 'pick') {
      if (a.step !== step) return '步骤已经变化';
      const opt = this.pickOptions(step, seat);
      const targets = Array.isArray(a.targets) ? a.targets.filter((t) => this.validSeat(t)) : [];
      if (targets.length !== (Array.isArray(a.targets) ? a.targets.length : 0)) return '目标无效';
      if (new Set(targets).size !== targets.length) return '不能重复选择';
      if (targets.length === 0 && !opt.allowNone) return '必须选择一名玩家';
      if (targets.length > opt.max) return '选择的玩家过多';
      if (targets.some((t) => !opt.options.includes(t))) return '不能选择这名玩家';
      const t = targets[0] ?? null;
      switch (step) {
        case 'mixed':
          rec.mixed = t;
          pl.mixedModel = t;
          rec.results.mixed = [`你选择了${t}号作为榜样。`];
          break;
        case 'mechLearn':
          rec.mechLearn = t;
          if (t != null && pl.mech) {
            const learned = this.p(t).role;
            pl.mech.learned = learned;
            pl.mech.from = t;
            const sk = mechSkillFor(learned);
            pl.mech.poison = sk === 'poison';
            rec.results.mechLearn = [
              `${t}号玩家的身份是：${ROLES[learned].name}`,
              `你获得的机械技能：${MECH_SKILL_TEXT[sk]}（第二晚起生效）`,
            ];
          } else {
            rec.results.mechLearn = ['你选择了不学习。'];
          }
          break;
        case 'dreamer':
          rec.dream = t;
          break;
        case 'guard':
          rec.guard = t;
          break;
        case 'mechKill':
          rec.mechKill = targets;
          break;
        case 'poisoner':
          rec.poison = t;
          if (t != null) pl.poisonerPoison = false;
          break;
        case 'seer':
        case 'psychic': {
          rec[step] = t;
          if (t != null) {
            const result = step === 'seer' ? this.seerResult(t) : this.psychicResult(t);
            pl.checks.push({ night: this.s.night, seat: t, result });
            rec.results[step] = [`${t}号玩家的身份是：${result}`];
          }
          break;
        }
        case 'crow':
          rec.curse = t;
          break;
        case 'mechSkill': {
          rec.mechSkill = t;
          const sk = this.mechSkill();
          if (t != null && (sk === 'seer' || sk === 'psychic')) {
            const result = sk === 'seer' ? this.seerResult(t) : this.psychicResult(t);
            pl.checks.push({ night: this.s.night, seat: t, result });
            rec.results.mechSkill = [`${t}号玩家的身份是：${result}`];
          }
          if (t != null && sk === 'poison' && pl.mech) pl.mech.poison = false;
          break;
        }
        default:
          return '这个步骤不能这样操作';
      }
      this.markDone(now);
      return null;
    }

    if (a.type === 'wolfPick') {
      if (step !== 'wolves') return '现在不是狼人行动时间';
      if (rec.wolfTarget !== undefined) return '狼队已经确定目标';
      const t = a.target;
      if (t !== null && !(this.validSeat(t) && this.p(t).alive)) return '目标无效';
      rec.wolfPicks[String(seat)] = { target: t, confirmed: !!a.confirm };
      const pack = this.packSeats(true);
      const picks = pack.map((x) => rec.wolfPicks[String(x)]);
      if (picks.every((x) => x && x.confirmed) && picks.every((x) => x.target === picks[0].target)) {
        rec.wolfTarget = picks[0].target;
        this.markDone(now);
      }
      return null;
    }

    if (a.type === 'witch') {
      if (step !== 'witch') return '现在不是女巫行动时间';
      const w = pl.witch!;
      const knifed = this.knifeTargets();
      const save = a.save;
      const poison = a.poison;
      if (save != null && poison != null) return '同一晚不能同时使用两瓶药';
      if (save != null) {
        if (!w.antidote) return '解药已经用过了';
        if (!knifed.includes(save)) return '只能救今晚被击杀的玩家';
        if (save === seat && !this.witchCanSelfSave()) return '女巫不能自救';
      }
      if (poison != null) {
        if (!w.poison) return '毒药已经用过了';
        if (!this.validSeat(poison) || !this.p(poison).alive || poison === seat) return '不能毒这名玩家';
      }
      rec.witch = { save: save ?? null, poison: poison ?? null };
      if (save != null) w.antidote = false;
      if (poison != null) w.poison = false;
      this.markDone(now);
      return null;
    }

    if (a.type === 'treasure') {
      if (step !== 'treasure') return '现在不是盗宝大师行动时间';
      const tr = pl.treasure!;
      const card = a.card;
      if (!(Number.isInteger(card) && card >= 0 && card < tr.cards.length)) return '请选择一张底牌';
      if (card === tr.last) return '不能连续两晚选择同一张底牌';
      const sk = this.treasureSkillFor(pl, card);
      let target = a.target ?? null;
      if (sk.skill === 'none') target = null;
      if (target != null && !sk.options.includes(target)) return '技能目标无效';
      if (target == null && sk.mandatory) return '这张牌必须选择技能目标';
      const canKill = this.knifeHolder() === seat;
      const kill = canKill ? (a.kill ?? null) : null;
      if (kill != null && !(this.validSeat(kill) && this.p(kill).alive)) return '击杀目标无效';
      const kill2 = canKill && tr.extraKnife && kill != null ? (a.kill2 ?? null) : null;
      if (kill2 != null && (!(this.validSeat(kill2) && this.p(kill2).alive) || kill2 === kill)) return '第二刀目标无效';
      tr.current = card;
      rec.treasure = { card, target, kill, kill2 };
      const res: string[] = [`今晚使用的身份牌：${ROLES[tr.cards[card]].name}`];
      if (target != null && (sk.skill === 'seer' || sk.skill === 'psychic')) {
        const result = sk.skill === 'seer' ? this.seerResult(target) : this.psychicResult(target);
        pl.checks.push({ night: this.s.night, seat: target, result });
        res.push(`${target}号玩家的身份是：${result}`);
      }
      if (target != null && sk.skill === 'poison') tr.poisons[card] = false;
      rec.results.treasure = res;
      this.markDone(now);
      return null;
    }
    return '未知操作';
  }

  witchCanSelfSave(): boolean {
    const r = this.s.config.rules.witchSelfSave;
    return r === 'always' || (r === 'firstNight' && this.s.night === 1);
  }

  /** knife targets so far tonight (pack + 机械狼 + 盗宝) */
  knifeTargets(): number[] {
    const rec = this.currentNight();
    const out: number[] = [];
    if (rec.treasure?.kill != null) out.push(rec.treasure.kill);
    if (rec.treasure?.kill2 != null) out.push(rec.treasure.kill2);
    if (rec.wolfTarget != null) out.push(rec.wolfTarget);
    for (const k of rec.mechKill ?? []) out.push(k);
    return [...new Set(out)];
  }

  treasureSkillFor(
    pl: Player,
    card: number,
  ): { skill: TreasureSkill; options: number[]; mandatory: boolean; label: string } {
    const tr = pl.treasure!;
    const role = tr.cards[card];
    let skill = treasureSkillOf(role);
    if (skill === 'poison' && !tr.poisons[card]) skill = 'none';
    const alive = this.aliveSeats();
    const others = alive.filter((x) => x !== pl.seat);
    const options = skill === 'none' ? [] : skill === 'guard' ? alive : others;
    const mandatory = skill === 'dream' || skill === 'curse';
    let label = TREASURE_SKILL_LABEL[skill];
    if (treasureSkillOf(role) === 'poison' && !tr.poisons[card]) label = '这张牌的毒药已经用过了';
    if (role === 'hunter') label = '持有猎人牌时，被刀或被放逐出局可以开枪';
    if (role === 'masked')
      label = tr.faction === 'wolf'
        ? '持有蒙面人牌：今晚被刀/毒/梦亡时延迟到明天发言后出局；若你是场上最后一名狼人，明天被放逐时可以发动主动蒙面技能'
        : '持有蒙面人牌：今晚被刀/毒/梦亡时延迟到明天发言后出局';
    return { skill, options, mandatory, label };
  }

  private applyDefault(step: NightStepId, now: number): void {
    const rec = this.currentNight();
    const actors = this.stepActors(step);
    if (actors.length === 0) return;
    const seat = actors[0];
    const pl = this.p(seat);
    switch (step) {
      case 'mixed': {
        const opt = this.pickOptions(step, seat).options;
        if (opt.length) {
          const t = pick(this.s, opt);
          rec.mixed = t;
          pl.mixedModel = t;
          rec.results.mixed = [`超时，系统为你随机选择了${t}号作为榜样。`];
        }
        break;
      }
      case 'dreamer': {
        const opt = this.pickOptions(step, seat).options;
        if (opt.length) rec.dream = pick(this.s, opt);
        break;
      }
      case 'crow': {
        const opt = this.pickOptions(step, seat).options;
        if (opt.length) rec.curse = pick(this.s, opt);
        break;
      }
      case 'treasure': {
        const tr = pl.treasure!;
        const allowed = [0, 1, 2].filter((c) => c !== tr.last && c < tr.cards.length);
        const card = pick(this.s, allowed);
        const sk = this.treasureSkillFor(pl, card);
        const target = sk.mandatory && sk.options.length ? pick(this.s, sk.options) : null;
        tr.current = card;
        rec.treasure = { card, target, kill: null };
        rec.results.treasure = [`超时，系统为你随机选择了：${ROLES[tr.cards[card]].name}`];
        break;
      }
      case 'wolves': {
        if (rec.wolfTarget !== undefined) break;
        const counts = new Map<number, number>();
        for (const x of this.packSeats(true)) {
          const pk = rec.wolfPicks[String(x)];
          if (pk && pk.target != null) counts.set(pk.target, (counts.get(pk.target) ?? 0) + 1);
        }
        if (counts.size === 0) rec.wolfTarget = null;
        else {
          const max = Math.max(...counts.values());
          const tops = [...counts.entries()].filter(([, c]) => c === max).map(([t]) => t);
          rec.wolfTarget = pick(this.s, tops.sort((a, b) => a - b));
        }
        break;
      }
      default:
        break;
    }
    void now;
  }

  /** settle the night at dawn: compute deaths (kept pending until announced) */
  private settleNight(now: number): void {
    const s = this.s;
    const rec = this.currentNight();
    const inp = this.nightInputs();
    const deaths = resolveNight(inp);
    // update persistent per-role state
    const dreamer = this.s.players.find((p) => p.role === 'dreamer');
    if (dreamer && dreamer.alive) dreamer.dreamLast = rec.dream ?? null;
    const guard = this.s.players.find((p) => p.role === 'guard');
    if (guard && guard.alive) guard.guardLast = rec.guard ?? null;
    const crow = this.s.players.find((p) => p.role === 'crow');
    if (crow && crow.alive) crow.crowLast = rec.curse ?? null;
    const mech = this.s.players.find((p) => p.role === 'mechwolf');
    if (mech?.mech && mech.alive) {
      if (this.mechSkill() === 'guard') mech.mech.guardLast = rec.mechSkill ?? null;
      // no one dies before dawn, so the knife holder now is the one that held it tonight
      if (s.night >= 2 && this.knifeHolder() === mech.seat && this.mechSkill() === 'double' && mech.mech.double === 'unused')
        mech.mech.double = (rec.mechKill?.length ?? 0) === 2 ? 'used' : 'expired';
    }
    const tp = this.s.players.find((p) => p.role === 'treasure');
    if (tp?.treasure && tp.alive) {
      tp.treasure.last = rec.treasure ? rec.treasure.card : null;
      if (rec.treasure?.target != null && treasureSkillOf(tp.treasure.cards[rec.treasure.card]) === 'dream')
        tp.treasure.lastDream = { night: s.night, target: rec.treasure.target };
      tp.treasure.extraKnife = false;
    }
    // 蒙面人: hit at night → 中毒/负伤, alive until their own speech tomorrow
    for (const [seat, causes] of [...deaths.entries()]) {
      if (this.hasMaskPassive(this.p(seat))) {
        deaths.delete(seat);
        s.wounded.push({ seat, causes, night: s.night });
      }
    }
    // curse for the coming day
    const curses: number[] = [];
    if (rec.curse != null) curses.push(rec.curse);
    if (rec.treasure && tp?.treasure && treasureSkillOf(tp.treasure.cards[rec.treasure.card]) === 'curse' && rec.treasure.target != null)
      curses.push(rec.treasure.target);
    s.curses = curses;

    const list = [...deaths.entries()].map(([seat, causes]) => ({ seat, causes })).sort((a, b) => a.seat - b.seat);
    rec.deaths = list;
    s.pending = list;
    s.pendingNight = s.night;
    rec.log = this.nightLog(rec, inp);
    this.startDay(now);
  }

  nightInputs(): NightInputs {
    const rec = this.currentNight();
    const knives: NightInputs['knives'] = [];
    if (rec.treasure?.kill != null) knives.push({ target: rec.treasure.kill, piercing: false });
    if (rec.treasure?.kill2 != null) knives.push({ target: rec.treasure.kill2, piercing: false });
    if (rec.wolfTarget != null) knives.push({ target: rec.wolfTarget, piercing: false });
    if (rec.mechKill?.length) {
      knives.push({ target: rec.mechKill[0], piercing: false });
      if (rec.mechKill[1] != null) knives.push({ target: rec.mechKill[1], piercing: true });
    }
    const guards: NightInputs['guards'] = [];
    if (rec.guard != null) guards.push({ target: rec.guard, blocksPoison: false });
    const mechSk = this.mechSkill();
    if (rec.mechSkill != null && mechSk === 'guard') guards.push({ target: rec.mechSkill, blocksPoison: true });
    const tp = this.s.players.find((p) => p.role === 'treasure');
    const tSkill = rec.treasure && tp?.treasure ? treasureSkillOf(tp.treasure.cards[rec.treasure.card]) : 'none';
    if (rec.treasure?.target != null && tSkill === 'guard') guards.push({ target: rec.treasure.target, blocksPoison: false });
    const dreams: NightInputs['dreams'] = [];
    const dreamer = this.s.players.find((p) => p.role === 'dreamer');
    if (rec.dream != null && dreamer)
      dreams.push({ by: dreamer.seat, target: rec.dream, consecutive: dreamer.dreamLast === rec.dream });
    if (rec.treasure?.target != null && tSkill === 'dream' && tp) {
      // 盗宝摄梦隔夜梦亡: the same sleepwalker on two successive uses of the card (one night apart)
      const last = tp.treasure?.lastDream;
      const consecutive = !!last && last.night === this.s.night - 2 && last.target === rec.treasure.target;
      dreams.push({ by: tp.seat, target: rec.treasure.target, consecutive });
    }
    const poisons: number[] = [];
    if (rec.witch?.poison != null) poisons.push(rec.witch.poison);
    if (rec.poison != null) poisons.push(rec.poison);
    if (rec.mechSkill != null && mechSk === 'poison') poisons.push(rec.mechSkill);
    if (rec.treasure?.target != null && tSkill === 'poison') poisons.push(rec.treasure.target);
    return {
      knives,
      guards,
      dreams,
      save: rec.witch?.save ?? null,
      poisons,
      dreamBlocksPoison: this.s.config.rules.dreamBlocksPoison,
    };
  }

  private nightLog(rec: NightRecord, inp: NightInputs): string[] {
    const L: string[] = [];
    const who = (role: RoleId) => {
      const seat = this.seatOf(role);
      return seat ? `${ROLES[role].name}(${seat}号)` : ROLES[role].name;
    };
    if (rec.mixed !== undefined) L.push(`${who('mixed')}选择${rec.mixed}号为榜样`);
    if (rec.mechLearn !== undefined)
      L.push(
        rec.mechLearn == null
          ? `${who('mechwolf')}没有学习`
          : `${who('mechwolf')}学习了${rec.mechLearn}号（${ROLES[this.p(rec.mechLearn).role].name}）`,
      );
    if (rec.treasure) {
      const tp = this.s.players.find((p) => p.role === 'treasure')!;
      const card = tp.treasure!.cards[rec.treasure.card];
      let line = `${who('treasure')}使用「${ROLES[card].name}」牌`;
      if (rec.treasure.target != null) line += `，技能目标${rec.treasure.target}号`;
      if (rec.treasure.kill != null) line += `，击杀${rec.treasure.kill}号`;
      if (rec.treasure.kill2 != null) line += `，第二刀击杀${rec.treasure.kill2}号`;
      L.push(line);
    }
    if (rec.dream !== undefined && rec.dream != null) L.push(`${who('dreamer')}摄梦${rec.dream}号`);
    if (rec.guard !== undefined) L.push(rec.guard == null ? `${who('guard')}空守` : `${who('guard')}守护${rec.guard}号`);
    if (rec.wolfTarget !== undefined) L.push(rec.wolfTarget == null ? '狼人空刀' : `狼人击杀${rec.wolfTarget}号`);
    if (rec.mechKill?.length)
      L.push(
        `${who('mechwolf')}击杀${rec.mechKill[0]}号` + (rec.mechKill[1] != null ? `，破盾刀击杀${rec.mechKill[1]}号` : ''),
      );
    if (rec.witch) {
      if (rec.witch.save != null) L.push(`${who('witch')}使用解药救了${rec.witch.save}号`);
      if (rec.witch.poison != null) L.push(`${who('witch')}毒杀${rec.witch.poison}号`);
      if (rec.witch.save == null && rec.witch.poison == null) L.push(`${who('witch')}没有用药`);
    }
    if (rec.poison != null) L.push(`${who('poisoner')}毒杀${rec.poison}号`);
    if (rec.seer != null) L.push(`${who('seer')}查验${rec.seer}号：${this.lastCheck('seer', rec.night)}`);
    if (rec.psychic != null) L.push(`${who('psychic')}查验${rec.psychic}号：${this.lastCheck('psychic', rec.night)}`);
    if (rec.curse != null) L.push(`${who('crow')}诅咒${rec.curse}号`);
    if (rec.mechSkill != null) L.push(`${who('mechwolf')}发动机械技能，目标${rec.mechSkill}号`);
    const deaths = rec.deaths ?? [];
    for (const w of this.s.wounded.filter((x) => x.night === rec.night))
      L.push(`${w.seat}号蒙面负伤（${w.causes.map((c) => CAUSE_TEXT[c]).join('、')}），次日发言后出局`);
    L.push(
      deaths.length
        ? `结算：${deaths.map((d) => `${d.seat}号（${d.causes.map((c) => CAUSE_TEXT[c]).join('、')}）`).join('，')}出局`
        : '结算：平安夜',
    );
    void inp;
    return L;
  }

  private lastCheck(role: RoleId, night: number): string {
    const pl = this.s.players.find((p) => p.role === role);
    return pl?.checks.find((c) => c.night === night)?.result ?? '';
  }

  /** death causes tonight if the night ended now (used for 开枪状态) */
  previewDeaths(): Map<number, DeathCause[]> {
    return resolveNight(this.nightInputs());
  }

  // ───────────────────────── day ─────────────────────────

  private startDay(now: number): void {
    const s = this.s;
    s.day = s.night;
    const q: DayStage[] = [];
    if (this.winnerIfPendingApplied() || this.maskedEarlyWin()) {
      // the night already decided the game: announce it straight away
      q.push('nightDeaths');
    } else {
      if (s.election?.status === 'suspended') q.push('election');
      else if (s.day === 1 && s.config.rules.sheriff && !s.election) q.push('election');
      q.push('nightDeaths', 'discussion', 'exile');
    }
    s.dayQueue = q;
    this.announce(now, '天亮了，请所有玩家睁眼。', ['dawn']);
    this.log('info', `第${s.day}天`);
    this.interlude(now, this.clipsDuration(['dawn']) + 1200);
  }

  private nextStage(now: number): void {
    const s = this.s;
    if (s.phase.kind === 'ended') return;
    const stage = s.dayQueue.shift();
    if (!stage) {
      // a 负伤 蒙面人 who never got to speak today goes out before night falls
      for (const w of s.wounded.slice()) {
        if (this.resolveWound(w.seat, now, null)) return;
      }
      this.startNight(now);
      return;
    }
    switch (stage) {
      case 'election':
        return this.enterElection(now);
      case 'nightDeaths':
        return this.announceNightDeaths(now);
      case 'discussion':
        return this.enterDiscussion(now);
      case 'exile':
        return this.startExileVote(now, false);
    }
  }

  // ── sheriff election ──

  private enterElection(now: number): void {
    const s = this.s;
    if (!s.election) {
      s.election = {
        signedUp: [],
        candidates: [],
        withdrawn: [],
        selfDestructs: 0,
        status: 'running',
        dir: rand(s) < 0.5 ? 'cw' : 'ccw',
        pk: null,
        resumed: false,
      };
      this.announce(now, '现在开始警长竞选，想要上警的玩家请在手机上举手。', ['signup']);
      s.phase = {
        kind: 'signup',
        deadline: now + this.clipsDuration(['signup']) + s.config.rules.signupSeconds * this.k,
        responses: {},
      };
      return;
    }
    const e = s.election;
    e.status = 'running';
    e.resumed = true;
    e.pk = null;
    e.candidates = e.candidates.filter((c) => this.p(c).alive);
    this.announce(now, '警长竞选继续，警上玩家可以选择退水。', ['withdraw_continue']);
    this.log('sheriff', `警长竞选继续，警上玩家：${e.candidates.length ? nums(e.candidates) : '无'}`);
    if (e.candidates.length === 0) {
      this.loseBadge(now, '警上已无玩家，警徽流失');
      return;
    }
    s.phase = { kind: 'withdraw', deadline: now + T.withdraw * this.k };
  }

  private finishSignup(now: number): void {
    const s = this.s;
    const ph = s.phase;
    if (ph.kind !== 'signup') return;
    const e = s.election!;
    e.signedUp = this.aliveSeats().filter((x) => ph.responses[String(x)] === true);
    e.candidates = e.signedUp.slice();
    if (e.signedUp.length === 0) {
      this.announce(now, '无人上警，警徽流失。', ['signup_none']);
      this.log('sheriff', '无人上警，警徽流失');
      s.badgeLost = true;
      e.status = 'done';
      this.interlude(now);
      return;
    }
    this.announce(now, `上警的玩家是：${nums(e.signedUp)}`, ['signup_result', ...e.signedUp.map(numClip)]);
    this.log('sheriff', `上警：${nums(e.signedUp)}`);
    if (e.signedUp.length === 1) {
      this.elect(e.signedUp[0], now);
      return;
    }
    const start = pick(s, e.candidates);
    const order = circular(e.candidates, start, e.dir, this.n);
    this.announce(
      now,
      `请警上玩家依次发言，从${order[0]}号开始，${e.dir === 'cw' ? '顺序' : '逆序'}发言。`,
      ['sheriff_speech', 'speech_from', numClip(order[0]), e.dir === 'cw' ? 'speech_cw' : 'speech_ccw'],
    );
    s.phase = { kind: 'speech', context: 'sheriff', order, idx: 0, startedAt: now };
  }

  private withdraw(seat: number, now: number): string | null {
    const s = this.s;
    const e = s.election;
    const ph = s.phase;
    const inSpeech = ph.kind === 'speech' && (ph.context === 'sheriff' || ph.context === 'sheriffPk');
    if (!e || e.status !== 'running' || !(inSpeech || ph.kind === 'withdraw')) return '现在不能退水';
    if (!e.candidates.includes(seat)) return '你不在警上';
    e.candidates = e.candidates.filter((x) => x !== seat);
    if (e.pk) e.pk = e.pk.filter((x) => x !== seat);
    e.withdrawn.push(seat);
    this.log('sheriff', `${seat}号退水`);
    if (ph.kind === 'speech') {
      const pool = ph.context === 'sheriffPk' ? (e.pk ?? []) : e.candidates;
      if (pool.length <= 1) {
        this.resolveCandidates(now, pool);
        return null;
      }
      if (ph.order[ph.idx] === seat) this.advanceSpeech(now);
    } else if (e.candidates.length === 0) {
      this.loseBadge(now, '警上玩家全部退水，警徽流失');
    }
    return null;
  }

  /** 0 candidates → badge lost, 1 → elected */
  private resolveCandidates(now: number, pool: number[]): void {
    if (pool.length === 1) this.elect(pool[0], now);
    else this.loseBadge(now, '警上已无玩家，警徽流失');
  }

  private startElectionVote(now: number, pk: boolean): void {
    const s = this.s;
    const e = s.election!;
    const candidates = pk ? (e.pk ?? []) : e.candidates;
    if (candidates.length <= 1) {
      this.resolveCandidates(now, candidates);
      return;
    }
    const voters = this.aliveSeats().filter((x) => !e.signedUp.includes(x));
    if (voters.length === 0) {
      this.loseBadge(now, '没有可以投票的警下玩家，警徽流失');
      return;
    }
    this.announce(now, pk ? '请再次投票。' : '请警下玩家投票。', [pk ? 'pk_vote' : 'sheriff_vote']);
    s.phase = {
      kind: 'vote',
      context: pk ? 'sheriffPk' : 'sheriff',
      candidates: candidates.slice(),
      voters,
      votes: {},
      deadline: now + s.config.rules.voteSeconds * this.k,
    };
  }

  private elect(seat: number, now: number): void {
    const s = this.s;
    s.sheriff = seat;
    if (s.election) s.election.status = 'done';
    this.announce(now, `${seat}号玩家当选警长。`, [numClip(seat), 'sheriff_elected']);
    this.log('sheriff', `${seat}号当选警长`);
    this.interlude(now);
  }

  private loseBadge(now: number, why: string): void {
    const s = this.s;
    s.badgeLost = true;
    if (s.election) s.election.status = 'done';
    this.announce(now, '警徽流失。', ['badge_lost']);
    this.log('sheriff', why);
    this.interlude(now);
  }

  // ── voting ──

  private vote(seat: number, target: number | null, now: number): string | null {
    const ph = this.s.phase;
    if (ph.kind !== 'vote') return '现在不是投票时间';
    if (!ph.voters.includes(seat)) return '你没有投票权';
    if (target !== null) {
      if (!ph.candidates.includes(target)) return '不能投给这名玩家';
      if (target === seat) return '不能投给自己';
    }
    ph.votes[String(seat)] = target;
    if (ph.voters.every((v) => String(v) in ph.votes)) this.finishVote(now);
    return null;
  }

  private tally(
    context: VoteContext,
    candidates: number[],
    voters: number[],
    votes: Record<string, number | null>,
  ): { rows: VoteRow[]; abstain: number[] } {
    const s = this.s;
    const exile = context === 'exile' || context === 'exilePk';
    const rows: VoteRow[] = candidates.map((c) => ({ target: c, voters: [], score: 0, curse: false }));
    const abstain: number[] = [];
    for (const v of voters) {
      const t = votes[String(v)];
      const row = t != null ? rows.find((r) => r.target === t) : undefined;
      if (!row) {
        abstain.push(v);
        continue;
      }
      row.voters.push(v);
      row.score += exile && s.sheriff === v && this.p(v).alive ? 1.5 : 1;
    }
    if (exile) {
      for (const c of s.curses) {
        const row = rows.find((r) => r.target === c);
        if (row) {
          row.score += 1;
          row.curse = true;
        }
      }
    }
    return { rows: rows.filter((r) => r.score > 0).sort((a, b) => b.score - a.score || a.target - b.target), abstain };
  }

  private finishVote(now: number): void {
    const s = this.s;
    const ph = s.phase;
    if (ph.kind !== 'vote') return;
    const { rows, abstain } = this.tally(ph.context, ph.candidates, ph.voters, ph.votes);
    const max = rows.length ? rows[0].score : 0;
    const tops = rows.filter((r) => r.score === max).map((r) => r.target);
    const label = { sheriff: '警长投票', sheriffPk: '警长PK投票', exile: '放逐投票', exilePk: '放逐PK投票' }[ph.context];
    const summary = rows.length
      ? rows.map((r) => `${r.target}号 ${r.score}票${r.curse ? '（含诅咒）' : ''}`).join('，')
      : '全部弃票';
    this.log(ph.context.startsWith('sheriff') ? 'sheriff' : 'vote', `${label}：${summary}`, {
      context: ph.context,
      rows,
      abstain,
    });
    if (ph.context === 'sheriff' || ph.context === 'sheriffPk') {
      const e = s.election!;
      if (max === 0) return this.loseBadge(now, '无人得票，警徽流失');
      if (tops.length === 1) return this.elect(tops[0], now);
      if (ph.context === 'sheriffPk') return this.loseBadge(now, '再次平票，警徽流失');
      e.pk = tops;
      const order = circular(tops, tops[0], e.dir, this.n);
      this.announce(now, `${nums(tops)}平票，请平票的玩家进行PK发言。`, ['pk_speech']);
      s.phase = { kind: 'speech', context: 'sheriffPk', order, idx: 0, startedAt: now };
      return;
    }
    // exile
    if (max === 0) return this.noExile(now, '无人得票，今天无人出局');
    if (tops.length === 1) return this.exile(tops[0], now);
    if (ph.context === 'exilePk') return this.noExile(now, '再次平票，今天无人出局');
    s.exilePk = tops;
    const order = tops.slice().sort((a, b) => a - b);
    this.announce(now, `${nums(tops)}平票，请平票的玩家进行PK发言。`, ['pk_speech']);
    s.phase = { kind: 'speech', context: 'exilePk', order, idx: 0, startedAt: now };
  }

  // ── speeches ──

  private speechEligible(seat: number, context: string): boolean {
    const s = this.s;
    if (context === 'lastWords') return true;
    if (!this.p(seat).alive) return false;
    if (context === 'sheriff') return !!s.election?.candidates.includes(seat);
    if (context === 'sheriffPk') return !!s.election?.pk?.includes(seat);
    return true;
  }

  private advanceSpeech(now: number): void {
    const ph = this.s.phase;
    if (ph.kind !== 'speech') return;
    const cur = ph.order[ph.idx];
    if (ph.context === 'discussion' && this.s.wounded.some((w) => w.seat === cur)) {
      const resume = { context: ph.context, order: ph.order, idx: ph.idx + 1 };
      if (this.resolveWound(cur, now, resume)) return;
    }
    let idx = ph.idx + 1;
    while (idx < ph.order.length && !this.speechEligible(ph.order[idx], ph.context)) idx++;
    if (idx < ph.order.length) {
      ph.idx = idx;
      ph.startedAt = now;
      if (ph.context === 'lastWords')
        this.announce(now, `请${ph.order[idx]}号玩家发表遗言。`, ['please', numClip(ph.order[idx]), 'lw_suffix']);
      return;
    }
    this.finishSpeeches(ph.context, now);
  }

  private finishSpeeches(context: string, now: number): void {
    const s = this.s;
    switch (context) {
      case 'sheriff': {
        const e = s.election!;
        if (e.candidates.length <= 1) return this.resolveCandidates(now, e.candidates);
        return this.startElectionVote(now, false);
      }
      case 'sheriffPk':
        return this.startElectionVote(now, true);
      case 'discussion':
        // the queued 'exile' stage starts the vote
        return this.nextStage(now);
      case 'exilePk':
        return this.startExileVote(now, true);
      case 'lastWords':
        return this.nextStage(now);
    }
  }

  // ── deaths ──

  private kill(seat: number, causes: DeathCause[], time: 'night' | 'day', index: number): void {
    const pl = this.p(seat);
    if (!pl.alive) return;
    pl.alive = false;
    this.s.wounded = this.s.wounded.filter((w) => w.seat !== seat);
    const note =
      time === 'night'
        ? `第${index}夜出局`
        : causes.includes('exile')
          ? `第${index}天放逐`
          : causes.includes('selfdestruct')
            ? `第${index}天自爆`
            : causes.includes('shot')
              ? `第${index}天被枪杀`
              : `第${index}天出局`;
    pl.death = { causes, time, index, note };
  }

  private announceNightDeaths(now: number): void {
    const s = this.s;
    const list = s.pending.filter((d) => this.p(d.seat).alive);
    s.pending = [];
    const night = s.pendingNight || s.night;
    if (list.length === 0) {
      this.announce(now, '昨天晚上是平安夜。', ['peaceful']);
      this.log('death', `第${night}夜：平安夜`);
      if (this.settleDoomedMasked(now)) return;
      this.interlude(now);
      return;
    }
    for (const d of list) this.kill(d.seat, d.causes, 'night', night);
    const seats = list.map((d) => d.seat);
    this.announce(now, `昨天晚上，${nums(seats)}玩家死亡。`, ['last_night', ...seats.map(numClip), 'died_suffix']);
    this.log('death', `第${night}夜死亡：${nums(seats)}`);
    if (this.checkEnd(now)) return;
    if (this.settleDoomedMasked(now)) return;
    this.enterDeathSkills(
      now,
      list.map((d) => ({ seat: d.seat, causes: d.causes })),
      night === 1 ? seats : [],
    );
  }

  private enterDeathSkills(
    now: number,
    dead: { seat: number; causes: DeathCause[] }[],
    lastWords: number[],
    resume?: { context: SpeechContext; order: number[]; idx: number } | null,
  ): void {
    const s = this.s;
    const entries: DeathEntry[] = dead.map((d) => ({
      seat: d.seat,
      causes: d.causes,
      canShoot: this.canShootFor(this.p(d.seat), d.causes),
      shot: undefined,
      badge: s.sheriff === d.seat && !s.badgeLost,
      badgeDone: false,
      done: false,
    }));
    this.announce(now, '请出局的玩家确认是否发动技能。', ['death_skill']);
    s.phase = {
      kind: 'deathSkills',
      entries,
      deadline: now + T.deathSkills * this.k,
      lastWords: lastWords.slice(),
      resume: resume ?? null,
    };
  }

  private shoot(seat: number, target: number | null, now: number): string | null {
    const s = this.s;
    const ph = s.phase;
    if (ph.kind !== 'deathSkills') return '现在不能开枪';
    const e = ph.entries.find((x) => x.seat === seat);
    if (!e || !e.canShoot) return '你没有可以发动的技能';
    if (e.shot !== undefined) return '你已经做出了选择';
    if (target !== null) {
      if (!this.validSeat(target) || !this.p(target).alive || target === seat) return '不能选择这名玩家';
    }
    e.shot = target;
    if (target === null) {
      if (!e.badge || e.badgeDone) e.done = true;
      this.maybeFinishDeathSkills(now);
      return null;
    }
    const shooter = this.p(seat);
    shooter.revealed = true;
    // a target still waiting on an unannounced night death dies now instead
    s.pending = s.pending.filter((d) => d.seat !== target);
    this.kill(target, ['shot'], 'day', s.day);
    this.announce(
      now,
      `${seat}号玩家开枪，带走了${target}号玩家。`,
      [numClip(seat), 'shot_mid', numClip(target), 'player'],
    );
    this.log('skill', `${seat}号（${ROLES[shooter.role === 'mechwolf' || shooter.role === 'treasure' ? 'hunter' : shooter.role].name}）开枪带走${target}号`);
    if (!e.badge || e.badgeDone) e.done = true;
    if (this.checkEnd(now)) return null;
    ph.entries.push({
      seat: target,
      causes: ['shot'],
      canShoot: false,
      shot: undefined,
      badge: s.sheriff === target && !s.badgeLost,
      badgeDone: false,
      done: false,
    });
    ph.lastWords.push(target);
    ph.deadline = Math.max(ph.deadline, now + T.deathSkillsExtend * this.k);
    this.maybeFinishDeathSkills(now);
    return null;
  }

  private passBadge(seat: number, target: number | null, now: number): string | null {
    const s = this.s;
    const ph = s.phase;
    if (ph.kind !== 'deathSkills') return '现在不能移交警徽';
    const e = ph.entries.find((x) => x.seat === seat);
    if (!e || !e.badge || e.badgeDone) return '你没有警徽可以移交';
    if (target !== null && (!this.validSeat(target) || !this.p(target).alive || target === seat))
      return '不能移交给这名玩家';
    this.applyBadge(seat, target, now);
    e.badgeDone = true;
    if (!e.canShoot || e.shot !== undefined) e.done = true;
    this.maybeFinishDeathSkills(now);
    return null;
  }

  private applyBadge(from: number, target: number | null, now: number): void {
    const s = this.s;
    if (target === null) {
      s.sheriff = null;
      s.badgeLost = true;
      this.announce(now, '警长撕毁了警徽。', ['badge_tear']);
      this.log('sheriff', `${from}号撕毁了警徽`);
    } else {
      s.sheriff = target;
      this.announce(now, `警长将警徽移交给${target}号玩家。`, ['badge_pass', numClip(target), 'player']);
      this.log('sheriff', `${from}号将警徽移交给${target}号`);
    }
  }

  private maybeFinishDeathSkills(now: number): void {
    const ph = this.s.phase;
    if (ph.kind !== 'deathSkills') return;
    if (ph.entries.every((e) => e.done)) this.finishDeathSkills(now);
  }

  private finishDeathSkills(now: number): void {
    const s = this.s;
    const ph = s.phase;
    if (ph.kind !== 'deathSkills') return;
    for (const e of ph.entries) {
      if (e.mask && !e.done) {
        // undecided 蒙面 skill on timeout: the exile stands
        this.useMask(e, false, now);
        if (s.phase.kind === 'ended') return;
      }
      if (e.canShoot && e.shot === undefined) e.shot = null;
      if (e.badge && !e.badgeDone) {
        // undecided badge on timeout is torn up
        this.applyBadge(e.seat, null, now);
        e.badgeDone = true;
      }
      e.done = true;
    }
    // the sheriff badge of a dead player who never got an entry (should not happen) is dropped
    if (s.sheriff != null && !this.p(s.sheriff).alive) {
      s.sheriff = null;
      s.badgeLost = true;
    }
    const lw = ph.lastWords.filter((x, i, a) => a.indexOf(x) === i && !this.p(x).alive);
    if (lw.length > 0) {
      this.announce(now, `请${lw[0]}号玩家发表遗言。`, ['please', numClip(lw[0]), 'lw_suffix']);
      s.phase = { kind: 'speech', context: 'lastWords', order: lw, idx: 0, startedAt: now };
      return;
    }
    if (ph.resume) {
      // continue the discussion after a 负伤 sheriff went out mid-way
      const r = ph.resume;
      s.phase = { kind: 'speech', context: r.context, order: r.order, idx: r.idx - 1, startedAt: now };
      let idx = r.idx;
      while (idx < r.order.length && !this.speechEligible(r.order[idx], r.context)) idx++;
      if (idx < r.order.length) {
        s.phase.idx = idx;
        return;
      }
      this.finishSpeeches(r.context, now);
      return;
    }
    this.nextStage(now);
  }

  /** 蒙面人 (or 盗宝大师 holding the 蒙面人 card tonight) */
  hasMaskPassive(pl: Player): boolean {
    if (pl.role === 'masked') return true;
    return pl.role === 'treasure' && !!pl.treasure && pl.treasure.current != null && pl.treasure.cards[pl.treasure.current] === 'masked';
  }

  /** a 负伤 player goes out; returns true when the flow moved elsewhere (game over / badge decision) */
  private resolveWound(
    seat: number,
    now: number,
    resume: { context: SpeechContext; order: number[]; idx: number } | null,
  ): boolean {
    const s = this.s;
    const w = s.wounded.find((x) => x.seat === seat);
    if (!w) return false;
    s.wounded = s.wounded.filter((x) => x.seat !== seat);
    if (!this.p(seat).alive) return false;
    this.kill(seat, w.causes, 'day', s.day);
    this.announce(now, `${seat}号玩家出局。`, [numClip(seat), 'out_suffix']);
    this.log('death', `${seat}号出局（第${w.night}夜负伤，发言后出局）`);
    if (this.checkEnd(now)) return true;
    if (s.sheriff === seat && !s.badgeLost) {
      this.enterDeathSkills(now, [{ seat, causes: w.causes }], [], resume);
      return true;
    }
    return false;
  }

  /** 京城: a doomed 负伤 蒙面人 whose death means 屠神 with ≥2 wolves left ends the game at dawn */
  maskedEarlyWin(): boolean {
    const s = this.s;
    if (!s.wounded.length) return false;
    const dead = new Set([...s.pending.map((d) => d.seat), ...s.wounded.map((w) => w.seat)]);
    const w = this.winnerWith((pl) => pl.alive && !dead.has(pl.seat));
    if (w !== 'wolf') return false;
    const pendingDead = new Set(s.pending.map((d) => d.seat));
    const wolves = s.players.filter((pl) => pl.alive && !pendingDead.has(pl.seat) && this.factionOf(pl) === 'wolf').length;
    return wolves >= 2;
  }

  private settleDoomedMasked(now: number): boolean {
    if (!this.maskedEarlyWin()) return false;
    const s = this.s;
    for (const w of s.wounded.slice()) {
      this.kill(w.seat, w.causes, 'day', s.day);
      this.announce(now, `${w.seat}号玩家出局。`, [numClip(w.seat), 'out_suffix']);
      this.log('death', `${w.seat}号出局（负伤，狼人已锁定胜局，提前结算）`);
    }
    s.wounded = [];
    return this.checkEnd(now);
  }

  /** 盗宝蒙面 (last wolf holding the 蒙面人 card) may survive being exiled once */
  maskActiveEligible(seat: number): boolean {
    const pl = this.p(seat);
    const tr = pl.treasure;
    if (pl.role !== 'treasure' || !tr || tr.faction !== 'wolf' || tr.maskUsed) return false;
    if (tr.current == null || tr.cards[tr.current] !== 'masked') return false;
    return !this.s.players.some((o) => o.seat !== seat && o.alive && this.factionOf(o) === 'wolf');
  }

  private useMask(e: DeathEntry, use: boolean, now: number): void {
    const s = this.s;
    const pl = this.p(e.seat);
    e.mask = false;
    if (use && pl.treasure) {
      e.done = true;
      // survived: no badge to hand over
      e.badge = false;
      e.badgeDone = true;
      pl.treasure.maskUsed = true;
      pl.treasure.extraKnife = true;
      const ph = s.phase;
      if (ph.kind === 'deathSkills') ph.lastWords = ph.lastWords.filter((x) => x !== e.seat);
      this.announce(now, `${e.seat}号玩家发动蒙面技能，被推不死。`, [numClip(e.seat), 'mask_survive']);
      this.log('skill', `${e.seat}号发动蒙面技能，被推不死`);
      return;
    }
    this.kill(e.seat, ['exile'], 'day', s.day);
    e.done = !(e.badge && !e.badgeDone);
    this.checkEnd(now);
  }

  // ── discussion & exile ──

  private enterDiscussion(now: number): void {
    const s = this.s;
    if (s.sheriff != null && this.p(s.sheriff).alive) {
      this.announce(now, '请警长选择发言顺序。', ['order_choose']);
      s.phase = { kind: 'orderChoice', deadline: now + T.orderChoice * this.k };
      return;
    }
    const alive = this.aliveSeats();
    const start = pick(s, alive);
    const dir = rand(s) < 0.5 ? 'cw' : 'ccw';
    this.startDiscussion(circular(alive, start, dir, this.n), dir, now);
  }

  /** first speaker after the sheriff in each direction */
  orderFirsts(): { cw: number; ccw: number } {
    const s = this.s;
    const sh = s.sheriff!;
    const alive = this.aliveSeats();
    const cw = circular(alive, (sh % this.n) + 1, 'cw', this.n)[0];
    const ccw = circular(alive, ((sh - 2 + this.n) % this.n) + 1, 'ccw', this.n)[0];
    return { cw, ccw };
  }

  private chooseOrder(dir: 'cw' | 'ccw', now: number): void {
    const s = this.s;
    if (s.phase.kind !== 'orderChoice') return;
    const sh = s.sheriff;
    if (sh == null || !this.p(sh).alive) {
      this.enterDiscussion(now);
      return;
    }
    const alive = this.aliveSeats();
    const from = dir === 'cw' ? (sh % this.n) + 1 : ((sh - 2 + this.n) % this.n) + 1;
    const order = circular(alive, from, dir, this.n);
    this.startDiscussion(order, dir, now);
  }

  private startDiscussion(order: number[], dir: 'cw' | 'ccw', now: number): void {
    const s = this.s;
    const first = order[0];
    s.discussionNote = `从${first}号开始${dir === 'cw' ? '顺序' : '逆序'}发言`;
    this.announce(now, `从${first}号开始，${dir === 'cw' ? '顺序' : '逆序'}发言。`, [
      'speech_from',
      numClip(first),
      dir === 'cw' ? 'speech_cw' : 'speech_ccw',
    ]);
    this.log('info', `发言顺序：${s.discussionNote}`);
    s.phase = { kind: 'speech', context: 'discussion', order, idx: 0, startedAt: now };
  }

  private startExileVote(now: number, pk: boolean): void {
    const s = this.s;
    const alive = this.aliveSeats();
    const candidates = pk ? (s.exilePk ?? []).filter((x) => this.p(x).alive) : alive;
    if (pk && candidates.length === 1) return this.exile(candidates[0], now);
    if (candidates.length === 0) return this.noExile(now, '今天无人出局');
    const voters = pk ? alive.filter((x) => !candidates.includes(x)) : alive;
    if (voters.length === 0) return this.noExile(now, '没有可以投票的玩家，今天无人出局');
    this.announce(now, pk ? '请再次投票。' : '发言结束，请所有存活玩家投票。', [pk ? 'pk_vote' : 'exile_vote']);
    s.phase = {
      kind: 'vote',
      context: pk ? 'exilePk' : 'exile',
      candidates,
      voters,
      votes: {},
      deadline: now + s.config.rules.voteSeconds * this.k,
    };
  }

  private exile(seat: number, now: number): void {
    const s = this.s;
    const pl = this.p(seat);
    if (this.maskActiveEligible(seat)) {
      this.announce(now, `${seat}号玩家被放逐出局。`, [numClip(seat), 'exiled_suffix']);
      this.log('death', `${seat}号被放逐`);
      this.enterDeathSkills(now, [{ seat, causes: ['exile'] }], [seat]);
      const ph = s.phase;
      if (ph.kind === 'deathSkills') ph.entries[0].mask = true;
      return;
    }
    this.kill(seat, ['exile'], 'day', s.day);
    if (pl.role === 'whitegod') {
      pl.revealed = true;
      this.announce(now, `${seat}号玩家出局，翻牌为白神，请留遗言。`, [numClip(seat), 'whitegod_flip']);
      this.log('death', `${seat}号被放逐出局，翻牌为白神`);
    } else {
      this.announce(now, `${seat}号玩家被放逐出局。`, [numClip(seat), 'exiled_suffix']);
      this.log('death', `${seat}号被放逐出局`);
    }
    if (this.checkEnd(now)) return;
    this.enterDeathSkills(now, [{ seat, causes: ['exile'] }], [seat]);
  }

  private noExile(now: number, why: string): void {
    this.announce(now, '今天无人出局。', ['no_exile']);
    this.log('vote', why);
    this.interlude(now);
  }

  // ── self-destruct ──

  selfDestructWindow(): boolean {
    const ph = this.s.phase;
    if (ph.kind === 'withdraw') return true;
    return ph.kind === 'speech' && ph.context !== 'lastWords';
  }

  /** can this 白狼王 take someone with him right now */
  wwkCanTake(seat: number): boolean {
    const pend = this.s.pending.find((d) => d.seat === seat);
    return !(pend && disablesSkill(pend.causes));
  }

  private selfDestruct(seat: number, target: number | null, now: number): string | null {
    const s = this.s;
    const pl = this.p(seat);
    if (!ROLES[pl.role].canSelfDestruct) return '你的身份不能自爆';
    if (!pl.alive) return '你已出局';
    if (!this.selfDestructWindow()) return '只能在白天发言阶段自爆';
    if (target != null) {
      if (pl.role !== 'whitewolfking') return '只有白狼王可以自爆带人';
      if (!this.validSeat(target) || !this.p(target).alive || target === seat) return '不能带走这名玩家';
      if (!this.wwkCanTake(seat)) return '你今晚被毒，自爆不能带人';
    }
    const ph = s.phase;
    const inElection =
      s.election?.status === 'running' &&
      (ph.kind === 'withdraw' || (ph.kind === 'speech' && (ph.context === 'sheriff' || ph.context === 'sheriffPk')));
    // an unannounced night death is swallowed by the self-destruct (吞毒自爆)
    s.pending = s.pending.filter((d) => d.seat !== seat && d.seat !== target);
    this.kill(seat, ['selfdestruct'], 'day', s.day);
    const dead: { seat: number; causes: DeathCause[] }[] = [{ seat, causes: ['selfdestruct'] }];
    if (target != null) {
      pl.revealed = true;
      this.kill(target, ['whitewolf'], 'day', s.day);
      dead.push({ seat: target, causes: ['whitewolf'] });
      this.announce(now, `${seat}号玩家自爆，翻牌为白狼王，带走了${target}号玩家。`, [
        numClip(seat),
        'sd_suffix',
        'wwk_take',
        numClip(target),
        'player',
      ]);
      this.log('selfDestruct', `${seat}号自爆（白狼王），带走${target}号`);
    } else {
      this.announce(now, `${seat}号玩家自爆。`, [numClip(seat), 'sd_suffix']);
      this.log('selfDestruct', `${seat}号自爆`);
    }
    if (inElection && s.election) {
      const e = s.election;
      e.selfDestructs += 1;
      e.candidates = e.candidates.filter((x) => x !== seat && x !== target);
      if (e.pk) e.pk = e.pk.filter((x) => x !== seat && x !== target);
      if (s.config.rules.badgeSwallow === 'single' || e.selfDestructs >= 2) {
        s.badgeLost = true;
        e.status = 'done';
        this.announce(now, '警徽流失。', ['badge_lost']);
        this.log('sheriff', s.config.rules.badgeSwallow === 'single' ? '警上自爆，警徽流失' : '双爆吞警徽，警徽流失');
      } else {
        e.status = 'suspended';
        this.announce(now, '警长竞选推迟到明天。', ['election_postponed']);
        this.log('sheriff', '警上自爆，警长竞选推迟到明天');
      }
    }
    if (this.checkEnd(now)) return null;
    // the rest of the day is skipped; unannounced night deaths are still announced first
    s.dayQueue = s.dayQueue.filter((st) => st === 'nightDeaths');
    const needsBadge = dead.some((d) => s.sheriff === d.seat && !s.badgeLost);
    if (needsBadge) {
      this.enterDeathSkills(now, dead.filter((d) => s.sheriff === d.seat), []);
    } else {
      this.interlude(now);
    }
    return null;
  }

  // ── end ──

  winnerIfPendingApplied(): Winner | null {
    const dead = new Set(this.s.pending.map((d) => d.seat));
    return this.winnerWith((pl) => pl.alive && !dead.has(pl.seat));
  }

  winnerNow(): Winner | null {
    return this.winnerWith((pl) => pl.alive);
  }

  private winnerWith(isAlive: (pl: Player) => boolean): Winner | null {
    const totals = { god: 0, villager: 0, wolf: 0 };
    const alive = { god: 0, villager: 0, wolf: 0 };
    for (const pl of this.s.players) {
      const c = this.countsAs(pl);
      totals[c]++;
      if (isAlive(pl)) alive[c]++;
    }
    const goodWin = alive.wolf === 0;
    const wolfWin = (totals.god > 0 && alive.god === 0) || (totals.villager > 0 && alive.villager === 0);
    if (goodWin && wolfWin) return this.s.config.rules.simultaneousWin;
    if (goodWin) return 'good';
    if (wolfWin) return 'wolf';
    return null;
  }

  private checkEnd(now: number): boolean {
    const w = this.winnerNow();
    if (!w) return false;
    this.endGame(w, now);
    return true;
  }

  private endGame(w: Winner, now: number): void {
    const s = this.s;
    s.winner = w;
    const alive = { god: 0, villager: 0, wolf: 0 };
    for (const pl of s.players) if (pl.alive) alive[this.countsAs(pl)]++;
    s.winReason =
      w === 'good'
        ? '所有狼人出局'
        : w === 'wolf'
          ? alive.god === 0 && alive.villager === 0
            ? '神职和平民全部出局'
            : alive.god === 0
              ? '所有神职出局（屠神）'
              : '所有平民出局（屠民）'
          : '双方同时达成胜利条件';
    s.phase = { kind: 'ended' };
    s.dayQueue = [];
    const clip = w === 'good' ? 'game_over_good' : w === 'wolf' ? 'game_over_wolf' : 'game_over_draw';
    this.announce(now, this.clipText(clip), [clip]);
    this.log('info', `游戏结束：${w === 'good' ? '好人阵营胜利' : w === 'wolf' ? '狼人阵营胜利' : '平局'}（${s.winReason}）`);
  }

  // ───────────────────────── views ─────────────────────────

  phaseView(): PhaseView {
    const s = this.s;
    const ph = s.phase;
    switch (ph.kind) {
      case 'dealt':
        return { kind: 'dealt', viewed: s.players.filter((p) => p.viewed).length, total: this.n };
      case 'night': {
        const step = ph.idx >= 0 && ph.idx < ph.steps.length ? ph.steps[ph.idx] : null;
        return { kind: 'night', step, stepName: step ? STEP_NAMES[step] : '', sub: ph.sub };
      }
      case 'interlude':
        return { kind: 'interlude' };
      case 'signup':
        return { kind: 'signup', responded: Object.keys(ph.responses).length, total: this.aliveSeats().length };
      case 'speech':
        return {
          kind: 'speech',
          context: ph.context,
          order: ph.order,
          idx: ph.idx,
          startedAt: ph.startedAt,
          candidates: s.election?.candidates ?? [],
          withdrawn: s.election?.withdrawn ?? [],
        };
      case 'withdraw':
        return { kind: 'withdraw', candidates: s.election?.candidates ?? [], withdrawn: s.election?.withdrawn ?? [] };
      case 'vote':
        return {
          kind: 'vote',
          context: ph.context,
          candidates: ph.candidates,
          voters: ph.voters,
          voted: ph.voters.filter((v) => String(v) in ph.votes),
        };
      case 'deathSkills':
        return { kind: 'deathSkills', entries: ph.entries.map((e) => ({ seat: e.seat, done: e.done })) };
      case 'orderChoice':
        return { kind: 'orderChoice', sheriff: s.sheriff ?? 0 };
      case 'ended':
        return { kind: 'ended', winner: s.winner ?? 'draw' };
    }
  }

  deadline(): number | null {
    const ph = this.s.phase;
    switch (ph.kind) {
      case 'night':
        return ph.sub === 'act' && !ph.fake ? ph.actMax : null;
      case 'signup':
      case 'vote':
      case 'withdraw':
      case 'orderChoice':
      case 'deathSkills':
        return ph.deadline;
      default:
        return null;
    }
  }

  banner(): { title: string; sub: string | null } {
    const s = this.s;
    const ph = s.phase;
    const last = s.announcements[s.announcements.length - 1];
    switch (ph.kind) {
      case 'dealt':
        return { title: '身份已发放', sub: '请点击下方「身份」查看你的身份牌' };
      case 'night': {
        const step = ph.idx >= 0 && ph.idx < ph.steps.length ? ph.steps[ph.idx] : null;
        if (!step) return { title: '天黑请闭眼', sub: `第${s.night}夜` };
        const name = STEP_NAMES[step];
        if (ph.sub === 'close') return { title: `${name}请闭眼`, sub: `第${s.night}夜` };
        return { title: `${name}请睁眼`, sub: `第${s.night}夜` };
      }
      case 'interlude':
        return { title: last?.text ?? '', sub: null };
      case 'signup':
        return { title: '警长竞选', sub: '想要上警的玩家请点击「上警」' };
      case 'speech': {
        const cur = ph.order[ph.idx];
        const t = {
          sheriff: '警上发言',
          sheriffPk: '警长PK发言',
          discussion: '发言',
          exilePk: '放逐PK发言',
          lastWords: '遗言',
        }[ph.context];
        const sub =
          ph.context === 'discussion' ? s.discussionNote : ph.context === 'lastWords' ? last?.text ?? null : null;
        return { title: `${t} · ${cur}号`, sub };
      }
      case 'withdraw':
        return { title: '警长竞选继续', sub: '警上玩家可以选择退水' };
      case 'vote': {
        const t = {
          sheriff: '警长投票',
          sheriffPk: '警长PK投票',
          exile: '放逐投票',
          exilePk: '放逐PK投票',
        }[ph.context];
        return { title: t, sub: ph.context === 'sheriff' || ph.context === 'sheriffPk' ? '警下玩家投票' : '所有存活玩家投票' };
      }
      case 'deathSkills':
        return { title: '出局玩家确认技能', sub: last?.text ?? null };
      case 'orderChoice':
        return { title: '警长选择发言顺序', sub: `${s.sheriff}号警长请选择` };
      case 'ended':
        return {
          title: s.winner === 'good' ? '好人阵营胜利' : s.winner === 'wolf' ? '狼人阵营胜利' : '平局',
          sub: s.winReason,
        };
    }
  }

  /** private prompt for a seat in the current phase */
  promptFor(seat: number): Prompt | null {
    const s = this.s;
    const ph = s.phase;
    const pl = this.p(seat);
    if (ph.kind === 'night') return this.nightPrompt(seat);
    if (ph.kind === 'signup') {
      if (!pl.alive) return null;
      const r = ph.responses[String(seat)];
      return { kind: 'signup', joined: r === undefined ? null : r };
    }
    if (ph.kind === 'vote') {
      if (!ph.voters.includes(seat)) return null;
      const v = ph.votes[String(seat)];
      return {
        kind: 'vote',
        context: ph.context,
        candidates: ph.candidates.filter((c) => c !== seat),
        myVote: String(seat) in ph.votes ? v : undefined,
      };
    }
    if (ph.kind === 'deathSkills') {
      const e = ph.entries.find((x) => x.seat === seat);
      if (!e) return null;
      const alive = this.aliveSeats().filter((x) => x !== seat);
      return {
        kind: 'deathSkill',
        canShoot: e.canShoot,
        shootOptions: e.canShoot ? alive : [],
        shot: e.shot,
        badge: e.badge,
        badgeOptions: e.badge ? alive : [],
        badgeDone: e.badgeDone,
        mask: !!e.mask,
        done: e.done,
      };
    }
    if (ph.kind === 'orderChoice' && s.sheriff === seat) {
      const f = this.orderFirsts();
      return { kind: 'orderChoice', cwFirst: f.cw, ccwFirst: f.ccw };
    }
    return null;
  }

  private nightPrompt(seat: number): Prompt | null {
    const s = this.s;
    const ph = s.phase as NightPhase;
    if (ph.idx < 0 || ph.idx >= ph.steps.length) return null;
    if (ph.sub !== 'open' && ph.sub !== 'act') return null;
    const step = ph.steps[ph.idx];
    if (!this.stepActors(step).includes(seat)) return null;
    const pl = this.p(seat);
    const rec = this.currentNight();
    const night = s.night;

    if (STATUS_STEPS.includes(step)) {
      const prev = this.previewDeaths().get(seat) ?? [];
      let lines: string[];
      let title: string;
      if (step === 'whitegodConfirm') {
        title = '白神请确认身份';
        lines = ['你是白神，没有主动技能。被放逐出局时会翻牌公布身份。'];
      } else if (step === 'maskedConfirm') {
        title = '蒙面人请确认身份';
        lines = ['你是蒙面人：夜间被刀、被毒或梦亡时不会立即出局，而是在第二天自己发言结束后出局。'];
      } else if (step === 'wwkStatus') {
        title = '白狼王技能状态';
        lines = [disablesSkill(prev) ? '你的技能状态：不能发动（今晚被毒）' : '你的技能状态：可以发动（白天自爆时可以带走一人）'];
      } else {
        title = step === 'hunterStatus' ? '猎人开枪状态' : '狼王开枪状态';
        lines = [disablesSkill(prev) ? '你的开枪状态：不能开枪' : '你的开枪状态：可以开枪'];
      }
      return { kind: 'status', step, title, lines, acked: rec.acks.includes(step) };
    }

    const interactive = this.stepInteractive(step);
    if (step === 'wolves') {
      const pack = this.packSeats(false);
      return {
        kind: 'wolves',
        title: night === 1 ? '狼人请互相确认身份，并选择今晚要击杀的玩家' : '请选择今晚要击杀的玩家',
        lines: ['所有狼人选择同一目标并确认后生效；超时按多数票决定，平票随机。'],
        options: this.aliveSeats(),
        teammates: pack.map((x) => ({ seat: x, role: this.p(x).role, alive: this.p(x).alive })),
        picks: this.packSeats(true).map((x) => {
          const pk = rec.wolfPicks[String(x)];
          return { seat: x, target: pk ? pk.target : undefined, confirmed: !!pk?.confirmed };
        }),
        myPick: rec.wolfPicks[String(seat)] ? rec.wolfPicks[String(seat)].target : undefined,
        myConfirmed: !!rec.wolfPicks[String(seat)]?.confirmed,
        locked: rec.wolfTarget !== undefined,
        final: rec.wolfTarget,
      };
    }
    if (step === 'witch') {
      const w = pl.witch!;
      const knifed = w.antidote ? this.knifeTargets() : null;
      const saveOptions =
        w.antidote && knifed ? knifed.filter((x) => x !== seat || this.witchCanSelfSave()) : [];
      const blocked =
        w.antidote && knifed && knifed.includes(seat) && !this.witchCanSelfSave() ? '女巫不能自救' : null;
      if (!interactive) {
        return {
          kind: 'status',
          step,
          title: '女巫',
          lines: ['你的解药和毒药都已经用完了。'],
          acked: rec.acks.includes(step),
        };
      }
      return {
        kind: 'witch',
        title: '女巫请选择是否用药',
        knifed,
        antidote: w.antidote,
        poison: w.poison,
        saveOptions,
        saveBlockedReason: blocked,
        poisonOptions: w.poison ? this.aliveSeats().filter((x) => x !== seat) : [],
        submitted: rec.witch ? { save: rec.witch.save, poison: rec.witch.poison } : null,
      };
    }
    if (step === 'treasure') {
      const tr = pl.treasure!;
      const allowed = [0, 1, 2].filter((c) => c < tr.cards.length && c !== tr.last);
      const canKill = this.knifeHolder() === seat;
      const lines = [
        `你的阵营：${tr.faction === 'wolf' ? '狼人阵营（底牌中有狼牌）' : tr.countsAs === 'god' ? '好人阵营（计入神职）' : '好人阵营（计入平民）'}`,
        night === 1 ? '首夜：请查看三张底牌并选择今晚使用的身份牌。' : `你的开刀状态：${canKill ? '可以开刀' : '不能开刀'}`,
      ];
      if (canKill && tr.extraKnife) lines.push('你发动了蒙面技能：今晚可以多刀一人。');
      if (tr.last != null) lines.push(`昨晚使用：${ROLES[tr.cards[tr.last]].name}（今晚不能再选）`);
      return {
        kind: 'treasure',
        title: '盗宝大师请选择今晚使用的身份牌',
        lines,
        cards: tr.cards.slice(),
        allowedCards: allowed,
        cardSkills: [0, 1, 2]
          .filter((c) => c < tr.cards.length)
          .map((c) => {
            const sk = this.treasureSkillFor(pl, c);
            return { card: c, skill: sk.skill, label: sk.label, mandatory: sk.mandatory, options: sk.options };
          }),
        canKill,
        killMax: canKill && tr.extraKnife ? 2 : 1,
        killOptions: canKill ? this.aliveSeats() : [],
        submitted: rec.treasure ? { ...rec.treasure } : null,
        result: rec.results.treasure ?? [],
      };
    }
    if (!interactive) {
      let lines: string[] = ['你现在没有需要执行的操作。'];
      let title = STEP_NAMES[step];
      if (step === 'mechKill') {
        title = '机械狼带刀状态';
        lines = ['你的带刀状态：不能带刀（狼队还有存活的狼人）'];
      } else if (step === 'mechSkill') {
        title = '机械狼技能';
        const sk = this.mechSkill();
        lines = [
          pl.mech?.learned ? `你学习的身份：${ROLES[pl.mech.learned].name}` : '你没有学习任何身份。',
          sk === 'poison' ? '你的毒药已经用过了。' : `你的机械技能：${MECH_SKILL_TEXT[sk]}`,
        ];
      } else if (step === 'poisoner') {
        lines = ['你的毒药已经用过了。'];
      }
      return { kind: 'status', step, title, lines, acked: rec.acks.includes(step) };
    }
    const opt = this.pickOptions(step, seat);
    const submitted = this.submittedFor(step, rec);
    const P = (title: string, lines: string[], noneLabel: string, confirmLabel: string): Prompt => ({
      kind: 'pick',
      step,
      title,
      lines,
      options: opt.options,
      max: opt.max,
      allowNone: opt.allowNone,
      noneLabel,
      confirmLabel,
      submitted,
      result: rec.results[step] ?? [],
    });
    switch (step) {
      case 'mixed':
        return P('请选择你的榜样', ['你的胜利条件将与榜样的阵营相同。'], '', '确认榜样');
      case 'mechLearn':
        return P('请选择你要学习的玩家', ['学习后得知其身份并获得对应机械技能，第二晚起生效。'], '不学习', '学习');
      case 'dreamer':
        return P(
          '请选择今晚的梦游者',
          [pl.dreamLast ? `昨晚的梦游者：${pl.dreamLast}号（再次选择会使其梦亡出局）` : '梦游者当晚免疫夜间伤害。'],
          '',
          '确认摄梦',
        );
      case 'guard':
        return P(
          '请选择你要守护的玩家',
          [pl.guardLast ? `昨晚守护：${pl.guardLast}号（今晚不能再守）` : '可以守护自己，也可以空守。'],
          '空守',
          '守护',
        );
      case 'mechKill': {
        const lines = ['你的带刀状态：可以带刀'];
        if (opt.max === 2) lines.push('你是双刀狼：今晚可以刀两人，第二刀为破盾刀（无视守卫守护），今晚不用则作废。');
        return P('请选择击杀目标', lines, '不刀人', '击杀');
      }
      case 'poisoner':
        return P('你要使用毒药吗？', ['毒药只有一瓶。'], '不使用', '毒杀');
      case 'seer':
        return P('请选择你要查验的玩家', ['结果为「好人」或「狼人」。'], '不查验', '查验');
      case 'psychic':
        return P('请选择你要查验的玩家', ['结果为具体身份。'], '不查验', '查验');
      case 'crow':
        return P(
          '请选择你要诅咒的玩家',
          [pl.crowLast ? `昨晚诅咒：${pl.crowLast}号（今晚不能再选）` : '被诅咒的玩家在明天的放逐投票中多计一票。'],
          '',
          '诅咒',
        );
      case 'mechSkill': {
        const sk = this.mechSkill();
        const title =
          sk === 'guard' ? '请选择你要守护的玩家' : sk === 'poison' ? '你要使用毒药吗？' : '请选择你要查验的玩家';
        const lines = [`你学习的身份：${ROLES[pl.mech!.learned!].name}`, `机械技能：${MECH_SKILL_TEXT[sk]}`];
        if (sk === 'guard' && pl.mech?.guardLast) lines.push(`昨晚守护：${pl.mech.guardLast}号（今晚不能再守）`);
        return P(title, lines, sk === 'guard' ? '空守' : sk === 'poison' ? '不使用' : '不查验', sk === 'guard' ? '守护' : sk === 'poison' ? '毒杀' : '查验');
      }
      default:
        return null;
    }
  }

  private submittedFor(step: NightStepId, rec: NightRecord): number[] | null {
    const one = (v: number | null | undefined) => (v === undefined ? null : v === null ? [] : [v]);
    switch (step) {
      case 'mixed':
        return one(rec.mixed);
      case 'mechLearn':
        return one(rec.mechLearn);
      case 'dreamer':
        return one(rec.dream);
      case 'guard':
        return one(rec.guard);
      case 'mechKill':
        return rec.mechKill === undefined ? null : rec.mechKill.slice();
      case 'poisoner':
        return one(rec.poison);
      case 'seer':
        return one(rec.seer);
      case 'psychic':
        return one(rec.psychic);
      case 'crow':
        return one(rec.curse);
      case 'mechSkill':
        return one(rec.mechSkill);
      default:
        return null;
    }
  }

  skillView(seat: number): SkillView {
    const pl = this.p(seat);
    const notes: string[] = [];
    if (pl.witch) notes.push(`解药：${pl.witch.antidote ? '可用' : '已用'}　毒药：${pl.witch.poison ? '可用' : '已用'}`);
    if (pl.role === 'poisoner') notes.push(`毒药：${pl.poisonerPoison ? '可用' : '已用'}`);
    if (pl.role === 'guard' && pl.guardLast) notes.push(`上一晚守护：${pl.guardLast}号`);
    if (pl.role === 'dreamer' && pl.dreamLast) notes.push(`上一晚梦游者：${pl.dreamLast}号`);
    if (pl.role === 'crow' && pl.crowLast) notes.push(`上一晚诅咒：${pl.crowLast}号`);
    if (pl.role === 'mixed') notes.push(pl.mixedModel ? `你的榜样：${pl.mixedModel}号` : '尚未选择榜样');
    if (pl.mech) {
      notes.push(
        pl.mech.learned
          ? `学习了${pl.mech.from}号：${ROLES[pl.mech.learned].name} → ${MECH_SKILL_TEXT[mechSkillFor(pl.mech.learned)]}`
          : '尚未学习',
      );
      if (mechSkillFor(pl.mech.learned ?? 'villager') === 'poison') notes.push(`机械毒药：${pl.mech.poison ? '可用' : '已用'}`);
      notes.push(`带刀状态：${this.knifeHolder() === seat ? '可以带刀' : '不能带刀'}`);
    }
    if (pl.treasure) {
      const tr = pl.treasure;
      notes.push(`底牌：${tr.cards.map((c) => ROLES[c].name).join('、')}`);
      if (tr.current != null) notes.push(`当前身份牌：${ROLES[tr.cards[tr.current]].name}`);
      if (tr.faction === 'wolf') notes.push(`开刀状态：${this.knifeHolder() === seat ? '可以开刀' : '不能开刀'}`);
    }
    if (pl.role === 'hunter' || pl.role === 'wolfking') notes.push('出局时如可开枪，系统会在技能确认环节提示你。');
    if (this.s.wounded.some((w) => w.seat === seat)) notes.push('负伤：今天你发言结束后出局。');
    if (pl.treasure?.maskUsed) notes.push('主动蒙面技能：已使用');
    let sd: SkillView['selfDestruct'] = null;
    if (ROLES[pl.role].canSelfDestruct) {
      const window = this.selfDestructWindow() && !this.s.paused;
      const available = pl.alive && window && this.s.phase.kind !== 'ended';
      const canTake = pl.role === 'whitewolfking' && this.wwkCanTake(seat);
      sd = {
        available,
        canTake: pl.role === 'whitewolfking' && canTake,
        reason: !pl.alive ? '你已出局' : !window ? '只能在白天发言阶段自爆' : null,
        targets: pl.role === 'whitewolfking' && canTake ? this.aliveSeats().filter((x) => x !== seat) : [],
      };
      if (pl.role === 'whitewolfking' && !this.wwkCanTake(seat) && available)
        sd.reason = '你今晚被毒，自爆不能带人';
    }
    return { selfDestruct: sd, notes };
  }

  privateInfo(seat: number): string[] {
    const pl = this.p(seat);
    const lines: string[] = [];
    const wound = this.s.wounded.find((w) => w.seat === seat);
    if (wound) lines.push('你昨晚负伤（蒙面技能已发动）：今天你发言结束后出局，这段发言就是你的遗言。');
    const f = this.factionOf(pl);
    if (pl.role === 'treasure' && pl.treasure) {
      lines.push(
        pl.treasure.faction === 'wolf'
          ? '你属于狼人阵营（底牌中有狼牌）。你不认识狼队，狼队也不认识你。'
          : `你属于好人阵营，计入${pl.treasure.countsAs === 'god' ? '神职' : '平民'}。`,
      );
    } else if (pl.role === 'mechwolf') {
      lines.push('你属于狼人阵营，但不与狼队见面，你们互不相识。');
    } else if (pl.role === 'mixed') {
      lines.push(pl.mixedModel ? `你的榜样是${pl.mixedModel}号，你的胜负与其阵营相同。` : '首夜请选择你的榜样。');
    } else {
      lines.push(f === 'wolf' ? '你属于狼人阵营。' : '你属于好人阵营。');
    }
    if (ROLES[pl.role].pack) {
      const mates = this.packSeats(false).filter((x) => x !== seat);
      if (mates.length)
        lines.push(`你的狼队友：${mates.map((x) => `${x}号${this.p(x).role === 'wolf' ? '' : `（${ROLES[this.p(x).role].name}）`}`).join('、')}`);
      else lines.push('你没有狼队友。');
    }
    return lines;
  }

  publicSeatInfo(seat: number): { alive: boolean; revealed: RoleId | null; deadNote: string | null } {
    const pl = this.p(seat);
    const ended = this.s.phase.kind === 'ended';
    return {
      alive: pl.alive,
      revealed: ended || pl.revealed ? pl.role : null,
      deadNote: pl.death?.note ?? null,
    };
  }

  result(names: (seat: number) => string | null): import('../../shared/types.ts').GameResult | null {
    const s = this.s;
    if (s.phase.kind !== 'ended' || !s.winner) return null;
    const w = s.winner;
    return {
      winner: w,
      reason: s.winReason,
      players: s.players.map((pl) => {
        let faction = this.factionOf(pl);
        if (pl.role === 'mixed') faction = pl.mixedModel ? this.factionOf(this.p(pl.mixedModel)) : 'good';
        return {
          seat: pl.seat,
          name: names(pl.seat),
          role: pl.role,
          faction,
          won: w !== 'draw' && faction === w,
          alive: pl.alive,
          note:
            pl.role === 'mixed' && pl.mixedModel
              ? `榜样：${pl.mixedModel}号`
              : pl.role === 'mechwolf' && pl.mech?.learned
                ? `学习：${ROLES[pl.mech.learned].name}`
                : pl.death?.note ?? null,
        };
      }),
      buried: s.buried ? s.buried.slice() : null,
      nights: s.nights.filter((r) => r.log.length).map((r) => ({ night: r.night, lines: r.log.slice() })),
    };
  }
}

