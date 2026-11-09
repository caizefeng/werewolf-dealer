// Load test: simulated rooms full of phones against a running instance, through its public URL.
//
// Each simulated phone loads the page the way a browser does (HTML, script, styles, font, background,
// icons; the owner's phone also preloads every voice clip), keeps a WebSocket open and plays its seat
// with the decision code of the built-in bots (server/bots.ts) at human speed: a few seconds per decision
// and a speech of a few seconds (much shorter than real ones, so the server gets more traffic than a
// real game makes). Phones drop and reconnect now and then (screen lock). Rooms deal, play and deal
// again until the time is up. --bots puts built-in bots on some seats; --bot-rooms adds rooms played
// only by built-in bots, watched by their owner.
//
// Every 10 s it prints the WebSocket round trip (ping → pong through the proxy, i.e. how quickly the
// server answers), the delay from an action to the state update that answers it, HTTP times, traffic,
// errors and game progress; a summary follows at the end (also written as JSON with --out).
//
//   node scripts/loadtest.ts <base-url> [--rooms 4] [--humans 12] [--bots 0] [--bot-rooms 0]
//       [--minutes 5] [--speech 8] [--churn 0.15] [--rooms-file <path>] [--out <file.json>] [--cleanup]
//
// An instance lets one IP create 30 rooms per hour, so rooms are kept in --rooms-file (default: in the
// temp dir) and reused by later runs. --cleanup ends the games in those rooms and empties their seats.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { allClips } from '../shared/audio.ts';
import { presetConfig } from '../shared/config.ts';
import type { ClientMsg, GameAction, OwnerCommand, RoomView, ServerMsg } from '../shared/types.ts';
import { botMove } from '../server/bots.ts';

// ── options ──
const argv = process.argv.slice(2);
const base = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'))?.replace(/\/$/, '');
if (!base) {
  console.error('usage: node scripts/loadtest.ts <base-url> [--rooms 4] [--humans 12] [--bots 0] [--bot-rooms 0] [--minutes 5] …');
  process.exit(2);
}
const str = (name: string, def: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const num = (name: string, def: number) => Number(str(name, String(def)));
const ROOMS = num('rooms', 4);
const HUMANS = num('humans', 12);
const BOTS = num('bots', 0);
const BOT_ROOMS = num('bot-rooms', 0);
const MINUTES = num('minutes', 5);
const SPEECH = num('speech', 8);
const CHURN = num('churn', 0.15); // chance per phone per minute of a screen-lock reconnect
const CLEANUP = argv.includes('--cleanup');
const OUT = str('out', '');
const host = new URL(base).host;
const ROOMS_FILE = str('rooms-file', path.join(os.tmpdir(), `wwd-loadtest-rooms-${host.replace(/[^a-z0-9.-]/gi, '_')}.json`));
const WS_URL = `${base.replace(/^http/, 'ws')}/ws`;
const BOARDS = ['ynlb', 'ynls', 'jxl', 'dbds', 'lmqs', 'jmwh', 'gszj', 'lnh', 'ynlbh', 'lwsw', 'mhdj', 'blwsw'];
const SEATS = 12; // every board above seats 12

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const newId = (tag: string) => `lt-${tag}-${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 8)}`;

// ── measurements ──
class Samples {
  all: number[] = [];
  win: number[] = [];
  add(v: number): void {
    this.all.push(v);
    this.win.push(v);
  }
  take(): number[] {
    const w = this.win;
    this.win = [];
    return w;
  }
}
function q(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}
const fmt = (x: number) => (Number.isNaN(x) ? '–' : String(Math.round(x)));
const rtt = new Samples();
const actLag = new Samples();
const httpLag = new Samples();
const health = new Samples();
const pageLoad = new Samples();
const stateSize = new Samples();
const counts = { msgs: 0, bytes: 0, httpBytes: 0, httpFail: 0, closes: 0, reconnects: 0, gamesStarted: 0, gamesEnded: 0, maxDay: 0 };
const errors = new Map<string, number>();
const countError = (m: string) => errors.set(m, (errors.get(m) ?? 0) + 1);
const series: Record<string, number | string>[] = [];

async function get(url: string): Promise<{ ok: boolean; text: string }> {
  const t = performance.now();
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'wwd-loadtest' } });
    const buf = Buffer.from(await r.arrayBuffer());
    httpLag.add(performance.now() - t);
    counts.httpBytes += buf.length;
    if (!r.ok) counts.httpFail++;
    return { ok: r.ok, text: buf.toString('utf8') };
  } catch {
    counts.httpFail++;
    return { ok: false, text: '' };
  }
}

/** what a phone downloads when it opens the room link (owner: plus every voice clip, 6 at a time) */
async function loadPage(roomId: string, owner: boolean): Promise<void> {
  const t = performance.now();
  const html = await get(`${base}/r/${roomId}`);
  const assets = [...html.text.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  const css = assets.filter((a) => a.endsWith('.css'));
  await Promise.all([...assets, '/fonts/cinzel-700.woff2', '/manifest.webmanifest', '/favicon-32x32.png'].map((a) => get(`${base}${a}`)));
  pageLoad.add(performance.now() - t);
  if (css.length) await get(`${base}/background-sm.jpg`);
  if (!owner) return;
  const clips = Object.keys(allClips()).map((id) => `${base}/audio/${id}.mp3`);
  for (let i = 0; i < clips.length; i += 6) await Promise.all(clips.slice(i, i + 6).map(get));
}

// ── phones ──
interface RoomRec {
  roomId: string;
  ownerKey: string;
  board: string;
  ids: string[]; // client ids for seats 1..12 (ids[0] is the owner)
}

let stopping = false;

class Phone {
  ws: WebSocket | null = null;
  view: RoomView | null = null;
  private pendingActs: number[] = [];
  private pings: number[] = [];
  private plan: { key: string; timer: ReturnType<typeof setTimeout> } | null = null;
  private done = new Set<string>();
  private listeners = new Set<() => void>();
  private churning = false;
  private sitSent = 0;
  quit = false;
  readonly room: SimRoom;
  readonly id: string;
  readonly seat: number | null;
  readonly name: string;
  readonly owner: boolean;
  private salt = Math.random().toString(36);

  constructor(room: SimRoom, id: string, seat: number | null, name: string, owner: boolean) {
    this.room = room;
    this.id = id;
    this.seat = seat;
    this.name = name;
    this.owner = owner;
  }

  open(): Promise<void> {
    return new Promise((resolve) => {
      const ws = new WebSocket(WS_URL, { headers: { origin: base! } });
      this.ws = ws;
      let first = true;
      ws.on('open', () =>
        this.send({ t: 'hello', room: this.room.rec.roomId, client: this.id, name: this.name, ownerKey: this.owner ? this.room.rec.ownerKey : undefined }),
      );
      ws.on('message', (raw: Buffer) => {
        const now = performance.now();
        counts.msgs++;
        counts.bytes += raw.length;
        let m: ServerMsg;
        try {
          m = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (m.t === 'pong') {
          const s = this.pings.shift();
          if (s != null) rtt.add(now - s);
          return;
        }
        if (m.t === 'error') {
          countError(m.message);
          return;
        }
        if (m.t !== 'state') return;
        stateSize.add(raw.length);
        for (const s of this.pendingActs) actLag.add(now - s);
        this.pendingActs = [];
        this.view = m.view;
        if (m.view.game) counts.maxDay = Math.max(counts.maxDay, m.view.game.day);
        if (first) {
          first = false;
          resolve();
        }
        for (const l of [...this.listeners]) l();
        this.react();
      });
      ws.on('close', () => {
        if (this.ws !== ws) return;
        this.ws = null;
        this.pings = [];
        this.pendingActs = [];
        this.cancel();
        resolve();
        if (this.quit) return;
        if (this.churning) {
          this.churning = false;
          counts.reconnects++;
          setTimeout(() => void this.open(), rand(2000, 8000));
        } else {
          counts.closes++;
          setTimeout(() => void this.open(), rand(500, 2000));
        }
      });
      ws.on('error', () => {});
    });
  }

  send(m: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  ping(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.pings.push(performance.now());
    this.send({ t: 'ping' });
  }

  ownerCmd(cmd: OwnerCommand): void {
    this.send({ t: 'owner', cmd });
  }

  /** a screen lock: the socket drops and the phone reconnects a few seconds later */
  lockScreen(): void {
    if (!this.ws || this.quit) return;
    this.churning = true;
    this.ws.close();
  }

  waitFor(pred: (v: RoomView) => boolean, ms = 60_000): Promise<boolean> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.view && pred(this.view)) {
          this.listeners.delete(check);
          clearTimeout(t);
          resolve(true);
        }
      };
      const t = setTimeout(() => {
        this.listeners.delete(check);
        resolve(false);
      }, ms);
      this.listeners.add(check);
      check();
    });
  }

  private cancel(): void {
    if (this.plan) clearTimeout(this.plan.timer);
    this.plan = null;
  }

  /** a person at human speed: same decisions as the built-in bots */
  private react(): void {
    const v = this.view;
    if (!v || this.quit || stopping || this.seat == null) return;
    if (!v.game) {
      if (v.you.seat !== this.seat && Date.now() - this.sitSent > 3000) {
        this.sitSent = Date.now();
        this.send({ t: 'sit', seat: this.seat });
      }
      return;
    }
    const m = botMove(v, this.salt);
    if (!m || this.done.has(m.key)) {
      if (!m) this.cancel();
      return;
    }
    if (this.plan?.key === m.key) return;
    this.cancel();
    const secs = m.action.type === 'endSpeech' ? SPEECH * rand(0.5, 1.5) : m.think;
    const timer = setTimeout(() => {
      this.plan = null;
      const again = this.view && botMove(this.view, this.salt);
      if (!again || again.key !== m.key) return this.react();
      this.done.add(m.key);
      this.act(again.action);
    }, secs * 1000);
    this.plan = { key: m.key, timer };
  }

  private act(a: GameAction): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.pendingActs.push(performance.now());
    this.send({ t: 'act', action: a });
  }

  close(): void {
    this.quit = true;
    this.cancel();
    this.ws?.close();
  }
}

// ── rooms ──
class SimRoom {
  rec: RoomRec;
  botRoom: boolean;
  phones: Phone[] = [];
  owner!: Phone;
  constructor(rec: RoomRec, botRoom: boolean) {
    this.rec = rec;
    this.botRoom = botRoom;
  }

  async run(stagger: number): Promise<void> {
    await sleep(stagger);
    // the owner opens the room first (and preloads the voice clips after the first tap)
    this.owner = new Phone(this, this.rec.ids[0], this.botRoom ? null : 1, '房主', true);
    this.phones.push(this.owner);
    await loadPage(this.rec.roomId, true);
    await this.owner.open();
    const o = this.owner;
    if (o.view!.status === 'game') {
      o.ownerCmd({ type: 'abort' });
      await o.waitFor((v) => v.status === 'lobby', 20_000);
    }
    // seats this run does not use: bots and people from earlier runs leave
    const humans = this.botRoom ? 0 : HUMANS;
    for (const s of o.view!.seats)
      if (s.occupied && (s.seat > humans || (this.botRoom && !s.bot))) o.ownerCmd({ type: 'kick', seat: s.seat });
    if (this.botRoom) o.send({ t: 'stand' });
    // people open the link over ~20 s
    await Promise.all(
      Array.from({ length: Math.max(0, humans - 1) }, async (_, i) => {
        const seat = i + 2;
        await sleep(rand(0, 20_000));
        if (stopping) return;
        await loadPage(this.rec.roomId, false);
        const p = new Phone(this, this.rec.ids[seat - 1], seat, `测试${seat}`, false);
        this.phones.push(p);
        await p.open();
      }),
    );
    if (stopping) return;
    await o.waitFor((v) => v.status === 'game' || v.seats.slice(0, humans).every((s) => s.occupied && !s.bot), 30_000);
    if (BOTS > 0 || this.botRoom) o.ownerCmd({ type: 'addBots' });
    // deal, play, deal again
    while (!stopping) {
      if (!(await o.waitFor((v) => v.status === 'game' || v.seats.every((s) => s.occupied), 30_000))) {
        countError('room not full');
        return;
      }
      if (o.view!.status === 'lobby') o.ownerCmd({ type: 'deal' });
      await o.waitFor((v) => v.game?.time === 'dealt', 20_000);
      await o.waitFor((v) => v.game?.phase.kind === 'dealt' && v.game.phase.viewed >= v.game.phase.total, 30_000);
      await sleep(rand(1000, 3000));
      if (stopping) return;
      o.ownerCmd({ type: 'start' });
      counts.gamesStarted++;
      const gameNo = o.view!.game?.gameNo;
      await o.waitFor((v) => stopping || (v.game?.time === 'ended' && v.game.gameNo === gameNo), MINUTES * 60_000 + 60_000);
      if (stopping) return;
      counts.gamesEnded++;
      await sleep(rand(5000, 10_000));
      if (!stopping) o.ownerCmd({ type: 'restart' });
    }
  }
}

async function loadRooms(n: number): Promise<RoomRec[]> {
  let recs: RoomRec[] = [];
  try {
    recs = JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8'));
  } catch {
    /* none yet */
  }
  // drop rooms that expired on the server
  const alive: RoomRec[] = [];
  for (const r of recs) if ((await get(`${base}/api/rooms/${r.roomId}`)).ok) alive.push(r);
  recs = alive;
  while (recs.length < n) {
    const board = BOARDS[recs.length % BOARDS.length];
    const ids = Array.from({ length: SEATS }, (_, i) => newId(i === 0 ? 'owner' : `p${i + 1}`));
    const r = await fetch(`${base}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base! },
      body: JSON.stringify({ clientId: ids[0], name: '房主', config: presetConfig(board) }),
    });
    const body = (await r.json()) as { roomId?: string; ownerKey?: string; error?: string };
    if (!r.ok || !body.roomId) throw new Error(`creating a room failed: ${r.status} ${body.error ?? ''} (have ${recs.length}, need ${n})`);
    recs.push({ roomId: body.roomId, ownerKey: body.ownerKey!, board, ids });
    fs.writeFileSync(ROOMS_FILE, JSON.stringify(recs, null, 1));
  }
  fs.writeFileSync(ROOMS_FILE, JSON.stringify(recs, null, 1));
  return recs;
}

async function cleanup(recs: RoomRec[]): Promise<void> {
  for (const rec of recs) {
    const room = new SimRoom(rec, false);
    const o = new Phone(room, rec.ids[0], null, '房主', true);
    room.owner = o;
    await o.open();
    if (o.view!.status === 'game') {
      o.ownerCmd({ type: 'abort' });
      await o.waitFor((v) => v.status === 'lobby', 10_000);
    }
    for (const s of o.view!.seats) if (s.occupied) o.ownerCmd({ type: 'kick', seat: s.seat });
    await o.waitFor((v) => v.seats.every((s) => !s.occupied), 10_000);
    o.close();
    console.log(`room ${rec.roomId}: game ended, seats emptied`);
  }
}

async function main(): Promise<void> {
  const recs = await loadRooms(CLEANUP ? 0 : ROOMS + BOT_ROOMS);
  if (CLEANUP) return cleanup(recs);
  const rooms = recs.slice(0, ROOMS + BOT_ROOMS).map((r, i) => new SimRoom(r, i >= ROOMS));
  const people = ROOMS * HUMANS;
  console.log(
    `${base}: ${ROOMS} rooms × ${HUMANS} people${BOTS ? ` (+bots on the other seats)` : ''}, ${BOT_ROOMS} bot-only rooms, ${MINUTES} min; ${people + BOT_ROOMS} phones`,
  );
  const t0 = performance.now();
  const runs = rooms.map((r, i) => r.run(i * 1500));

  // measuring: the owners ping every 2 s, everybody else every 20 s like the app; /api/health every 2 s
  const pingers = setInterval(() => {
    for (const r of rooms) for (const p of r.phones) if (p.owner) p.ping();
  }, 2000);
  const slowPings = setInterval(() => {
    for (const r of rooms) for (const p of r.phones) if (!p.owner) p.ping();
  }, 20_000);
  const healthProbe = setInterval(async () => {
    const t = performance.now();
    const ok = (await get(`${base}/api/health`)).ok;
    if (ok) health.add(performance.now() - t);
  }, 2000);
  const churn = setInterval(() => {
    for (const r of rooms) for (const p of r.phones) if (!p.owner && Math.random() < CHURN) p.lockScreen();
  }, 60_000);
  let lastMsgs = 0;
  let lastBytes = 0;
  const report = setInterval(() => {
    const el = Math.round((performance.now() - t0) / 1000);
    const r = rtt.take();
    const a = actLag.take();
    const h = httpLag.take();
    const hp = health.take();
    const open = rooms.reduce((n, room) => n + room.phones.filter((p) => p.ws?.readyState === WebSocket.OPEN).length, 0);
    const row = {
      t: el,
      at: new Date().toISOString(),
      phones: open,
      msgsPerS: Math.round((counts.msgs - lastMsgs) / 10),
      kbPerS: Math.round((counts.bytes - lastBytes) / 10 / 1024),
      rttP50: q(r, 0.5),
      rttP95: q(r, 0.95),
      rttMax: q(r, 1),
      actP50: q(a, 0.5),
      actP95: q(a, 0.95),
      actMax: q(a, 1),
      httpP95: q(h, 0.95),
      healthP95: q(hp, 0.95),
      games: counts.gamesStarted,
      ended: counts.gamesEnded,
      maxDay: counts.maxDay,
      errors: [...errors.values()].reduce((x, y) => x + y, 0),
      closes: counts.closes,
    };
    series.push(row);
    lastMsgs = counts.msgs;
    lastBytes = counts.bytes;
    console.log(
      `[${String(el).padStart(4)}s] phones ${open} | ${row.msgsPerS} msg/s ${row.kbPerS} KB/s | ws rtt p50 ${fmt(row.rttP50)} p95 ${fmt(row.rttP95)} max ${fmt(row.rttMax)} | act→state p50 ${fmt(row.actP50)} p95 ${fmt(row.actP95)} max ${fmt(row.actMax)} | http p95 ${fmt(row.httpP95)} health p95 ${fmt(row.healthP95)} ms | games ${row.games} ended ${row.ended} day ${row.maxDay} | errors ${row.errors} drops ${row.closes}`,
    );
  }, 10_000);

  await sleep(MINUTES * 60_000);
  stopping = true;
  for (const t of [pingers, slowPings, healthProbe, churn, report]) clearInterval(t);
  // leave every room in the lobby with its seats taken, ready for the next run
  for (const r of rooms) {
    if (r.owner?.view?.status === 'game') r.owner.ownerCmd({ type: 'abort' });
  }
  await sleep(1500);
  for (const r of rooms) for (const p of r.phones) p.close();
  await Promise.race([Promise.all(runs), sleep(5000)]);

  const sum = (s: Samples) => ({ n: s.all.length, p50: q(s.all, 0.5), p95: q(s.all, 0.95), p99: q(s.all, 0.99), max: q(s.all, 1) });
  const summary = {
    base,
    rooms: ROOMS,
    humans: HUMANS,
    bots: BOTS,
    botRooms: BOT_ROOMS,
    minutes: MINUTES,
    wsRttMs: sum(rtt),
    actionToStateMs: sum(actLag),
    healthMs: sum(health),
    httpMs: sum(httpLag),
    pageLoadMs: sum(pageLoad),
    stateBytes: { avg: Math.round(stateSize.all.reduce((a, b) => a + b, 0) / Math.max(1, stateSize.all.length)), p95: q(stateSize.all, 0.95), max: q(stateSize.all, 1) },
    traffic: { wsMessages: counts.msgs, wsMB: +(counts.bytes / 1048576).toFixed(1), httpMB: +(counts.httpBytes / 1048576).toFixed(1) },
    games: { started: counts.gamesStarted, ended: counts.gamesEnded, maxDay: counts.maxDay },
    problems: { httpFailures: counts.httpFail, unexpectedDrops: counts.closes, screenLocks: counts.reconnects, serverErrors: Object.fromEntries(errors) },
    series,
  };
  console.log(JSON.stringify({ ...summary, series: undefined }, null, 1));
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(summary, null, 1));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
