// Scripted complete games on the 12-player boards 预女猎白混, 机械狼通灵师 and 盗宝大师,
// checking the table after every night and day.
import { describe, expect, it } from 'vitest';
import { presetConfig } from '../../shared/config.ts';
import type { RoleId } from '../../shared/roles.ts';
import { Game, stepsForNight } from '../../server/game/engine.ts';
import { Driver } from './driver.ts';

function signup(d: Driver, joiners: number[]): void {
  d.toPhase('signup');
  for (const s of d.alive()) if (d.phase.kind === 'signup') d.act(s, { type: 'signup', join: joiners.includes(s) });
}

/** discussion (with the sheriff choosing clockwise when there is one) then everyone votes `target` */
function discussAndExile(d: Driver, target: number | null, votes: Record<number, number | null> = {}): void {
  d.until(() => d.phase.kind === 'orderChoice' || (d.phase.kind === 'speech' && (d.phase as any).context === 'discussion'));
  if (d.phase.kind === 'orderChoice') d.act(d.s.sheriff!, { type: 'order', dir: 'cw' });
  d.endSpeeches();
  d.voteAll(target, votes);
}

/** after an exile: skip skills and last words until night (or the end) */
function toNight(d: Driver): void {
  for (let i = 0; i < 20 && d.phase.kind !== 'night' && d.phase.kind !== 'ended'; i++) {
    if (d.phase.kind === 'deathSkills') d.skipSkills();
    else if (d.phase.kind === 'speech') d.endSpeeches();
    else d.step();
  }
}

const alive = (d: Driver) => d.alive().join(',');

describe('预女猎白混 (12)', () => {
  // 1预言家 2女巫 3猎人 4白神 5-8狼人 9-11平民 12混血儿
  const SEATS: RoleId[] = ['seer', 'witch', 'hunter', 'whitegod', 'wolf', 'wolf', 'wolf', 'wolf', 'villager', 'villager', 'villager', 'mixed'];

  it('night order matches the board', () => {
    const cfg = presetConfig('ynlbh');
    expect(stepsForNight(cfg, 1)).toEqual(['mixed', 'wolves', 'witch', 'seer', 'hunterStatus', 'whitegodConfirm']);
    expect(stepsForNight(cfg, 2)).toEqual(['wolves', 'witch', 'seer', 'hunterStatus']);
  });

  it('plays to a wolf win: 混血儿 follows a wolf 榜样, 白神 flips, the last god cannot shoot', () => {
    const d = new Driver(SEATS);
    d.start();
    // night 1
    d.pick(12, 'mixed', [5]);
    expect(d.g.privateInfo(12)[0]).toContain('5号');
    d.wolves(3);
    d.witch(2, 3, null);
    d.pick(1, 'seer', [12]);
    expect(d.s.players[0].checks[0].result).toBe('好人');
    d.toStep('whitegodConfirm');
    expect((d.g.promptFor(4) as any).kind).toBe('status');
    d.toDay();
    // day 1: the seer runs alone; saved hunter → peaceful night
    signup(d, [1]);
    expect(d.s.sheriff).toBe(1);
    d.toPhase('orderChoice');
    expect(d.announcements()).toContain('昨天晚上是平安夜。');
    discussAndExile(d, 4);
    expect(d.announcements()).toContain('4号玩家出局，翻牌为白神，请留遗言。');
    expect(d.g.publicSeatInfo(4).revealed).toBe('whitegod');
    toNight(d);
    // night 2: the sheriff (seer) dies; no antidote left → the witch does not learn the knife
    d.wolves(1);
    d.toStep('witch');
    expect((d.g.promptFor(2) as any).knifed).toBe(null);
    d.act(2, { type: 'witch', save: null, poison: null });
    d.pick(1, 'seer', [5]);
    d.toDay();
    d.toPhase('deathSkills');
    d.act(1, { type: 'badge', target: 2 });
    expect(d.s.sheriff).toBe(2);
    expect(d.phase.kind).not.toBe('speech'); // night-2 deaths have no last words
    discussAndExile(d, 5);
    expect(alive(d)).toBe('2,3,6,7,8,9,10,11,12');
    toNight(d);
    // night 3: wolves kill the witch, who poisons 6 on her way out
    d.wolves(2);
    d.witch(2, null, 6);
    d.toDay();
    d.toPhase('deathSkills');
    expect(d.alive()).not.toContain(2);
    expect(d.alive()).not.toContain(6);
    d.skipSkills();
    // day 3: exiling the hunter (the last god) ends the game before any shot
    discussAndExile(d, 3);
    expect(d.phase.kind).toBe('ended');
    expect(d.s.winner).toBe('wolf');
    expect(d.s.winReason).toContain('屠神');
    const res = d.g.result(() => null)!;
    expect(res.players.find((p) => p.seat === 12)).toMatchObject({ role: 'mixed', faction: 'wolf', won: true, note: '榜样：5号' });
    expect(res.players.find((p) => p.seat === 9)?.won).toBe(false);
    expect(res.nights.length).toBe(3);
  });

  it('混血儿 with a good 榜样 wins with the good side', () => {
    const d = new Driver(SEATS, { sheriff: false });
    d.start();
    d.pick(12, 'mixed', [1]);
    d.wolves(null);
    d.toDay();
    for (const w of [5, 6, 7]) {
      discussAndExile(d, w);
      toNight(d);
      d.wolves(null);
      d.toDay();
    }
    discussAndExile(d, 8);
    expect(d.s.winner).toBe('good');
    expect(d.g.result(() => null)!.players.find((p) => p.seat === 12)?.won).toBe(true);
  });
});

describe('机械狼通灵师 (12)', () => {
  // 1通灵师 2女巫 3猎人 4守卫 5-7狼人 8机械狼 9-12平民
  const SEATS: RoleId[] = ['psychic', 'witch', 'hunter', 'guard', 'wolf', 'wolf', 'wolf', 'mechwolf', 'villager', 'villager', 'villager', 'villager'];

  it('night order matches the board', () => {
    const cfg = presetConfig('jxl');
    expect(stepsForNight(cfg, 1)).toEqual(['mechLearn', 'guard', 'wolves', 'witch', 'psychic', 'hunterStatus']);
    expect(stepsForNight(cfg, 2)).toEqual(['guard', 'wolves', 'mechKill', 'witch', 'psychic', 'mechSkill', 'hunterStatus']);
  });

  it('plays to a good win: 机械守卫 blocks the poison, the pack dies, the 机械狼 takes the knife and the hunter shoots it', () => {
    const d = new Driver(SEATS);
    d.start();
    // night 1: the 机械狼 learns the guard, the guard protects the wolves' target, the psychic sees the learned identity
    d.pick(8, 'mechLearn', [4]);
    d.pick(4, 'guard', [9]);
    d.wolves(9);
    d.witch(2, null, null);
    d.pick(1, 'psychic', [8]);
    expect(d.s.players[0].checks[0].result).toBe('守卫');
    d.toDay();
    signup(d, []);
    expect(d.s.badgeLost).toBe(true);
    d.toPhase('speech');
    expect(d.announcements()).toContain('昨天晚上是平安夜。');
    discussAndExile(d, 5);
    toNight(d);
    // night 2: the witch is knifed (cannot self-save), poisons 6 — the 机械守卫 shields 6
    d.pick(4, 'guard', [10]);
    d.wolves(2);
    d.toStep('mechKill');
    expect((d.g.promptFor(8) as any).kind).toBe('status'); // pack alive → no knife
    d.toStep('witch');
    expect((d.g.promptFor(2) as any).saveOptions).toEqual([]);
    d.act(2, { type: 'witch', save: null, poison: 6 });
    d.pick(1, 'psychic', [6]);
    expect(d.s.players[0].checks[1].result).toBe('狼人');
    d.pick(8, 'mechSkill', [6]);
    d.toDay();
    d.toPhase('deathSkills');
    expect(d.alive()).toContain(6); // poison blocked
    expect(d.alive()).not.toContain(2);
    d.skipSkills();
    discussAndExile(d, 6);
    toNight(d);
    // night 3
    d.pick(4, 'guard', [11]);
    d.wolves(12);
    d.toStep('mechSkill');
    expect(d.tryAct(8, { type: 'pick', step: 'mechSkill', targets: [6] })).toBeTruthy(); // 6 is dead now
    d.act(8, { type: 'pick', step: 'mechSkill', targets: [7] });
    d.toDay();
    d.toPhase('deathSkills');
    d.skipSkills();
    discussAndExile(d, 7);
    expect(d.g.knifeHolder()).toBe(8);
    toNight(d);
    // night 4: the 机械狼 now holds the knife and kills the hunter, who shoots it at dawn
    d.pick(4, 'guard', [9]);
    d.toStep('mechKill');
    expect((d.g.promptFor(8) as any).kind).toBe('pick');
    d.act(8, { type: 'pick', step: 'mechKill', targets: [3] });
    d.toStep('hunterStatus');
    expect((d.g.promptFor(3) as any).lines[0]).toBe('你的开枪状态：可以开枪');
    d.toDay();
    d.toPhase('deathSkills');
    d.act(3, { type: 'shoot', target: 8 });
    expect(d.s.winner).toBe('good');
    expect(d.g.result(() => null)!.players.find((p) => p.seat === 8)?.note).toBe('学习：守卫');
  });
});

describe('盗宝大师 (12)', () => {
  // 1盗宝 2通灵师 3毒师 4猎人 5摄梦人 6狼王 7-8狼人 9-12平民 (buried: 蒙面人 平民 狼人 → 盗宝狼)
  const SEATS: RoleId[] = ['treasure', 'psychic', 'poisoner', 'hunter', 'dreamer', 'wolfking', 'wolf', 'wolf', 'villager', 'villager', 'villager', 'villager'];

  it('the preset is 京城: 蒙面人 instead of 乌鸦, every god is called', () => {
    const cfg = presetConfig('dbds');
    expect(cfg.roles.masked).toBe(1);
    expect(cfg.roles.crow).toBeUndefined();
    expect(cfg.rules.dreamBlocksPoison).toBe(true);
    expect(stepsForNight(cfg, 1)).toEqual(['treasure', 'dreamer', 'wolves', 'poisoner', 'psychic', 'hunterStatus', 'wolfkingStatus', 'maskedConfirm']);
    expect(stepsForNight(cfg, 2)).toEqual(['treasure', 'dreamer', 'wolves', 'poisoner', 'psychic', 'hunterStatus', 'wolfkingStatus']);
    const g = Game.create(cfg, 99, 1);
    expect(g.s.players.length).toBe(12);
    expect(g.s.buried?.length).toBe(3);
  });

  it('plays a full game: 狼王 shoots on exile, dream link kills, 盗宝 switches cards, survives with 蒙面 and kills twice', () => {
    const d = new Driver(SEATS, {}, ['masked', 'villager', 'wolf']);
    expect(d.s.players[0].treasure).toMatchObject({ faction: 'wolf', countsAs: 'wolf' });
    d.start();
    // night 1: 盗宝 takes the 蒙面人 card; wolves kill the 毒师
    d.toStep('treasure');
    expect((d.g.promptFor(1) as any).canKill).toBe(false);
    d.act(1, { type: 'treasure', card: 0, target: null, kill: null });
    d.pick(5, 'dreamer', [9]);
    d.wolves(3);
    d.toStep('poisoner');
    d.act(3, { type: 'pick', step: 'poisoner', targets: [] });
    d.pick(2, 'psychic', [1]);
    expect(d.s.players[1].checks[0].result).toBe('蒙面人');
    d.toDay();
    signup(d, []);
    d.toPhase('deathSkills');
    expect(d.alive()).not.toContain(3);
    d.skipSkills();
    d.endSpeeches(); // night-1 last words
    // day 1: 狼王 exiled, shoots the hunter (who cannot shoot back)
    discussAndExile(d, 6);
    expect((d.g.promptFor(6) as any).canShoot).toBe(true);
    d.act(6, { type: 'shoot', target: 4 });
    expect((d.phase as any).entries.find((e: any) => e.seat === 4).canShoot).toBe(false);
    d.skipSkills();
    expect((d.phase as any).context).toBe('lastWords');
    expect((d.phase as any).order).toEqual([6, 4]);
    toNight(d);
    // night 2: wolf card; wolves kill the 摄梦人 → the sleepwalker dies with them
    d.toStep('treasure');
    expect((d.g.promptFor(1) as any).allowedCards).toEqual([1, 2]);
    d.act(1, { type: 'treasure', card: 2, target: null, kill: null });
    d.pick(5, 'dreamer', [10]);
    d.wolves(5);
    d.pick(2, 'psychic', [1]);
    expect(d.s.players[1].checks[1].result).toBe('狼人');
    d.toDay();
    d.toPhase('deathSkills');
    expect(d.s.players[9].death?.causes).toEqual(['dream']);
    d.skipSkills();
    discussAndExile(d, 7);
    toNight(d);
    // night 3: villager card
    d.toStep('treasure');
    d.act(1, { type: 'treasure', card: 1, target: null, kill: null });
    d.wolves(11);
    d.pick(2, 'psychic', [1]);
    expect(d.s.players[1].checks[2].result).toBe('普通村民');
    d.toDay();
    d.toPhase('deathSkills');
    d.skipSkills();
    discussAndExile(d, 8);
    expect(d.g.knifeHolder()).toBe(1); // 盗宝狼 is the last wolf
    toNight(d);
    // night 4: back to the 蒙面人 card, the 盗宝 kills
    d.toStep('treasure');
    d.act(1, { type: 'treasure', card: 0, target: null, kill: 12 });
    d.pick(2, 'psychic', [9]);
    d.toDay();
    d.toPhase('deathSkills');
    d.skipSkills();
    expect(alive(d)).toBe('1,2,9');
    // day 4: exiled, the 盗宝蒙面 survives
    discussAndExile(d, 1);
    expect((d.g.promptFor(1) as any).mask).toBe(true);
    d.act(1, { type: 'mask', use: true });
    toNight(d);
    // night 5: two kills end it
    d.toStep('treasure');
    d.act(1, { type: 'treasure', card: 2, target: null, kill: 2, kill2: 9 });
    d.toDay();
    d.until(() => d.phase.kind === 'ended');
    expect(d.s.winner).toBe('wolf');
    const res = d.g.result(() => null)!;
    expect(res.buried).toEqual(['masked', 'villager', 'wolf']);
    expect(res.players.find((p) => p.seat === 1)).toMatchObject({ faction: 'wolf', won: true });
  });

  it('good 盗宝 with a 蒙面人 on the table: the wounded 蒙面人 goes out after speaking', () => {
    // buried 毒师/通灵师/平民 → good 盗宝 counting as 神; table has 蒙面人 at 3 instead of the 毒师
    const seats: RoleId[] = ['treasure', 'villager', 'masked', 'hunter', 'dreamer', 'wolfking', 'wolf', 'wolf', 'wolf', 'villager', 'villager', 'villager'];
    const d = new Driver(seats, { sheriff: false }, ['poisoner', 'psychic', 'villager']);
    expect(d.s.players[0].treasure).toMatchObject({ faction: 'good', countsAs: 'god' });
    d.start();
    d.toStep('treasure');
    d.act(1, { type: 'treasure', card: 1, target: 6, kill: null }); // 通灵师 card checks the 狼王
    expect(d.s.players[0].checks[0].result).toBe('狼王');
    d.pick(5, 'dreamer', [10]);
    d.wolves(3);
    d.toDay();
    d.toPhase('speech');
    expect(d.announcements()).toContain('昨天晚上是平安夜。');
    const order = (d.phase as any).order as number[];
    for (const s of order) {
      d.act(s, { type: 'endSpeech' });
      if (s === 3) break;
    }
    expect(d.s.players[2].alive).toBe(false);
    expect(d.announcements()).toContain('3号玩家出局。');
    expect(d.s.winner).toBe(null);
  });
});
