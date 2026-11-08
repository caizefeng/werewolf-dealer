// Rooms: lobby (seats, names, owners), the running game, timers, persistence
// and per-client view projection.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { playerCountOf, validateConfig, type GameConfig } from '../shared/config.ts';
import { mechSkillFor, ROLES, type RoleId } from '../shared/roles.ts';
import type { GameAction, GameView, OwnerCommand, PrivateView, RoomView, SeatView } from '../shared/types.ts';
import { Game, nightStepNames, type ClipDurations } from './game/engine.ts';
import { randomSeed } from './game/rng.ts';
import type { GameState } from './game/state.ts';

export interface Conn {
  clientId: string | null;
  roomId: string | null;
  send(data: string): void;
  lastSent: string | null;
}

export interface RoomData {
  id: string;
  createdAt: number;
  touchedAt: number;
  ownerKey: string;
  owners: string[];
  config: GameConfig;
  seats: (string | null)[];
  names: Record<string, string>;
  claimable: number[];
  status: 'lobby' | 'game';
  game: GameState | null;
  gameNo: number;
  savedAt?: number;
}

const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function newId(len: number): string {
  const bytes = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return s;
}

// control chars, zero-width chars, bidi overrides
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001f\\u007f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069]', 'g');

export function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // strip control chars and collapse whitespace
  return raw
    .replace(CONTROL_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12);
}

export class Room {
  data: RoomData;
  game: Game | null = null;
  conns = new Set<Conn>();
  timer: ReturnType<typeof setTimeout> | null = null;
  private mgr: RoomManager;

  constructor(data: RoomData, mgr: RoomManager) {
    this.data = data;
    this.mgr = mgr;
    if (data.game) {
      this.game = new Game(data.game, mgr.dur);
      this.game.scale = mgr.scale;
    }
  }

  get id(): string {
    return this.data.id;
  }

  seatOf(clientId: string): number | null {
    const i = this.data.seats.indexOf(clientId);
    return i >= 0 ? i + 1 : null;
  }

  isOwner(clientId: string): boolean {
    return this.data.owners.includes(clientId);
  }

  // ── lobby operations ──

  hello(clientId: string, name: string | undefined, ownerKey: string | undefined): void {
    if (ownerKey && ownerKey === this.data.ownerKey && !this.isOwner(clientId)) this.data.owners.push(clientId);
    const n = cleanName(name);
    if (n) this.data.names[clientId] = n;
  }

  sit(clientId: string, seat: number): string | null {
    const d = this.data;
    if (!Number.isInteger(seat) || seat < 1 || seat > d.seats.length) return '座位无效';
    if (!d.names[clientId]) return '请先设置昵称';
    const occupant = d.seats[seat - 1];
    if (d.status === 'lobby') {
      if (occupant && occupant !== clientId) return '这个座位已经有人了';
      const cur = this.seatOf(clientId);
      if (cur) d.seats[cur - 1] = null;
      d.seats[seat - 1] = clientId;
      return null;
    }
    // during a game only seats released by the owner can be claimed
    if (!d.claimable.includes(seat)) return '游戏进行中，不能更换座位';
    if (this.seatOf(clientId)) return '你已经有座位了';
    d.seats[seat - 1] = clientId;
    d.claimable = d.claimable.filter((x) => x !== seat);
    return null;
  }

  stand(clientId: string): string | null {
    if (this.data.status !== 'lobby') return '游戏进行中，不能离开座位';
    const cur = this.seatOf(clientId);
    if (cur) this.data.seats[cur - 1] = null;
    return null;
  }

  rename(clientId: string, name: string): string | null {
    const n = cleanName(name);
    if (!n) return '昵称不能为空';
    this.data.names[clientId] = n;
    return null;
  }

  act(clientId: string, action: GameAction, now: number): string | null {
    if (!this.game) return '游戏还没有开始';
    const seat = this.seatOf(clientId);
    if (!seat) return '你没有座位';
    return this.game.act(seat, action, now);
  }

  owner(clientId: string, cmd: OwnerCommand, now: number): string | null {
    if (!this.isOwner(clientId)) return '只有房主可以这样做';
    const d = this.data;
    switch (cmd.type) {
      case 'deal': {
        if (d.status !== 'lobby') return '游戏已经开始';
        if (d.seats.some((s) => !s)) return '还有空座位，所有座位坐满后才能发牌';
        this.newGame();
        return null;
      }
      case 'restart': {
        if (d.seats.some((s) => !s)) return '还有空座位，所有座位坐满后才能发牌';
        d.claimable = [];
        this.newGame();
        return null;
      }
      case 'reconfigure': {
        const err = validateConfig(cmd.config);
        if (err) return err;
        d.config = cmd.config;
        const n = playerCountOf(cmd.config.roles);
        const seats = d.seats.slice(0, n);
        while (seats.length < n) seats.push(null);
        d.seats = seats;
        d.claimable = [];
        d.status = 'lobby';
        d.game = null;
        this.game = null;
        return null;
      }
      case 'abort': {
        d.status = 'lobby';
        d.game = null;
        this.game = null;
        d.claimable = [];
        return null;
      }
      case 'kick': {
        const seat = cmd.seat;
        if (!Number.isInteger(seat) || seat < 1 || seat > d.seats.length) return '座位无效';
        if (d.status === 'lobby') {
          d.seats[seat - 1] = null;
        } else {
          d.seats[seat - 1] = null;
          if (!d.claimable.includes(seat)) d.claimable.push(seat);
        }
        return null;
      }
      case 'debugDeal': {
        if (!this.mgr.testHooks) return '未知指令';
        const seats = cmd.seats as RoleId[];
        if (!Array.isArray(seats) || seats.length !== d.seats.length || seats.some((r) => !(r in ROLES)))
          return '座位身份无效';
        const buried = (cmd.buried ?? null) as RoleId[] | null;
        const roles: Partial<Record<RoleId, number>> = {};
        for (const r of [...seats, ...(buried ?? [])]) roles[r] = (roles[r] ?? 0) + 1;
        d.config = { ...d.config, roles };
        d.gameNo += 1;
        this.game = Game.fromSeats(d.config, seats, buried, randomSeed(), this.mgr.dur);
        this.game.s.gameNo = d.gameNo;
        this.game.scale = this.mgr.scale;
        d.game = this.game.s;
        d.status = 'game';
        return null;
      }
      default: {
        if (!this.game) return '游戏还没有开始';
        return this.game.ownerCmd(cmd, now);
      }
    }
  }

  private newGame(): void {
    const d = this.data;
    d.gameNo += 1;
    this.game = Game.create(d.config, randomSeed(), d.gameNo, this.mgr.dur);
    this.game.scale = this.mgr.scale;
    d.game = this.game.s;
    d.status = 'game';
  }

  // ── scheduling ──

  tick(now: number): void {
    if (this.game) this.game.tick(now);
  }

  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const w = this.game?.nextWakeup();
    if (w == null) return;
    const delay = Math.max(0, w - Date.now()) + 5;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.tick(Date.now());
      this.changed();
    }, Math.min(delay, 2_000_000_000));
  }

  /** after any mutation: reschedule, persist, push views */
  changed(): void {
    this.data.touchedAt = Date.now();
    this.schedule();
    this.mgr.save(this);
    this.broadcast();
  }

  broadcast(): void {
    for (const c of this.conns) this.push(c);
  }

  push(c: Conn, force = false): void {
    if (!c.clientId) return;
    const view = this.view(c.clientId, Date.now());
    // compare without the timestamp so idle clients are not spammed
    const key = JSON.stringify({ ...view, now: 0 });
    if (!force && key === c.lastSent) return;
    c.lastSent = key;
    c.send(JSON.stringify({ t: 'state', view }));
  }

  // ── views ──

  connected(clientId: string): boolean {
    for (const c of this.conns) if (c.clientId === clientId) return true;
    return false;
  }

  view(clientId: string, now: number): RoomView {
    const d = this.data;
    const g = this.game;
    const mySeat = this.seatOf(clientId);
    const owner = this.isOwner(clientId);
    const seats: SeatView[] = d.seats.map((cid, i) => {
      const seat = i + 1;
      const pub = g ? g.publicSeatInfo(seat) : null;
      return {
        seat,
        name: cid ? (d.names[cid] ?? null) : null,
        occupied: !!cid,
        connected: cid ? this.connected(cid) : false,
        owner: cid ? this.isOwner(cid) : false,
        alive: pub ? pub.alive : true,
        sheriff: g ? g.s.sheriff === seat : false,
        revealed: pub ? pub.revealed : null,
        deadNote: pub ? pub.deadNote : null,
        viewedRole: g ? g.p(seat).viewed : false,
        claimable: d.claimable.includes(seat),
      };
    });
    return {
      roomId: d.id,
      now,
      you: { name: d.names[clientId] ?? '', seat: mySeat, owner },
      config: d.config,
      playerCount: d.seats.length,
      seats,
      status: d.status,
      game: g ? this.gameView(g, mySeat) : null,
      ownerKey: owner ? d.ownerKey : null,
    };
  }

  private gameView(g: Game, seat: number | null): GameView {
    const s = g.s;
    const ph = s.phase;
    const time: GameView['time'] =
      ph.kind === 'dealt' ? 'dealt' : ph.kind === 'ended' ? 'ended' : ph.kind === 'night' ? 'night' : 'day';
    return {
      gameNo: s.gameNo,
      day: s.day,
      night: s.night,
      time,
      phase: g.phaseView(),
      banner: g.banner(),
      deadline: ph.kind === 'night' ? null : g.deadline(),
      paused: !!s.paused,
      sheriff: s.sheriff,
      badgeLost: s.badgeLost,
      announcements: s.announcements.slice(-12),
      history: s.history,
      you: seat ? this.privateView(g, seat) : null,
      result: g.result((x) => {
        const cid = this.data.seats[x - 1];
        return cid ? (this.data.names[cid] ?? null) : null;
      }),
      nightSteps: nightStepNames(s.config),
    };
  }

  private privateView(g: Game, seat: number): PrivateView {
    const pl = g.p(seat);
    const prompt = g.promptFor(seat);
    const teammates = ROLES[pl.role].pack
      ? g
          .packSeats(false)
          .filter((x) => x !== seat)
          .map((x) => ({ seat: x, role: g.p(x).role, alive: g.p(x).alive }))
      : [];
    return {
      seat,
      role: pl.role,
      faction: g.factionOf(pl),
      countsAs: g.countsAs(pl),
      info: g.privateInfo(seat),
      teammates,
      checks: pl.checks.slice(),
      treasureCards: pl.treasure ? pl.treasure.cards.slice() : null,
      mech: pl.mech
        ? {
            learned: pl.mech.learned,
            from: pl.mech.from,
            skill: pl.mech.learned ? mechSkillFor(pl.mech.learned) : 'none',
          }
        : null,
      prompt,
      deadline: g.s.phase.kind === 'night' && prompt && prompt.kind !== 'status' ? g.deadline() : null,
      skills: g.skillView(seat),
      alive: pl.alive,
    };
  }

  serialize(): RoomData {
    return { ...this.data, game: this.game ? this.game.s : null, savedAt: Date.now() };
  }
}

export class RoomManager {
  rooms = new Map<string, Room>();
  dur: ClipDurations;
  dataDir: string | null;
  scale: number;
  testHooks: boolean;
  private saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  maxRooms = 2000;
  /** rooms idle for this long are deleted */
  ttlMs = 48 * 3600 * 1000;

  constructor(opts: { dataDir: string | null; dur: ClipDurations; scale?: number; testHooks?: boolean }) {
    this.dataDir = opts.dataDir;
    this.dur = opts.dur;
    this.scale = opts.scale ?? 1;
    this.testHooks = !!opts.testHooks;
    if (this.dataDir) fs.mkdirSync(path.join(this.dataDir, 'rooms'), { recursive: true });
  }

  create(config: GameConfig, clientId: string, name: string): Room | string {
    const err = validateConfig(config);
    if (err) return err;
    if (this.rooms.size >= this.maxRooms) this.expire(Date.now(), true);
    if (this.rooms.size >= this.maxRooms) return '服务器房间已满，请稍后再试';
    let id = newId(8);
    while (this.rooms.has(id)) id = newId(8);
    const now = Date.now();
    const n = playerCountOf(config.roles);
    const data: RoomData = {
      id,
      createdAt: now,
      touchedAt: now,
      ownerKey: newId(20),
      owners: [clientId],
      config,
      seats: Array.from({ length: n }, () => null),
      names: {},
      claimable: [],
      status: 'lobby',
      game: null,
      gameNo: 0,
    };
    const nm = cleanName(name);
    if (nm) data.names[clientId] = nm;
    const room = new Room(data, this);
    this.rooms.set(id, room);
    this.save(room);
    return room;
  }

  get(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  save(room: Room): void {
    if (!this.dataDir) return;
    if (this.saveTimers.has(room.id)) return;
    this.saveTimers.set(
      room.id,
      setTimeout(() => {
        this.saveTimers.delete(room.id);
        this.writeNow(room);
      }, 500),
    );
  }

  writeNow(room: Room): void {
    if (!this.dataDir) return;
    const file = path.join(this.dataDir, 'rooms', `${room.id}.json`);
    const tmp = `${file}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(room.serialize()));
      fs.renameSync(tmp, file);
    } catch (e) {
      console.error('save failed', room.id, e);
    }
  }

  flushAll(): void {
    for (const [id, t] of this.saveTimers) {
      clearTimeout(t);
      const room = this.rooms.get(id);
      if (room) this.writeNow(room);
    }
    this.saveTimers.clear();
  }

  loadAll(): number {
    if (!this.dataDir) return 0;
    const dir = path.join(this.dataDir, 'rooms');
    let n = 0;
    const now = Date.now();
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as RoomData;
        if (!data.id || now - data.touchedAt > this.ttlMs) {
          fs.rmSync(path.join(dir, f), { force: true });
          continue;
        }
        const room = new Room(data, this);
        if (room.game && data.savedAt) room.game.resumeAfterDowntime(now - data.savedAt);
        this.rooms.set(data.id, room);
        room.schedule();
        n++;
      } catch (e) {
        console.error('failed to load room', f, e);
      }
    }
    return n;
  }

  expire(now: number, aggressive = false): void {
    const ttl = aggressive ? 6 * 3600 * 1000 : this.ttlMs;
    for (const [id, room] of this.rooms) {
      if (room.conns.size > 0) continue;
      if (now - room.data.touchedAt < ttl) continue;
      if (room.timer) clearTimeout(room.timer);
      this.rooms.delete(id);
      if (this.dataDir) fs.rmSync(path.join(this.dataDir, 'rooms', `${id}.json`), { force: true });
    }
  }
}
