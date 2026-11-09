// Random agents play complete games on every preset. They only act through the
// prompts a real client would see, so this also exercises prompt/validation
// consistency (every action derived from a prompt must be accepted).
import { describe, expect, it } from 'vitest';
import { BOARDS, presetConfig, validateConfig, type RuleOptions } from '../../shared/config.ts';
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
      if (p.options.length < p.min || (p.allowNone && rand(r) < 0.15))
        return p.allowNone ? { type: 'pick', step: p.step, targets: [] } : null;
      const n = p.min > 1 ? p.min : p.max >= 2 && p.options.length > 1 && rand(r) < 0.7 ? 2 : 1;
      return { type: 'pick', step: p.step, targets: shuffle(r, p.options).slice(0, Math.min(n, p.max)) };
    }
    case 'masque': {
      if (p.submitted) return null;
      if (!p.verified && p.verifyOptions.length)
        return { type: 'masqueVerify', target: rand(r) < 0.8 ? choose(r, p.verifyOptions) : null };
      return {
        type: 'masqueAct',
        mask: p.maskOptions.length && rand(r) < 0.6 ? choose(r, p.maskOptions) : null,
        kill: p.canKill && p.killOptions.length ? choose(r, p.killOptions) : null,
      };
    }
    case 'prince':
      return p.decided || rand(r) > 0.3 ? null : { type: 'prince', use: true };
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
    default:
      return null;
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
  let annSeen = g.s.nextAnnId;
  let wasNight = false;
  for (let iter = 0; iter < 20000 && g.s.phase.kind !== 'ended'; iter++) {
    // what the judge says during the night is public: it must never carry a seat number
    const fresh = g.s.announcements.filter((a) => a.id >= annSeen);
    annSeen = g.s.nextAnnId;
    if (wasNight && g.s.phase.kind === 'night')
      for (const a of fresh)
        if (/\d/.test(a.text) || a.clips.some((c) => /^n\d+$/.test(c)))
          throw new Error(`${boardId}#${seed}: night announcement leaks a number: ${a.text}`);
    wasNight = g.s.phase.kind === 'night';
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
    // occasional knight duel
    if (g.duelWindow() && rand(r) < 0.05) {
      const k = g.s.players.find((p) => p.role === 'knight' && p.alive && !p.skillUsed);
      if (k) {
        const targets = g.aliveSeats().filter((x) => x !== k.seat);
        if (targets.length) {
          check(g.act(k.seat, { type: 'duel', target: choose(r, targets) }, now), 'duel');
          continue;
        }
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
  const run = (board: string, n: number, keep?: Game[]) => {
    const events: string[] = [];
    for (let seed = 1000; seed < 1000 + n; seed++) {
      const g = playGame(board, seed);
      keep?.push(g);
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

  it('狼美骑士', () => {
    const count = run('lmqs', 400);
    expect(count(/狼美人\(\d+号\)魅惑/)).toBeGreaterThan(300);
    expect(count(/殉情出局/)).toBeGreaterThan(0);
    expect(count(/骑士决斗\d+号：狼人出局/)).toBeGreaterThan(0);
    expect(count(/骑士决斗\d+号：好人，骑士出局/)).toBeGreaterThan(0);
  });

  it('假面舞会', () => {
    const count = run('jmwh', 400);
    expect(count(/舞者\(\d+号\)安排共舞/)).toBeGreaterThan(0);
    expect(count(/舞池/)).toBeGreaterThan(0);
    expect(count(/假面\(\d+号\).*给\d+号面具/)).toBeGreaterThan(0);
    expect(count(/翻牌为白神/)).toBeGreaterThan(0);
  });

  it('诡术之境', () => {
    const count = run('gszj', 400);
    expect(count(/魔术师\(\d+号\)交换了/)).toBeGreaterThan(0);
    expect(count(/诡术师\(\d+号\)交换了/)).toBeGreaterThan(0);
    expect(count(/翻牌为定序王子/)).toBeGreaterThan(0);
  });

  it('魔幻对决', () => {
    const count = run('mhdj', 400);
    expect(count(/狼术师\(\d+号\)交换了/)).toBeGreaterThan(0);
    expect(count(/魔术师\(\d+号\)交换了/)).toBeGreaterThan(0);
    expect(count(/开枪带走/)).toBeGreaterThan(0);
  });

  it('狼女孩', () => {
    const games: Game[] = [];
    const count = run('lnh', 400, games);
    expect(count(/狼女孩\(\d+号\)向\d+号表白/)).toBe(400);
    expect(count(/平民成为狼混/)).toBeGreaterThan(50);
    expect(count(/对方拒绝/)).toBeGreaterThan(50);
    expect(count(/表白对象\d+号随之出局/)).toBeGreaterThan(0);
    let goodWinsWithLanghunAlive = 0;
    let langhunWins = 0;
    for (const g of games) {
      // 首夜禁刀: no knife on night 1
      expect(g.s.nights[0].wolfTarget ?? null).toBe(null);
      expect(g.s.players.some((p) => p.death?.time === 'night' && p.death.index === 1 && p.death.causes.includes('knife'))).toBe(false);
      const res = g.result(() => null)!;
      const lh = res.players.find((p) => p.note === '狼混');
      if (!lh) continue;
      expect(lh.faction).toBe('wolf');
      expect(lh.won).toBe(g.s.winner === 'wolf');
      if (g.s.winner === 'good' && lh.alive) goodWinsWithLanghunAlive++;
      if (lh.won) langhunWins++;
    }
    expect(goodWinsWithLanghunAlive).toBeGreaterThan(0);
    expect(langhunWins).toBeGreaterThan(0);
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


// ── random custom tables: any size, any mix of roles ──
const SINGLE_GOOD: RoleId[] = ['seer', 'psychic', 'witch', 'hunter', 'guard', 'whitegod', 'poisoner', 'dreamer', 'crow', 'masked', 'knight', 'dancer', 'magician', 'prince', 'mixed'];
const SINGLE_WOLF: RoleId[] = ['wolfking', 'whitewolfking', 'mechwolf', 'wolfbeauty', 'trickster', 'wolfwizard', 'masque', 'wolfgirl'];

function randomConfig(seed: number): import('../../shared/config.ts').GameConfig {
  const r: RngHolder = { rng: seed * 104729 + 7 };
  for (;;) {
    const players = 5 + Math.floor(rand(r) * 14); // 5..18
    const roles: Partial<Record<RoleId, number>> = {};
    const wolves = Math.max(1, Math.round(players / 4) + (rand(r) < 0.3 ? 1 : 0) - (rand(r) < 0.3 ? 1 : 0));
    const specials = shuffle(r, SINGLE_WOLF).slice(0, Math.floor(rand(r) * Math.min(3, wolves + 1)));
    for (const w of specials.slice(0, wolves)) roles[w] = 1;
    const plain = wolves - Object.keys(roles).length;
    if (plain > 0) roles.wolf = plain;
    const goods = shuffle(r, SINGLE_GOOD).slice(0, Math.floor(rand(r) * Math.min(7, players - wolves)));
    for (const g of goods) roles[g] = 1;
    const used = Object.values(roles).reduce((a, b) => a + (b ?? 0), 0);
    if (used < players) roles.villager = players - used;
    if (rand(r) < 0.12) {
      roles.treasure = 1;
      roles.villager = (roles.villager ?? 0) + 2; // 15-card style pool: treasure + 3 buried
      if (!roles.seer && !roles.psychic) roles.psychic = 1;
      else roles.wolf = (roles.wolf ?? 0) + 1;
      if ((roles.villager ?? 0) < 2) roles.villager = 2;
    }
    const rules = { ...presetConfig('ynlb').rules, sheriff: rand(r) < 0.7, magicianFirstNight: rand(r) < 0.5, firstNightNoKnife: rand(r) < 0.25 };
    const cfg = { boardName: 'random', roles, rules };
    if (!validateConfig(cfg)) return cfg;
  }
}

describe('fuzz: random custom tables (any size, any mix of roles)', () => {
  it('1,500 random tables play to the end', () => {
    let maxNight = 0;
    const seen = new Set<string>();
    for (let seed = 1; seed <= 1500; seed++) {
      const cfg = randomConfig(seed);
      const g = playOut(Game.create(cfg, seed, 1), `random#${seed}`, seed);
      expect(g.s.phase.kind).toBe('ended');
      maxNight = Math.max(maxNight, g.s.night);
      for (const p of g.s.players) seen.add(p.role);
      // the winner must match the final table (or be the configured tie-break)
      if (g.s.winner !== 'draw') expect([g.s.winner, g.s.config.rules.simultaneousWin]).toContain(g.winnerNow() ?? g.s.winner);
    }
    expect(maxNight).toBeLessThan(40);
    expect([...seen].sort()).toEqual([...new Set([...SINGLE_GOOD, ...SINGLE_WOLF, 'wolf', 'villager', 'treasure'])].sort());
  });
});
