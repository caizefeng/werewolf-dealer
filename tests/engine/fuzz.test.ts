// Random agents play complete games on every preset. They only act through the
// prompts a real client would see, so this also exercises prompt/validation
// consistency (every action derived from a prompt must be accepted).
import { describe, expect, it } from 'vitest';
import { BOARDS, presetConfig, type RuleOptions } from '../../shared/config.ts';
import { ROLES, type RoleId } from '../../shared/roles.ts';
import type { GameAction, Prompt } from '../../shared/types.ts';
import { Game } from '../../server/game/engine.ts';
import { rand, shuffle, type RngHolder } from '../../server/game/rng.ts';

function choose<T>(r: RngHolder, arr: T[]): T {
  return arr[Math.floor(rand(r) * arr.length)];
}

function actionFor(p: Prompt, seat: number, r: RngHolder, g: Game): GameAction | null {
  switch (p.kind) {
    case 'pick': {
      if (p.submitted) return null;
      if (p.options.length === 0 || (p.allowNone && rand(r) < 0.15)) return p.allowNone ? { type: 'pick', step: p.step, targets: [] } : null;
      const t = choose(r, p.options);
      const targets = [t];
      if (p.max === 2 && p.options.length > 1 && rand(r) < 0.7) targets.push(choose(r, p.options.filter((x) => x !== t)));
      return { type: 'pick', step: p.step, targets };
    }
    case 'wolves': {
      if (p.locked) return null;
      // follow the first teammate's pick to converge, or pick a non-wolf
      const mates = p.picks.filter((x) => x.seat !== seat && x.target != null);
      const nonWolves = p.options.filter((x) => ROLES[g.p(x).role].faction !== 'wolf');
      const t = mates.length ? mates[0].target! : nonWolves.length ? choose(r, nonWolves) : null;
      return { type: 'wolfPick', target: t, confirm: true };
    }
    case 'witch': {
      if (p.submitted) return null;
      const x = rand(r);
      if (x < 0.3 && p.saveOptions.length) return { type: 'witch', save: choose(r, p.saveOptions), poison: null };
      if (x < 0.55 && p.poison && p.poisonOptions.length) return { type: 'witch', save: null, poison: choose(r, p.poisonOptions) };
      return { type: 'witch', save: null, poison: null };
    }
    case 'treasure': {
      if (p.submitted) return null;
      const card = choose(r, p.allowedCards);
      const sk = p.cardSkills.find((c) => c.card === card)!;
      const target = sk.options.length && (sk.mandatory || rand(r) < 0.6) ? choose(r, sk.options) : null;
      const kill = p.canKill && p.killOptions.length ? choose(r, p.killOptions) : null;
      const rest = p.killOptions.filter((x) => x !== kill);
      const kill2 = p.killMax === 2 && kill != null && rest.length && rand(r) < 0.8 ? choose(r, rest) : null;
      return { type: 'treasure', card, target, kill, kill2 };
    }
    case 'status':
      return p.acked ? null : { type: 'ack', step: p.step };
    case 'signup':
      return p.joined === null ? { type: 'signup', join: rand(r) < 0.35 } : null;
    case 'vote':
      if (p.myVote !== undefined) return null;
      return { type: 'vote', target: rand(r) < 0.1 || p.candidates.length === 0 ? null : choose(r, p.candidates) };
    case 'deathSkill':
      if (p.done) return null;
      if (p.mask) return { type: 'mask', use: rand(r) < 0.7 };
      if (p.badge && !p.badgeDone)
        return { type: 'badge', target: rand(r) < 0.8 && p.badgeOptions.length ? choose(r, p.badgeOptions) : null };
      if (p.canShoot && p.shot === undefined)
        return { type: 'shoot', target: rand(r) < 0.7 && p.shootOptions.length ? choose(r, p.shootOptions) : null };
      return { type: 'skillDone' };
    case 'orderChoice':
      return { type: 'order', dir: rand(r) < 0.5 ? 'cw' : 'ccw' };
  }
}

function playGame(boardId: string, seed: number, rules: Partial<RuleOptions> = {}): Game {
  const cfg = presetConfig(boardId);
  cfg.rules = { ...cfg.rules, ...rules };
  return playOut(Game.create(cfg, seed, 1), boardId, seed);
}

function playOut(g: Game, boardId: string, seed: number): Game {
  const r: RngHolder = { rng: seed * 7919 + 1 };
  let now = 5_000_000;
  const check = (err: string | null, what: string) => {
    if (err) throw new Error(`${boardId}#${seed}: ${what} rejected: ${err} in ${g.s.phase.kind}`);
  };
  check(g.ownerCmd({ type: 'start' }, now), 'start');
  for (let iter = 0; iter < 20000 && g.s.phase.kind !== 'ended'; iter++) {
    let acted = false;
    // occasional self-destruct
    if (g.selfDestructWindow() && rand(r) < 0.04) {
      const wolves = g.s.players.filter((p) => p.alive && ROLES[p.role].canSelfDestruct);
      if (wolves.length) {
        const w = choose(r, wolves);
        const sv = g.skillView(w.seat).selfDestruct!;
        const target = sv.canTake && sv.targets.length && rand(r) < 0.6 ? choose(r, sv.targets) : null;
        check(g.act(w.seat, { type: 'selfDestruct', target }, now), 'selfDestruct');
        acted = true;
        continue;
      }
    }
    // occasional withdraw
    const ph = g.s.phase;
    if ((ph.kind === 'withdraw' || (ph.kind === 'speech' && ph.context === 'sheriff')) && rand(r) < 0.05) {
      const c = g.s.election?.candidates ?? [];
      if (c.length) {
        check(g.act(choose(r, c), { type: 'withdraw' }, now), 'withdraw');
        continue;
      }
    }
    for (const pl of g.s.players) {
      if ((g.s.phase.kind as string) === 'ended') break;
      const p = g.promptFor(pl.seat);
      if (!p) continue;
      if (rand(r) < 0.1) continue; // sometimes people are slow
      const a = actionFor(p, pl.seat, r, g);
      if (!a) continue;
      check(g.act(pl.seat, a, now), `${a.type} by ${pl.seat}`);
      acted = true;
    }
    const cur = g.s.phase;
    if (cur.kind === 'speech') {
      check(g.act(cur.order[cur.idx], { type: 'endSpeech' }, now), 'endSpeech');
      continue;
    }
    if (!acted || rand(r) < 0.5) {
      const w = g.nextWakeup();
      if (w == null) {
        if ((g.s.phase.kind as string) === 'ended') break;
        throw new Error(`${boardId}#${seed}: stuck in ${g.s.phase.kind}`);
      }
      now = Math.max(now, w);
      g.tick(now);
    }
  }
  return g;
}

export { playGame, playOut };
describe('fuzz: random full games on every preset', () => {
  for (const b of BOARDS) {
    it(`${b.name}`, () => {
      for (let seed = 1; seed <= 60; seed++) {
        const g = playGame(b.id, seed);
        expect(g.s.phase.kind).toBe('ended');
        expect(g.s.winner).not.toBe(null);
        const w = g.winnerNow();
        // the recorded winner must still be consistent with the table
        if (g.s.winner !== 'draw') expect([g.s.winner, g.s.config.rules.simultaneousWin]).toContain(w);
        // views never throw
        for (const p of g.s.players) {
          g.promptFor(p.seat);
          g.skillView(p.seat);
          g.privateInfo(p.seat);
        }
        expect(g.result(() => null)?.players.length).toBe(g.s.players.length);
      }
    });
  }

  it('single-爆 and no-sheriff variants', () => {
    for (let seed = 100; seed < 140; seed++) {
      expect(playGame('ynlb', seed, { badgeSwallow: 'single' }).s.phase.kind).toBe('ended');
      expect(playGame('jxl', seed, { sheriff: false }).s.phase.kind).toBe('ended');
    }
  });

  it('persisted state round-trips through JSON mid-game', () => {
    const cfg = presetConfig('lwsmr');
    const g = Game.create(cfg, 42, 1);
    g.ownerCmd({ type: 'start' }, 0);
    g.tick(60_000);
    const copy = new Game(JSON.parse(JSON.stringify(g.s)));
    expect(copy.nextWakeup()).toBe(g.nextWakeup());
    copy.tick(200_000);
    g.tick(200_000);
    expect(JSON.stringify(copy.s)).toBe(JSON.stringify(g.s));
  });
});

describe('fuzz: focused 12-player boards (400 games each, key mechanics must occur)', () => {
  const run = (board: string, n: number) => {
    const events: string[] = [];
    for (let seed = 1000; seed < 1000 + n; seed++) {
      const g = playGame(board, seed);
      expect(g.s.phase.kind).toBe('ended');
      const hist = g.s.history.flatMap((h) => h.events.map((e) => e.text)).join('\n');
      const logs = g.s.nights.flatMap((r) => r.log).join('\n');
      events.push(hist + '\n' + logs);
    }
    return (re: RegExp) => events.filter((t) => re.test(t)).length;
  };

  it('预女猎白混', () => {
    const count = run('ynlbh', 400);
    expect(count(/翻牌为白神/)).toBeGreaterThan(0);
    expect(count(/混血儿\(\d+号\)选择\d+号为榜样/)).toBe(400);
    expect(count(/开枪带走/)).toBeGreaterThan(0);
    expect(count(/自爆/)).toBeGreaterThan(0);
  });

  it('机械狼通灵师', () => {
    const count = run('jxl', 400);
    expect(count(/机械狼\(\d+号\)学习了/)).toBeGreaterThan(0);
    expect(count(/机械狼\(\d+号\)击杀/)).toBeGreaterThan(0);
    expect(count(/机械狼\(\d+号\)发动机械技能/)).toBeGreaterThan(0);
    expect(count(/守卫\(\d+号\)守护/)).toBeGreaterThan(0);
  });

  it('盗宝大师 (with 蒙面人)', () => {
    const count = run('dbds', 400);
    expect(count(/盗宝大师\(\d+号\)使用「/)).toBe(400);
    expect(count(/蒙面负伤/)).toBeGreaterThan(0);
    expect(count(/发言后出局/)).toBeGreaterThan(0);
    expect(count(/梦亡/)).toBeGreaterThan(0);
  });

  it('盗宝蒙面 as the last wolf (200 games from that position)', () => {
    const roles: RoleId[] = ['treasure', 'psychic', 'poisoner', 'hunter', 'dreamer', 'wolfking', 'wolf', 'wolf', 'villager', 'villager', 'villager', 'villager'];
    let survived = 0;
    let doubleKills = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const seats = shuffle({ rng: seed }, roles);
      const cfg = presetConfig('dbds');
      const g = Game.fromSeats(cfg, seats, ['masked', 'villager', 'wolf'], seed);
      for (const p of g.s.players) if (p.role === 'wolf' || p.role === 'wolfking') p.alive = false;
      playOut(g, 'dbds-lastwolf', seed);
      expect(g.s.phase.kind).toBe('ended');
      const hist = g.s.history.flatMap((h) => h.events.map((e) => e.text)).join('\n');
      if (/发动蒙面技能，被推不死/.test(hist)) survived++;
      if (g.s.nights.some((n) => n.treasure?.kill2 != null)) doubleKills++;
    }
    expect(survived).toBeGreaterThan(0);
    expect(doubleKills).toBeGreaterThan(0);
  });
});
