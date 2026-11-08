import { describe, expect, it } from 'vitest';
import { presetConfig } from '../../shared/config.ts';
import { ROLES, type RoleId } from '../../shared/roles.ts';
import { deal, treasureFaction } from '../../server/game/deal.ts';
import { Game, stepsForNight, T } from '../../server/game/engine.ts';
import { Driver } from './driver.ts';

// 1通灵师 2女巫 3猎人 4守卫 5-7狼人 8机械狼 9-12平民
const JXL: RoleId[] = ['psychic', 'witch', 'hunter', 'guard', 'wolf', 'wolf', 'wolf', 'mechwolf', 'villager', 'villager', 'villager', 'villager'];
// 1盗宝 2通灵师 3毒师 4猎人 5摄梦人 6狼王 7-8狼人 9-12平民 (buried passed separately)
const DBDS: RoleId[] = ['treasure', 'psychic', 'poisoner', 'hunter', 'dreamer', 'wolfking', 'wolf', 'wolf', 'villager', 'villager', 'villager', 'villager'];

function dayPass(d: Driver, exile: number | null = null): void {
  // run through a day with no sheriff: announce, discussion, vote
  d.until(() => d.phase.kind === 'speech' && (d.phase as any).context === 'discussion' || d.phase.kind === 'ended');
  if (d.phase.kind === 'ended') return;
  d.endSpeeches();
  d.voteAll(exile);
  if (d.phase.kind === 'deathSkills') d.skipSkills();
  if (d.phase.kind === 'speech') d.endSpeeches();
  d.until(() => d.phase.kind === 'night' || d.phase.kind === 'ended');
}

describe('机械狼', () => {
  it('learns on night 1, the psychic sees the learned identity, poison works from night 2', () => {
    const d = new Driver(JXL, { sheriff: false });
    d.start();
    expect(stepsForNight(d.s.config, 1)).toContain('mechLearn');
    d.pick(8, 'mechLearn', [2]);
    expect(d.s.players[7].mech?.learned).toBe('witch');
    expect(d.s.nights[0].results.mechLearn[0]).toBe('2号玩家的身份是：女巫');
    d.wolves(null);
    d.pick(1, 'psychic', [8]);
    expect(d.s.players[0].checks[0].result).toBe('女巫');
    d.toDay();
    dayPass(d);
    d.wolves(null);
    d.toStep('mechSkill');
    const pr = d.g.promptFor(8) as any;
    expect(pr.kind).toBe('pick');
    d.act(8, { type: 'pick', step: 'mechSkill', targets: [9] });
    d.toDay();
    d.toPhase('deathSkills');
    expect(d.s.players[8].death?.causes).toEqual(['poison']);
    // poison is single use
    expect(d.s.players[7].mech?.poison).toBe(false);
  });

  it('an unlearned 机械狼 checks as 机械狼 for the psychic and 狼人 for a seer', () => {
    const d = new Driver(JXL, { sheriff: false });
    d.start();
    d.pick(8, 'mechLearn', []);
    d.wolves(null);
    d.pick(1, 'psychic', [8]);
    expect(d.s.players[0].checks[0].result).toBe('机械狼');
    const g = Game.fromSeats(d.s.config, JXL.map((r) => (r === 'psychic' ? 'seer' : r)), null);
    expect(g.seerResult(8)).toBe('狼人');
  });

  it('does not meet the pack and cannot self-destruct', () => {
    const d = new Driver(JXL, { sheriff: false });
    expect(d.g.packSeats(false)).toEqual([5, 6, 7]);
    expect(d.g.privateInfo(5).join()).not.toContain('8号');
    expect(d.g.skillView(8).selfDestruct).toBe(null);
  });

  it('has no knife while the pack lives, gets one after', () => {
    const d = new Driver(JXL, { sheriff: false });
    d.start();
    d.pick(8, 'mechLearn', [9]);
    d.wolves(null);
    d.toDay();
    dayPass(d);
    d.wolves(null);
    d.toStep('mechKill');
    expect((d.g.promptFor(8) as any).kind).toBe('status');
    expect(d.g.stepInteractive('mechKill')).toBe(false);
    // kill the pack
    for (const w of [5, 6, 7]) d.s.players[w - 1].alive = false;
    expect(d.g.knifeHolder()).toBe(8);
  });

  it('learning a wolf gives a one-night double knife with a shield-piercing second knife', () => {
    const d = new Driver(JXL, { sheriff: false });
    d.start();
    d.pick(8, 'mechLearn', [5]);
    d.wolves(null);
    d.toDay();
    // remove the pack (exile them over time is slow; flip state directly)
    for (const w of [5, 6, 7]) {
      d.s.players[w - 1].alive = false;
    }
    dayPass(d);
    d.pick(4, 'guard', [10]);
    d.toStep('mechKill');
    const pr = d.g.promptFor(8) as any;
    expect(pr.max).toBe(2);
    d.act(8, { type: 'pick', step: 'mechKill', targets: [9, 10] });
    d.toDay();
    d.toPhase('deathSkills');
    expect(d.s.players[8].alive).toBe(false);
    expect(d.s.players[9].alive).toBe(false); // guarded, but pierced
    expect(d.s.players[7].mech?.double).toBe('used');
    dayPass(d);
    d.toStep('mechKill');
    expect((d.g.promptFor(8) as any).max).toBe(1);
  });

  it('a 机械守卫 blocks the witch poison and cannot guard the same player twice', () => {
    const d = new Driver(JXL, { sheriff: false });
    d.start();
    d.pick(8, 'mechLearn', [4]);
    d.wolves(null);
    d.toDay();
    dayPass(d);
    d.wolves(null);
    d.witch(2, null, 6);
    d.toStep('mechSkill');
    d.act(8, { type: 'pick', step: 'mechSkill', targets: [6] });
    d.toDay();
    d.until(() => d.phase.kind === 'speech');
    expect(d.s.players[5].alive).toBe(true);
    expect(d.announcements()).toContain('昨天晚上是平安夜。');
    dayPass(d);
    d.wolves(null);
    d.toStep('mechSkill');
    expect(d.tryAct(8, { type: 'pick', step: 'mechSkill', targets: [6] })).toBe('不能选择这名玩家');
  });

  it('a 机械猎人 can shoot when exiled', () => {
    const d = new Driver(JXL, { sheriff: false });
    d.start();
    d.pick(8, 'mechLearn', [3]);
    d.wolves(null);
    d.toDay();
    d.toPhase('speech');
    d.endSpeeches();
    d.voteAll(8);
    expect((d.g.promptFor(8) as any).canShoot).toBe(true);
  });
});

describe('盗宝大师', () => {
  it('buried wolf → wolf faction; picks a card each night, not the same twice in a row', () => {
    const d = new Driver(DBDS, { sheriff: false, dreamBlocksPoison: false }, ['crow', 'villager', 'wolf']);
    const tp = d.s.players[0];
    expect(tp.treasure?.faction).toBe('wolf');
    expect(d.g.countsAs(tp)).toBe('wolf');
    d.start();
    // every god position is called even though crow is buried
    expect(stepsForNight(d.s.config, 1)).toEqual(
      expect.arrayContaining(['treasure', 'dreamer', 'wolves', 'poisoner', 'psychic', 'crow', 'hunterStatus', 'wolfkingStatus']),
    );
    d.toStep('treasure');
    const pr = d.g.promptFor(1) as any;
    expect(pr.kind).toBe('treasure');
    expect(pr.cards).toEqual(['crow', 'villager', 'wolf']);
    expect(pr.canKill).toBe(false);
    expect(d.tryAct(1, { type: 'treasure', card: 0, target: null, kill: null })).toBe('这张牌必须选择技能目标');
    d.act(1, { type: 'treasure', card: 0, target: 9, kill: null });
    d.pick(5, 'dreamer', [10]);
    d.wolves(null);
    d.pick(2, 'psychic', [1]);
    expect(d.s.players[1].checks[0].result).toBe('乌鸦');
    d.toDay();
    expect(d.s.curses).toEqual([9]);
    dayPass(d);
    d.toStep('treasure');
    expect((d.g.promptFor(1) as any).allowedCards).toEqual([1, 2]);
    expect(d.tryAct(1, { type: 'treasure', card: 0, target: 9, kill: null })).toBe('不能连续两晚选择同一张底牌');
    d.act(1, { type: 'treasure', card: 2, target: null, kill: null });
    d.pick(5, 'dreamer', [11]);
    d.wolves(null);
    d.pick(2, 'psychic', [1]);
    expect(d.s.players[1].checks[1].result).toBe('狼人');
  });

  it('good 盗宝大师 counts as 神 with two buried gods, 民 with two buried villagers', () => {
    expect(treasureFaction(['crow', 'poisoner', 'villager'])).toEqual({ faction: 'good', countsAs: 'god' });
    expect(treasureFaction(['crow', 'villager', 'villager'])).toEqual({ faction: 'good', countsAs: 'villager' });
    expect(treasureFaction(['crow', 'wolf', 'villager'])).toEqual({ faction: 'wolf', countsAs: 'wolf' });
  });

  it('盗宝狼 gets the knife after its teammates are gone', () => {
    const d = new Driver(DBDS, { sheriff: false }, ['crow', 'villager', 'wolf']);
    for (const w of [6, 7, 8]) d.s.players[w - 1].alive = false;
    expect(d.g.knifeHolder()).toBe(1);
    d.start();
    d.toStep('treasure');
    const pr = d.g.promptFor(1) as any;
    expect(pr.canKill).toBe(true);
    d.act(1, { type: 'treasure', card: 1, target: null, kill: 9 });
    d.pick(5, 'dreamer', [10]);
    d.toDay();
    d.until(() => d.phase.kind === 'deathSkills' || d.phase.kind === 'ended');
    expect(d.s.players[8].alive).toBe(false);
  });

  it('the 毒师 card poisons once; the 猎人 card lets it shoot', () => {
    const d = new Driver(DBDS, { sheriff: false }, ['poisoner', 'hunter', 'villager']);
    expect(d.s.players[0].treasure?.faction).toBe('good');
    d.start();
    d.toStep('treasure');
    d.act(1, { type: 'treasure', card: 0, target: 9, kill: null });
    d.pick(5, 'dreamer', [10]);
    d.wolves(null);
    d.toDay();
    d.toPhase('deathSkills');
    expect(d.s.players[8].death?.causes).toEqual(['poison']);
    d.toDiscussion();
    d.endSpeeches();
    d.voteAll(null, {});
    d.until(() => d.phase.kind === 'night');
    d.toStep('treasure');
    // card 0 cannot be repeated; take the hunter card and get exiled tomorrow
    d.act(1, { type: 'treasure', card: 1, target: null, kill: null });
    d.pick(5, 'dreamer', [11]);
    d.wolves(null);
    d.toDay();
    d.toPhase('speech');
    d.endSpeeches();
    d.voteAll(1);
    expect((d.g.promptFor(1) as any).canShoot).toBe(true);
  });

  it('deal() always buries a valid set and keeps the 4/4/4 balance', () => {
    const cfg = presetConfig('dbds');
    for (let seed = 1; seed < 400; seed++) {
      const h = { rng: seed };
      const r = deal(cfg.roles, h);
      expect(r.seats.length).toBe(12);
      expect(r.buried?.length).toBe(3);
      const buried = r.buried!;
      const k = (x: RoleId) => ROLES[x].category;
      const w = buried.filter((x) => k(x) === 'wolf').length;
      const g = buried.filter((x) => k(x) === 'god').length;
      const v = buried.filter((x) => k(x) === 'villager').length;
      expect([`${w}${g}${v}`]).toContainEqual(expect.stringMatching(/^(111|021|012)$/));
      if (w) expect(buried).toContain('wolf'); // never the 狼王
      const game = Game.create(cfg, seed, 1);
      const count = { god: 0, villager: 0, wolf: 0 };
      for (const p of game.s.players) count[game.countsAs(p)]++;
      expect(count).toEqual({ god: 4, villager: 4, wolf: 4 });
    }
  });
});

describe('night timing does not leak who is alive', () => {
  it('a dead role is still called and waits a plausible time', () => {
    const d = new Driver(
      ['seer', 'witch', 'hunter', 'guard', 'wolf', 'wolf', 'wolf', 'wolf', 'villager', 'villager', 'villager', 'villager'],
      { sheriff: false },
    );
    d.s.players[0].alive = false; // seer dead
    d.start();
    d.toStep('seer');
    expect(d.g.promptFor(1)).toBe(null);
    d.until(() => (d.phase as any).sub === 'act');
    const ph = d.phase as any;
    expect(ph.fake).toBe(true);
    const len = ph.until - d.now;
    expect(len).toBeGreaterThanOrEqual(T.fakeAct[0] * 1000);
    expect(len).toBeLessThanOrEqual(T.fakeAct[1] * 1000);
  });

  it('an alive actor who answers instantly still waits the minimum', () => {
    const d = new Driver(['seer', 'wolf', 'villager', 'villager', 'villager'], { sheriff: false });
    d.start();
    d.toStep('seer');
    const t0 = d.now;
    d.act(1, { type: 'pick', step: 'seer', targets: [2] });
    d.until(() => (d.phase as any).sub === 'close');
    expect(d.now - t0).toBeGreaterThanOrEqual(T.minAct * 1000);
  });

  it('nobody but the actor gets a night prompt', () => {
    const d = new Driver(['seer', 'witch', 'wolf', 'wolf', 'villager', 'villager'], { sheriff: false });
    d.start();
    d.toStep('wolves');
    for (const s of [1, 2, 5, 6]) expect(d.g.promptFor(s)).toBe(null);
    expect(d.g.promptFor(3)?.kind).toBe('wolves');
    d.wolves(5);
    d.toStep('witch');
    for (const s of [1, 3, 4, 5, 6]) expect(d.g.promptFor(s)).toBe(null);
    d.toStep('seer');
    for (const s of [2, 3, 4, 5, 6]) expect(d.g.promptFor(s)).toBe(null);
  });

  it('public audio never contains private numbers at night', () => {
    const d = new Driver(['seer', 'witch', 'hunter', 'guard', 'wolf', 'wolf', 'villager', 'villager'], { sheriff: false });
    d.start();
    d.pick(4, 'guard', [7]);
    d.wolves(7);
    d.witch(2, 7, null);
    d.pick(1, 'seer', [5]);
    d.toDay();
    const nightAnn = d.s.announcements.filter((a) => a.text !== '天亮了，请所有玩家睁眼。');
    for (const a of nightAnn) {
      expect(a.text).not.toMatch(/\d/);
      expect(a.clips.some((c) => /^n\d+$/.test(c))).toBe(false);
    }
  });

  it('unannounced night deaths stay hidden from everyone, including the victim', () => {
    const d = new Driver(['seer', 'witch', 'wolf', 'wolf', 'villager', 'villager', 'villager'], {});
    d.start();
    d.wolves(5);
    d.toDay();
    d.toPhase('signup');
    expect(d.g.publicSeatInfo(5).alive).toBe(true);
    expect(d.g.promptFor(5)?.kind).toBe('signup');
  });
});

describe('information on the role card', () => {
  it('wolves see teammates with their special roles; villagers see nothing', () => {
    const d = new Driver(['seer', 'whitewolfking', 'wolf', 'wolfking', 'villager', 'villager'], { sheriff: false });
    expect(d.g.privateInfo(3).join()).toContain('2号（白狼王）');
    expect(d.g.privateInfo(3).join()).toContain('4号（狼王）');
    expect(d.g.privateInfo(5).join()).not.toMatch(/\d号/);
  });
});
