// Built-in bots (server/bots.ts, Room.planBots): the decisions they make from their own seat's view,
// seating and takeovers, and complete games on a fake clock (every preset + random custom tables).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOARDS, presetConfig, type GameConfig } from '../../shared/config.ts';
import type { RoleId } from '../../shared/roles.ts';
import type { GameAction, GameView, OwnerCommand, PhaseView, PrivateView, Prompt, RoomView, SeatView } from '../../shared/types.ts';
import { botMove, isBotId } from '../../server/bots.ts';
import type { Game } from '../../server/game/engine.ts';
import { RoomManager, type Room } from '../../server/rooms.ts';
import { randomConfig } from '../engine/tables.ts';

const OWNER = 'owner-aaaaaaaaaaaaaaaa';
const HUMAN = 'human-bbbbbbbbbbbbbbbb';
const SALTS = Array.from({ length: 40 }, (_, i) => `salt-${i}`);

// ── decisions on hand-made views ──

/** a bot's view with only the fields a decision reads */
function view(o: {
  seat: number;
  prompt?: Prompt | null;
  phase?: PhaseView;
  you?: Partial<PrivateView>;
  game?: Partial<GameView>;
  seats?: Record<number, Partial<SeatView>>;
}): RoomView {
  const n = 12;
  const seats = Array.from({ length: n }, (_, i) => ({ seat: i + 1, bot: true, revealed: null, viewedRole: true, ...(o.seats?.[i + 1] ?? {}) }));
  const you = { seat: o.seat, faction: 'good', teammates: [], checks: [], mech: null, prompt: o.prompt ?? null, ...o.you };
  const game = { gameNo: 1, day: 2, night: 2, time: 'day', paused: false, deadline: 5000, phase: o.phase ?? { kind: 'interlude' }, you, ...o.game };
  return { you: { seat: o.seat, name: '机器人', owner: false }, seats, game } as unknown as RoomView;
}

const votePhase = (candidates: number[]): PhaseView => ({ kind: 'vote', context: 'exile', candidates, voters: [], voted: [] });
const vote = (seat: number, candidates: number[]): Prompt => ({ kind: 'vote', context: 'exile', candidates: candidates.filter((c) => c !== seat), myVote: undefined });
const pack = (seats: number[]) => seats.map((s) => ({ seat: s, role: 'wolf' as RoleId, alive: true }));
const wolves = (o: Partial<Extract<Prompt, { kind: 'wolves' }>> = {}): Prompt => ({
  kind: 'wolves',
  title: '',
  lines: [],
  options: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  teammates: pack([2, 3, 4]),
  picks: [2, 3, 4].map((s) => ({ seat: s, target: undefined, confirmed: false })),
  myPick: undefined,
  myConfirmed: false,
  locked: false,
  final: undefined,
  ...o,
});
const pickPrompt = (o: Partial<Extract<Prompt, { kind: 'pick' }>>): Prompt => ({
  kind: 'pick',
  step: 'seer',
  title: '',
  lines: [],
  options: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  min: 1,
  max: 1,
  allowNone: true,
  noneLabel: '',
  confirmLabel: '',
  submitted: null,
  result: [],
  ...o,
});
const actions = (v: (salt: string) => RoomView): (GameAction | null)[] => SALTS.map((s) => botMove(v(s), s)?.action ?? null);
const targets = (as: (GameAction | null)[]) => as.map((a) => (a && 'target' in a ? a.target : a && 'targets' in a ? a.targets : undefined));

describe('bot decisions', () => {
  it('act only on their own turn, never while paused or after the end', () => {
    const speech: PhaseView = { kind: 'speech', context: 'discussion', order: [3, 4], idx: 0, startedAt: 1, candidates: [], withdrawn: [] };
    expect(botMove(view({ seat: 3, phase: speech }), 's')?.action).toEqual({ type: 'endSpeech' });
    expect(botMove(view({ seat: 4, phase: speech }), 's')).toBeNull();
    expect(botMove(view({ seat: 3, phase: speech, game: { paused: true } }), 's')).toBeNull();
    expect(botMove(view({ seat: 3, phase: { kind: 'ended', winner: 'good' }, game: { time: 'ended' } }), 's')).toBeNull();
    // after the deal each bot looks at its card once
    const dealt: PhaseView = { kind: 'dealt', viewed: 0, total: 12 };
    expect(botMove(view({ seat: 5, phase: dealt, seats: { 5: { viewedRole: false } } }), 's')?.action).toEqual({ type: 'viewRole' });
    expect(botMove(view({ seat: 5, phase: dealt }), 's')).toBeNull();
    // answered prompts are left alone
    expect(botMove(view({ seat: 5, prompt: { kind: 'signup', joined: false } }), 's')).toBeNull();
    expect(botMove(view({ seat: 5, prompt: { ...vote(5, [1, 2]), myVote: null } as Prompt, phase: votePhase([1, 2]) }), 's')).toBeNull();
  });

  it('are deterministic for the same view and salt', () => {
    const v = view({ seat: 6, prompt: vote(6, [1, 2, 3, 4, 5, 7, 8]), phase: votePhase([1, 2, 3, 4, 5, 6, 7, 8]) });
    expect(botMove(v, 'x')).toEqual(botMove(v, 'x'));
    const keys = new Set(SALTS.map((s) => botMove(v, s)!.key));
    expect(keys.size).toBe(1); // the key names the decision, not the choice
  });

  it('a seer votes out the wolf it found and never a player it checked as good', () => {
    const cand = [1, 3, 5, 7, 9];
    const checks = [
      { night: 1, seat: 5, result: '狼人' },
      { night: 2, seat: 3, result: '好人' },
    ];
    const ts = targets(actions(() => view({ seat: 8, prompt: vote(8, cand), phase: votePhase(cand), you: { checks } })));
    expect(ts.filter((t) => t !== null).every((t) => t === 5)).toBe(true);
    expect(ts.filter((t) => t === 5).length).toBeGreaterThan(SALTS.length * 0.85);
    // without a wolf among the candidates the good player is still spared
    const cand2 = [1, 3, 7, 9];
    const ts2 = targets(actions(() => view({ seat: 8, prompt: vote(8, cand2), phase: votePhase(cand2), you: { checks } })));
    expect(ts2).not.toContain(3);
    // 通灵师 results name the role
    const psy = [{ night: 1, seat: 7, result: '白狼王' }];
    const ts3 = targets(actions(() => view({ seat: 8, prompt: vote(8, cand2), phase: votePhase(cand2), you: { checks: psy } })));
    expect(ts3.filter((t) => t !== null).every((t) => t === 7)).toBe(true);
  });

  it('a seer checks someone it has not checked yet, never itself', () => {
    const checks = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11].map((s) => ({ night: 1, seat: s, result: '好人' }));
    const ts = targets(actions(() => view({ seat: 8, prompt: pickPrompt({ options: [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12] }), you: { checks } })));
    expect(ts.every((t) => JSON.stringify(t) === '[12]')).toBe(true);
  });

  it('the wolf pack never knifes or votes a teammate and agrees on one target', () => {
    const mates = { faction: 'wolf' as const, teammates: pack([2, 3, 4]) };
    for (const salt of SALTS) {
      const picks = [2, 3, 4].map((s) => botMove(view({ seat: s, prompt: wolves(), you: mates }), salt)!.action);
      const t = (picks[0] as { target: number }).target;
      expect([2, 3, 4]).not.toContain(t);
      expect(picks).toEqual([2, 3, 4].map(() => ({ type: 'wolfPick', target: t, confirm: true })));
    }
    const cand = [1, 2, 3, 4, 5, 6];
    const ts = [2, 3, 4].flatMap((s) => targets(actions(() => view({ seat: s, prompt: vote(s, cand), phase: votePhase(cand), you: mates }))));
    expect(ts.some((t) => t === 2 || t === 3 || t === 4)).toBe(false);
  });

  it('bot wolves follow a person in their pack, and a teammate bot that already picked', () => {
    const mates = { faction: 'wolf' as const, teammates: pack([1, 2, 3]) };
    const seats = { 1: { bot: false } };
    const picks = [
      { seat: 1, target: 9, confirmed: false },
      { seat: 2, target: 6, confirmed: true },
      { seat: 3, target: undefined, confirmed: false },
    ];
    const p = wolves({ teammates: mates.teammates, picks });
    expect(botMove(view({ seat: 3, prompt: p, you: mates, seats }), 's')!.action).toEqual({ type: 'wolfPick', target: 9, confirm: true });
    // the bot that picked 6 changes to the person's 9 …
    expect(botMove(view({ seat: 2, prompt: { ...p, myPick: 6, myConfirmed: true } as Prompt, you: mates, seats }), 's')!.action).toMatchObject({ target: 9 });
    // … and stays put once it agrees
    expect(botMove(view({ seat: 2, prompt: { ...p, myPick: 9, myConfirmed: true } as Prompt, you: mates, seats }), 's')).toBeNull();
    // a person's 空刀 is followed too
    const empty = wolves({ teammates: mates.teammates, picks: [{ seat: 1, target: null, confirmed: true }, ...picks.slice(1)] });
    expect(botMove(view({ seat: 3, prompt: empty, you: mates, seats }), 's')!.action).toMatchObject({ target: null });
    // without people, a bot follows a teammate bot that already picked
    const bots = wolves({ teammates: mates.teammates, picks: [{ seat: 1, target: 11, confirmed: true }, ...picks.slice(1)] });
    expect(botMove(view({ seat: 3, prompt: bots, you: mates }), 's')!.action).toMatchObject({ target: 11 });
    // 首夜禁刀: the pack only confirms
    const quiet = wolves({ teammates: mates.teammates, picks, options: [], noKnife: true });
    expect(botMove(view({ seat: 3, prompt: quiet, you: mates, seats }), 's')!.action).toEqual({ type: 'wolfPick', target: null, confirm: true });
    expect(botMove(view({ seat: 3, prompt: { ...p, locked: true } as Prompt, you: mates, seats }), 's')).toBeNull();
  });

  it('a witch usually saves on night 1 and never poisons that night', () => {
    const p: Prompt = { kind: 'witch', title: '', knifed: [7], antidote: true, poison: true, saveOptions: [7], saveBlockedReason: null, poisonOptions: [1, 2, 3, 7], submitted: null };
    const as = actions(() => view({ seat: 5, prompt: p, game: { night: 1 } })) as Extract<GameAction, { type: 'witch' }>[];
    expect(as.every((a) => a.poison === null)).toBe(true);
    expect(as.filter((a) => a.save === 7).length).toBeGreaterThan(SALTS.length * 0.75);
    // no antidote left: some later nights she poisons, never herself and never both potions at once
    const later = { ...p, antidote: false, saveOptions: [], knifed: null } as Prompt;
    const as2 = actions(() => view({ seat: 5, prompt: later, game: { night: 3 } })) as Extract<GameAction, { type: 'witch' }>[];
    expect(as2.some((a) => a.poison !== null)).toBe(true);
    expect(as2.every((a) => a.save === null && a.poison !== 5)).toBe(true);
  });

  it('mandatory skills always get a target; optional ones may be skipped', () => {
    const confess = pickPrompt({ step: 'wolfgirl', options: [1, 5, 6, 7], allowNone: false });
    const ts = targets(actions(() => view({ seat: 2, prompt: confess, you: { faction: 'wolf', teammates: pack([2, 3]) } })));
    expect(ts.every((t) => Array.isArray(t) && t.length === 1)).toBe(true);
    // 诡术师 that skipped last night must swap two numbers tonight
    const swap = pickPrompt({ step: 'trickster', options: [1, 2, 3, 4], min: 2, max: 2, allowNone: false });
    expect(targets(actions(() => view({ seat: 2, prompt: swap, you: { faction: 'wolf' } }))).every((t) => Array.isArray(t) && t.length === 2)).toBe(true);
    // 舞者 picks three or nobody
    const dance = pickPrompt({ step: 'dancer', options: [1, 2, 3, 4, 5], min: 3, max: 3 });
    const ds = targets(actions(() => view({ seat: 2, prompt: dance })));
    expect(ds.every((t) => Array.isArray(t) && (t.length === 3 || t.length === 0))).toBe(true);
    expect(ds.some((t) => (t as number[]).length === 3) && ds.some((t) => (t as number[]).length === 0)).toBe(true);
    // 摄梦人 does not dream of last night's player twice (梦亡) while others are available
    const dream = pickPrompt({ step: 'dreamer', options: [1, 3, 4], allowNone: false, lines: ['昨晚的梦游者：3号（再次选择会使其梦亡出局）'] });
    expect(targets(actions(() => view({ seat: 2, prompt: dream }))).some((t) => JSON.stringify(t) === '[3]')).toBe(false);
  });

  it('盗宝大师 uses a card it may use, fills mandatory targets and never knifes itself', () => {
    const p: Prompt = {
      kind: 'treasure',
      title: '',
      lines: [],
      cards: ['seer', 'wolf', 'villager'],
      allowedCards: [0, 1],
      cardSkills: [
        { card: 0, skill: 'seer', label: '', mandatory: true, options: [1, 2, 3] },
        { card: 1, skill: 'none', label: '', mandatory: false, options: [] },
        { card: 2, skill: 'none', label: '', mandatory: false, options: [] },
      ],
      canKill: true,
      killMax: 2,
      killOptions: [1, 2, 3, 4],
      submitted: null,
      result: [],
    };
    for (const a of actions(() => view({ seat: 4, prompt: p, you: { faction: 'wolf' } })) as Extract<GameAction, { type: 'treasure' }>[]) {
      expect([0, 1]).toContain(a.card);
      if (a.card === 0) expect([1, 2, 3]).toContain(a.target);
      else expect(a.target).toBeNull();
      expect(a.kill).not.toBe(4);
      expect(a.kill2).not.toBe(4);
      if (a.kill2 != null) expect(a.kill2).not.toBe(a.kill);
    }
    // a card whose skill must hit someone but has nobody to hit is left alone
    const stuck = { ...p, cardSkills: p.cardSkills.map((c) => (c.card === 0 ? { ...c, options: [] } : c)) } as Prompt;
    for (const a of actions(() => view({ seat: 4, prompt: stuck, you: { faction: 'wolf' } })) as Extract<GameAction, { type: 'treasure' }>[])
      expect(a.card).toBe(1);
  });

  it('death skills: 蒙面 survival first, then the badge, then the gun', () => {
    const base = { kind: 'deathSkill' as const, canShoot: true, shootOptions: [1, 2, 3], shot: undefined, badge: true, badgeOptions: [1, 2, 3], badgeDone: false, mask: true, done: false };
    expect(botMove(view({ seat: 5, prompt: base }), 's')!.action).toEqual({ type: 'mask', use: true });
    expect(botMove(view({ seat: 5, prompt: { ...base, mask: false } }), 's')!.action.type).toBe('badge');
    expect(botMove(view({ seat: 5, prompt: { ...base, mask: false, badgeDone: true } }), 's')!.action.type).toBe('shoot');
    expect(botMove(view({ seat: 5, prompt: { ...base, mask: false, badgeDone: true, shot: null } }), 's')!.action).toEqual({ type: 'skillDone' });
    // a hunter who knows a wolf shoots it
    const known = { ...base, mask: false, badge: false, badgeOptions: [] };
    const ts = targets(actions(() => view({ seat: 5, prompt: known, you: { checks: [{ night: 1, seat: 2, result: '狼人' }] } })));
    expect(ts.every((t) => t === 2)).toBe(true);
  });
});

// ── rooms on a fake clock ──

let logs: string[];
beforeEach(() => {
  vi.useFakeTimers();
  logs = [];
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function newRoom(cfg: GameConfig, opts: { dataDir?: string; clip?: number } = {}): { mgr: RoomManager; room: Room } {
  const mgr = new RoomManager({ dataDir: opts.dataDir ?? null, dur: () => opts.clip ?? 1.2, scale: 1, testHooks: true });
  return { mgr, room: mgr.create(cfg, OWNER, '房主') as Room };
}

/** as the websocket handler runs them */
function owner(room: Room, cmd: OwnerCommand, who = OWNER): string | null {
  const now = Date.now();
  room.tick(now);
  const err = room.owner(who, cmd, now);
  room.changed();
  return err;
}
function act(room: Room, who: string, a: GameAction): string | null {
  const now = Date.now();
  room.tick(now);
  const err = room.act(who, a, now);
  room.changed();
  return err;
}
function sit(room: Room, who: string, name: string, seat: number): string | null {
  room.hello(who, name, undefined);
  const err = room.sit(who, seat);
  room.changed();
  return err;
}
function runUntil(room: Room, done: () => boolean, maxMs: number, step = 1000): void {
  for (let t = 0; t < maxMs && !done(); t += step) vi.advanceTimersByTime(step);
  if (!done()) throw new Error(`not reached; phase=${JSON.stringify(room.game?.s.phase).slice(0, 300)}`);
}
const ended = (room: Room) => room.game?.s.phase.kind === 'ended';
const allViewed = (room: Room) => room.data.seats.every((cid, i) => !isBotId(cid) || room.game!.p(i + 1).viewed);

function startWithBots(room: Room, deal: OwnerCommand = { type: 'deal' }): Game {
  expect(owner(room, { type: 'addBots' })).toBeNull();
  expect(owner(room, deal)).toBeNull();
  runUntil(room, () => allViewed(room), 30_000);
  expect(owner(room, { type: 'start' })).toBeNull();
  return room.game!;
}

function playAllBots(cfg: GameConfig): Game {
  const { room } = newRoom(cfg);
  const g = startWithBots(room);
  runUntil(room, () => ended(room), 6 * 3600_000, 5000);
  room.dispose();
  // the pack never knifed one of its own
  const packSeats = g.packSeats(false);
  for (const rec of g.s.nights) if (rec.wolfTarget != null) expect(packSeats).not.toContain(rec.wolfTarget);
  return g;
}

describe('bots at the table', () => {
  it('the owner fills empty seats, removes bots, and a person can take a bot seat in the lobby', () => {
    const { room } = newRoom(presetConfig('ynlb'));
    expect(sit(room, OWNER, '房主', 1)).toBeNull();
    room.hello(HUMAN, '小明', undefined);
    expect(owner(room, { type: 'addBots' }, HUMAN)).toBe('只有房主可以这样做');
    expect(owner(room, { type: 'addBots' })).toBeNull();
    const v = room.view(HUMAN, Date.now());
    expect(v.seats.filter((s) => s.bot).map((s) => s.seat)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(v.seats[1]).toMatchObject({ name: '机器人', occupied: true, connected: true, bot: true, owner: false });
    expect(v.seats[0].bot).toBe(false);
    expect(owner(room, { type: 'addBots' })).toBe('没有空座位');
    expect(owner(room, { type: 'addBots', seats: [1] })).toBe('只能把机器人放在空座位上');
    // a person taps a bot's seat and takes it
    expect(sit(room, HUMAN, '小明', 7)).toBeNull();
    expect(room.seatOf(HUMAN)).toBe(7);
    // one bot out, one back in on that seat
    expect(owner(room, { type: 'kick', seat: 5 })).toBeNull();
    expect(room.data.seats[4]).toBeNull();
    expect(owner(room, { type: 'addBots', seats: [5] })).toBeNull();
    expect(isBotId(room.data.seats[4])).toBe(true);
    for (const bad of [[2, 2], ['x'], [0], [13], 5]) expect(owner(room, { type: 'addBots', seats: bad as number[] })).not.toBeNull();
    // everybody but the people leaves; bots leave no names behind
    expect(owner(room, { type: 'removeBots' })).toBeNull();
    expect(room.data.seats.filter(Boolean)).toEqual([OWNER, HUMAN]);
    expect(Object.keys(room.data.names).some(isBotId)).toBe(false);
    expect(owner(room, { type: 'removeBots' })).toBe('没有机器人');
    // a smaller table drops the bots beyond it
    owner(room, { type: 'addBots' });
    expect(owner(room, { type: 'reconfigure', config: presetConfig('n9') })).toBeNull();
    expect(room.data.seats.length).toBe(9);
    expect(Object.keys(room.data.names).filter(isBotId).length).toBe(room.data.seats.filter(isBotId).length);
  });

  it('during a game a bot takes over a released seat and a person can take over a bot', () => {
    const { room } = newRoom(presetConfig('ynlb'));
    sit(room, OWNER, '房主', 1);
    owner(room, { type: 'addBots' });
    owner(room, { type: 'deal' });
    const g = room.game!;
    const role1 = g.p(1).role;
    expect(owner(room, { type: 'addBots' })).toBe('没有待认领的座位');
    expect(owner(room, { type: 'removeBots' })).toMatch(/游戏进行中/);
    // the owner leaves the table: a bot plays seat 1 from now on (and looks at the card)
    expect(owner(room, { type: 'kick', seat: 1 })).toBeNull();
    expect(owner(room, { type: 'addBots', seats: [2] })).toBe('机器人只能接管待认领的座位');
    expect(owner(room, { type: 'addBots' })).toBeNull();
    expect(isBotId(room.data.seats[0])).toBe(true);
    expect(room.data.claimable).toEqual([]);
    runUntil(room, () => allViewed(room), 30_000);
    expect(g.p(1).role).toBe(role1);
    // a latecomer takes over seat 4 from its bot and keeps the role
    const role4 = g.p(4).role;
    expect(owner(room, { type: 'kick', seat: 4 })).toBeNull();
    expect(sit(room, HUMAN, '小明', 4)).toBeNull();
    expect(room.view(HUMAN, Date.now()).game!.you!.role).toBe(role4);
    expect(Object.keys(room.data.names).some(isBotId)).toBe(true);
    expect(Object.keys(room.data.names).filter(isBotId).length).toBe(11);
    expect(logs).toEqual([]);
  });

  it('bots play every preset board to the end on their own', () => {
    for (const b of BOARDS) {
      for (let k = 0; k < 3; k++) {
        const g = playAllBots(presetConfig(b.id));
        expect(g.s.winner, b.name).not.toBeNull();
      }
    }
    expect(logs).toEqual([]);
  });

  it('bots play random custom tables to the end (any size, any mix of roles)', () => {
    for (let seed = 1; seed <= 150; seed++) expect(playAllBots(randomConfig(seed)).s.phase.kind).toBe('ended');
    expect(logs).toEqual([]);
  });

  it('a person plays among bots: the bot wolves follow the person, nobody ends the person\'s speech', () => {
    const { room } = newRoom(presetConfig('ynlb'));
    sit(room, OWNER, '房主', 1);
    const seats: RoleId[] = ['wolf', 'wolf', 'wolf', 'wolf', 'seer', 'witch', 'hunter', 'whitegod', 'villager', 'villager', 'villager', 'villager'];
    const g = startWithBots(room, { type: 'debugDeal', seats });
    runUntil(room, () => g.promptFor(1)?.kind === 'wolves', 120_000, 250);
    // the person points at 9 without confirming: the bots of the pack follow
    expect(act(room, OWNER, { type: 'wolfPick', target: 9, confirm: false })).toBeNull();
    const rec = g.currentNight();
    runUntil(room, () => [2, 3, 4].every((s) => rec.wolfPicks[String(s)]?.target === 9 && rec.wolfPicks[String(s)].confirmed), 15_000, 250);
    expect(rec.wolfTarget).toBeUndefined();
    expect(act(room, OWNER, { type: 'wolfPick', target: 9, confirm: true })).toBeNull();
    expect(rec.wolfTarget).toBe(9);
    // the person's speech lasts as long as the person wants
    runUntil(room, () => ended(room) || (g.s.phase.kind === 'speech' && g.s.phase.order[g.s.phase.idx] === 1), 3600_000, 250);
    if (!ended(room)) {
      const before = JSON.stringify(g.s.phase);
      vi.advanceTimersByTime(10 * 60_000);
      expect(JSON.stringify(g.s.phase)).toBe(before);
      expect(act(room, OWNER, { type: 'endSpeech' })).toBeNull();
      expect(JSON.stringify(g.s.phase)).not.toBe(before);
    }
    // from here the person only ends their speeches (speeches never time out); bots and timeouts do the rest
    for (let t = 0; t < 6 * 3600_000 && !ended(room); t += 2000) {
      const ph = g.s.phase;
      if (ph.kind === 'speech' && ph.order[ph.idx] === 1) expect(act(room, OWNER, { type: 'endSpeech' })).toBeNull();
      vi.advanceTimersByTime(2000);
    }
    expect(ended(room)).toBe(true);
    room.dispose();
    expect(logs).toEqual([]);
  });

  it('bots wait for the judge to finish speaking before they vote', () => {
    const { room } = newRoom(presetConfig('ynlb'), { clip: 4 });
    const g = startWithBots(room);
    runUntil(room, () => g.s.phase.kind === 'vote', 3600_000, 100);
    const ann = g.s.announcements[g.s.announcements.length - 1];
    const voiceEnd = ann.at + g.clipsDuration(ann.clips);
    expect(voiceEnd - Date.now()).toBeGreaterThan(3000);
    vi.advanceTimersByTime(voiceEnd - Date.now() - 100);
    expect(g.s.phase.kind === 'vote' && Object.keys(g.s.phase.votes)).toEqual([]);
    runUntil(room, () => g.s.phase.kind !== 'vote' || Object.keys(g.s.phase.votes).length > 0, 7000, 100);
    room.dispose();
  });

  it('bots hold still while the game is paused', () => {
    const { room } = newRoom(presetConfig('ynlb'));
    const g = startWithBots(room);
    runUntil(room, () => g.s.day === 1 && g.s.phase.kind === 'signup', 3600_000, 500);
    expect(owner(room, { type: 'pause' })).toBeNull();
    const before = JSON.stringify(g.s);
    vi.advanceTimersByTime(30 * 60_000);
    expect(JSON.stringify(g.s)).toBe(before);
    expect(owner(room, { type: 'resume' })).toBeNull();
    runUntil(room, () => ended(room), 6 * 3600_000, 5000);
    room.dispose();
    expect(logs).toEqual([]);
  });

  it('bots carry on after a server restart', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wwd-bots-'));
    try {
      const { mgr, room } = newRoom(presetConfig('ynls'), { dataDir });
      const g = startWithBots(room);
      runUntil(room, () => g.s.day === 1 && g.s.phase.kind === 'speech', 3600_000, 500);
      mgr.writeNow(room);
      room.dispose();
      const mgr2 = new RoomManager({ dataDir, dur: () => 1.2, scale: 1, testHooks: true });
      expect(mgr2.loadAll()).toBe(1);
      const room2 = mgr2.get(room.id)!;
      expect(room2.data.seats.every(isBotId)).toBe(true);
      runUntil(room2, () => ended(room2), 6 * 3600_000, 5000);
      room2.dispose();
      mgr2.flushAll();
      expect(logs).toEqual([]);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
