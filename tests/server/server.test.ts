import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { DEFAULT_RULES, type GameConfig } from '../../shared/config.ts';
import type { ClientMsg, GameAction, Prompt, RoomView, ServerMsg } from '../../shared/types.ts';
import { startServer } from '../../server/index.ts';

type Srv = Awaited<ReturnType<typeof startServer>>;

class Client {
  ws!: WebSocket;
  view: RoomView | null = null;
  errors: string[] = [];
  private listeners = new Set<() => void>();
  id: string;
  constructor(id: string) {
    this.id = id;
  }

  static async connect(port: number, room: string, id: string, name: string, ownerKey?: string): Promise<Client> {
    const c = new Client(id);
    await c.open(port, room, name, ownerKey);
    return c;
  }

  open(port: number, room: string, name: string, ownerKey?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { origin: `http://127.0.0.1:${port}` } });
      this.ws.on('open', () => {
        this.send({ t: 'hello', room, client: this.id, name, ownerKey });
      });
      this.ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as ServerMsg;
        if (msg.t === 'state') {
          this.view = msg.view;
          resolve();
        } else if (msg.t === 'error') this.errors.push(msg.message);
        for (const l of this.listeners) l();
      });
      this.ws.on('error', reject);
    });
  }

  send(m: ClientMsg): void {
    this.ws.send(JSON.stringify(m));
  }

  act(a: GameAction): void {
    this.send({ t: 'act', action: a });
  }

  waitFor(pred: (v: RoomView) => boolean, ms = 8000): Promise<RoomView> {
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
        reject(new Error(`timeout; phase=${JSON.stringify(this.view?.game?.phase)} errors=${this.errors.join('|')}`));
      }, ms);
      this.listeners.add(check);
      check();
    });
  }

  close(): Promise<void> {
    return new Promise((r) => {
      this.ws.once('close', () => r());
      this.ws.close();
    });
  }
}

async function post(port: number, url: string, body: unknown) {
  const r = await fetch(`http://127.0.0.1:${port}${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as any };
}

const CFG: GameConfig = {
  boardName: '测试局',
  roles: { seer: 1, witch: 1, wolf: 2, villager: 2 },
  rules: { ...DEFAULT_RULES, sheriff: true },
};

const ids = Array.from({ length: 6 }, (_, i) => `client-${i}-xxxxxxxxxxxxxxxx`);

/** a simple bot reacting to its own prompt */
function botAction(p: Prompt, seat: number, v: RoomView): GameAction | null {
  switch (p.kind) {
    case 'pick':
      if (p.submitted) return null;
      return { type: 'pick', step: p.step, targets: p.options.length ? [p.options[0]] : [] };
    case 'wolves': {
      if (p.myConfirmed || p.locked) return null;
      const mates = new Set(p.teammates.map((t) => t.seat).concat(seat));
      const t = p.options.find((x) => !mates.has(x)) ?? null;
      return { type: 'wolfPick', target: t, confirm: true };
    }
    case 'witch':
      return p.submitted ? null : { type: 'witch', save: null, poison: null };
    case 'status':
      return p.acked ? null : { type: 'ack', step: p.step };
    case 'signup':
      return p.joined === null ? { type: 'signup', join: seat <= 2 } : null;
    case 'vote': {
      if (p.myVote !== undefined) return null;
      // vote for the lowest-numbered candidate that is not me
      return { type: 'vote', target: p.candidates[0] ?? null };
    }
    case 'deathSkill':
      if (p.done) return null;
      if (p.mask) return { type: 'mask', use: false };
      if (p.badge && !p.badgeDone) return { type: 'badge', target: p.badgeOptions[0] ?? null };
      if (p.canShoot && p.shot === undefined) return { type: 'shoot', target: null };
      return { type: 'skillDone' };
    case 'orderChoice':
      return { type: 'order', dir: 'cw' };
    default:
      void v;
      return null;
  }
}

describe('server', () => {
  let srv: Srv;
  let dataDir: string;
  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wwd-'));
    srv = await startServer({ port: 0, host: '127.0.0.1', dataDir, staticDir: null, quiet: true, timeScale: 0.02 });
  });
  afterAll(async () => {
    await srv.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('rejects bad room configs and ids', async () => {
    expect((await post(srv.port, '/api/rooms', { clientId: 'short', config: CFG })).status).toBe(400);
    const bad = await post(srv.port, '/api/rooms', { clientId: ids[0], config: { ...CFG, roles: { villager: 5 } } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toContain('狼');
    const r = await fetch(`http://127.0.0.1:${srv.port}/api/rooms/nope`);
    expect(r.status).toBe(404);
  });

  it('plays a full game over websockets with private views', async () => {
    const created = await post(srv.port, '/api/rooms', { clientId: ids[0], config: CFG, name: '房主' });
    expect(created.status).toBe(200);
    const room = created.body.roomId as string;
    const clients: Client[] = [];
    for (let i = 0; i < 6; i++) clients.push(await Client.connect(srv.port, room, ids[i], `玩家${i + 1}`));
    expect(clients[0].view?.you.owner).toBe(true);
    expect(clients[1].view?.you.owner).toBe(false);
    expect(clients[1].view?.ownerKey).toBe(null);
    // everyone sits
    for (let i = 0; i < 6; i++) clients[i].send({ t: 'sit', seat: i + 1 });
    await clients[0].waitFor((v) => v.seats.every((s) => s.occupied));
    // a non-owner cannot deal
    clients[3].send({ t: 'owner', cmd: { type: 'deal' } });
    await new Promise((r) => setTimeout(r, 100));
    expect(clients[3].errors).toContain('只有房主可以这样做');
    clients[0].send({ t: 'owner', cmd: { type: 'deal' } });
    const views = await Promise.all(clients.map((c) => c.waitFor((v) => v.game?.time === 'dealt')));
    const roles = views.map((v) => v.game!.you!.role);
    expect(roles.slice().sort()).toEqual(['seer', 'villager', 'villager', 'witch', 'wolf', 'wolf']);
    for (let i = 0; i < 6; i++) {
      const v = views[i];
      expect(v.game!.you!.seat).toBe(i + 1);
      expect(v.seats.every((s) => s.revealed === null)).toBe(true);
      // nobody's private view mentions another player's role unless they are wolf teammates
      if (roles[i] !== 'wolf') expect(v.game!.you!.teammates).toEqual([]);
    }
    const wolfIdx = roles.indexOf('wolf');
    const mateIdx = roles.lastIndexOf('wolf');
    expect(views[wolfIdx].game!.you!.teammates.map((t) => t.seat)).toEqual([mateIdx + 1]);

    // reconnect keeps the seat and the role
    await clients[4].close();
    clients[4] = await Client.connect(srv.port, room, ids[4], '玩家5');
    expect(clients[4].view?.you.seat).toBe(5);
    expect(clients[4].view?.game?.you?.role).toBe(roles[4]);

    // bots react to every state
    const stop = { v: false };
    for (const [i, c] of clients.entries()) {
      const handler = () => {
        if (stop.v) return;
        const v = c.view;
        const g = v?.game;
        if (!g || !g.you) return;
        const ph = g.phase;
        if (ph.kind === 'speech' && ph.order[ph.idx] === i + 1) {
          const key = `${g.day}-${ph.context}-${ph.idx}`;
          if ((c as any).lastSpeech !== key) {
            (c as any).lastSpeech = key;
            c.act({ type: 'endSpeech' });
          }
          return;
        }
        const p = g.you.prompt;
        if (!p) return;
        const a = botAction(p, i + 1, v!);
        const key = JSON.stringify([g.day, g.night, ph.kind, (ph as any).step ?? (ph as any).context ?? '', a]);
        if (a && (c as any).lastAct !== key) {
          (c as any).lastAct = key;
          c.act(a);
        }
      };
      (c as any).listeners.add(handler);
    }
    clients[0].send({ t: 'owner', cmd: { type: 'start' } });
    const end = await clients[2].waitFor((v) => v.game?.time === 'ended', 60000);
    stop.v = true;
    const res = end.game!.result!;
    expect(['good', 'wolf', 'draw']).toContain(res.winner);
    expect(res.players.map((p) => p.role).sort()).toEqual(roles.slice().sort());
    expect(end.seats.every((s) => s.revealed !== null)).toBe(true);
    expect(end.game!.history.length).toBeGreaterThan(0);
    // everyone saw the same public announcements
    const ann = end.game!.announcements.map((a) => a.id);
    expect(ann.length).toBeGreaterThan(0);

    // restart deals a new game on the same seats
    clients[0].send({ t: 'owner', cmd: { type: 'restart' } });
    const re = await clients[0].waitFor((v) => v.game?.gameNo === 2 && v.game.time === 'dealt');
    expect(re.seats.every((s) => s.occupied)).toBe(true);

    // reconfigure back to the lobby with a bigger board keeps seats 1-6
    clients[0].send({
      t: 'owner',
      cmd: { type: 'reconfigure', config: { ...CFG, roles: { ...CFG.roles, villager: 3 } } },
    });
    const lobby = await clients[0].waitFor((v) => v.status === 'lobby' && v.playerCount === 7);
    expect(lobby.seats.filter((s) => s.occupied).length).toBe(6);
    for (const c of clients) await c.close();
  }, 90000);

  it('owner can release a seat during a game for someone else to claim', async () => {
    const created = await post(srv.port, '/api/rooms', { clientId: ids[0], config: CFG, name: '房主' });
    const room = created.body.roomId as string;
    const clients: Client[] = [];
    for (let i = 0; i < 6; i++) clients.push(await Client.connect(srv.port, room, ids[i], `p${i}`));
    for (let i = 0; i < 6; i++) clients[i].send({ t: 'sit', seat: i + 1 });
    await clients[0].waitFor((v) => v.seats.every((s) => s.occupied));
    clients[0].send({ t: 'owner', cmd: { type: 'deal' } });
    const v3 = await clients[3].waitFor((v) => v.game?.time === 'dealt');
    const role3 = v3.game!.you!.role;
    // a newcomer cannot take seat 4 until it is released
    const newcomer = await Client.connect(srv.port, room, 'newcomer-device-xxxxxxxx', '新设备');
    newcomer.send({ t: 'sit', seat: 4 });
    await new Promise((r) => setTimeout(r, 100));
    expect(newcomer.errors).toContain('游戏进行中，不能更换座位');
    clients[0].send({ t: 'owner', cmd: { type: 'kick', seat: 4 } });
    await newcomer.waitFor((v) => v.seats[3].claimable);
    newcomer.send({ t: 'sit', seat: 4 });
    const nv = await newcomer.waitFor((v) => v.you.seat === 4);
    expect(nv.game!.you!.role).toBe(role3);
    const old = await clients[3].waitFor((v) => v.you.seat === null);
    expect(old.game!.you).toBe(null);
    for (const c of [...clients, newcomer]) await c.close();
  });

  it('owner link grants ownership on another device', async () => {
    const created = await post(srv.port, '/api/rooms', { clientId: ids[0], config: CFG, name: '房主' });
    const room = created.body.roomId as string;
    const other = await Client.connect(srv.port, room, 'second-device-xxxxxxxxxx', '平板', created.body.ownerKey);
    expect(other.view?.you.owner).toBe(true);
    const stranger = await Client.connect(srv.port, room, 'stranger-device-xxxxxxxx', '路人', 'wrongkey');
    expect(stranger.view?.you.owner).toBe(false);
    await other.close();
    await stranger.close();
  });

  it('restores rooms and games after a restart', async () => {
    const created = await post(srv.port, '/api/rooms', { clientId: ids[0], config: CFG, name: '房主' });
    const room = created.body.roomId as string;
    const clients: Client[] = [];
    for (let i = 0; i < 6; i++) clients.push(await Client.connect(srv.port, room, ids[i], `p${i}`));
    for (let i = 0; i < 6; i++) clients[i].send({ t: 'sit', seat: i + 1 });
    await clients[0].waitFor((v) => v.seats.every((s) => s.occupied));
    clients[0].send({ t: 'owner', cmd: { type: 'deal' } });
    const before = await clients[2].waitFor((v) => v.game?.time === 'dealt');
    for (const c of clients) await c.close();
    await srv.close();
    srv = await startServer({ port: 0, host: '127.0.0.1', dataDir, staticDir: null, quiet: true, timeScale: 0.02 });
    const again = await Client.connect(srv.port, room, ids[2], 'p2');
    expect(again.view?.you.seat).toBe(3);
    expect(again.view?.game?.you?.role).toBe(before.game!.you!.role);
    await again.close();
  });

  it('rejects websocket upgrades from foreign origins', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`, { headers: { origin: 'https://evil.example' } });
    const outcome = await new Promise<string>((r) => {
      ws.on('open', () => r('open'));
      ws.on('error', () => r('error'));
      ws.on('close', () => r('closed'));
    });
    expect(outcome).not.toBe('open');
  });
});
