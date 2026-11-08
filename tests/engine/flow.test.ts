import { describe, expect, it } from 'vitest';
import type { RoleId } from '../../shared/roles.ts';
import { Driver } from './driver.ts';

// 1预言家 2女巫 3猎人 4守卫 5-8狼人 9-12平民
const YNLS: RoleId[] = ['seer', 'witch', 'hunter', 'guard', 'wolf', 'wolf', 'wolf', 'wolf', 'villager', 'villager', 'villager', 'villager'];
// 1预言家 2女巫 3猎人 4白神 5白狼王 6-8狼人 9-12平民
const YNLB_WWK: RoleId[] = ['seer', 'witch', 'hunter', 'whitegod', 'whitewolfking', 'wolf', 'wolf', 'wolf', 'villager', 'villager', 'villager', 'villager'];

function signup(d: Driver, joiners: number[]): void {
  d.toPhase('signup');
  for (const s of d.alive()) {
    if (d.phase.kind !== 'signup') break;
    d.act(s, { type: 'signup', join: joiners.includes(s) });
  }
}

/** night 1 where nothing interesting happens except an optional wolf kill */
function quietNight(d: Driver, kill: number | null = null): void {
  d.wolves(kill);
  d.toDay();
}

describe('night 1 and sheriff election', () => {
  it('runs a standard first day', () => {
    const d = new Driver(YNLS);
    d.start();
    expect(d.phase.kind).toBe('night');
    d.pick(4, 'guard', [9]);
    d.wolves(9);
    d.witch(2, null, null);
    d.pick(1, 'seer', [5]);
    expect(d.s.players[0].checks).toEqual([{ night: 1, seat: 5, result: '狼人' }]);
    d.toDay();
    signup(d, [1, 5]);
    expect(d.phase.kind).toBe('speech');
    const ph = d.phase as any;
    expect(ph.context).toBe('sheriff');
    expect(ph.order.slice().sort()).toEqual([1, 5]);
    d.endSpeeches();
    expect(d.phase.kind).toBe('vote');
    expect((d.phase as any).voters).not.toContain(1);
    expect((d.phase as any).voters).not.toContain(5);
    d.voteAll(1);
    expect(d.s.sheriff).toBe(1);
    // guarded → peaceful night
    d.until(() => d.phase.kind === 'orderChoice');
    expect(d.announcements()).toContain('昨天晚上是平安夜。');
    d.act(1, { type: 'order', dir: 'cw' });
    const sp = d.phase as any;
    expect(sp.context).toBe('discussion');
    expect(sp.order[0]).toBe(2);
    expect(sp.order[sp.order.length - 1]).toBe(1);
    d.endSpeeches();
    expect(d.phase.kind).toBe('vote');
    d.voteAll(5);
    expect(d.s.players[4].alive).toBe(false);
    expect(d.phase.kind).toBe('deathSkills');
    d.skipSkills();
    expect(d.phase.kind).toBe('speech');
    expect((d.phase as any).context).toBe('lastWords');
    d.endSpeeches();
    expect(d.phase.kind).toBe('night');
    expect(d.s.night).toBe(2);
  });

  it('players killed on night 1 can still run for sheriff, and pass the badge when announced', () => {
    const d = new Driver(YNLS);
    d.start();
    quietNight(d, 1); // seer dies tonight, not yet announced
    signup(d, [1, 9]);
    d.endSpeeches();
    d.voteAll(1);
    expect(d.s.sheriff).toBe(1);
    d.toPhase('deathSkills');
    expect(d.s.players[0].alive).toBe(false);
    const entry = (d.phase as any).entries.find((e: any) => e.seat === 1);
    expect(entry.badge).toBe(true);
    d.act(1, { type: 'badge', target: 9 });
    expect(d.s.sheriff).toBe(9);
    // first-night death gets last words
    expect(d.phase.kind).toBe('speech');
    expect((d.phase as any).context).toBe('lastWords');
    expect((d.phase as any).order).toEqual([1]);
  });

  it('only one candidate is elected directly; nobody running loses the badge', () => {
    const d = new Driver(YNLS);
    d.start();
    quietNight(d);
    signup(d, [3]);
    expect(d.s.sheriff).toBe(3);

    const e = new Driver(YNLS);
    e.start();
    quietNight(e);
    signup(e, []);
    expect(e.s.sheriff).toBe(null);
    expect(e.s.badgeLost).toBe(true);
  });

  it('withdrawing (退水) removes the candidate and their vote; last one standing wins', () => {
    const d = new Driver(YNLS);
    d.start();
    quietNight(d);
    signup(d, [1, 5, 9]);
    d.act(9, { type: 'withdraw' });
    d.act(5, { type: 'withdraw' });
    expect(d.s.sheriff).toBe(1);
    expect(d.s.election?.withdrawn).toEqual([9, 5]);
  });

  it('withdrawn candidates cannot vote', () => {
    const d = new Driver(YNLS);
    d.start();
    quietNight(d);
    signup(d, [1, 5, 9]);
    d.act(9, { type: 'withdraw' });
    d.endSpeeches();
    expect(d.phase.kind).toBe('vote');
    expect((d.phase as any).voters).not.toContain(9);
  });

  it('a sheriff tie goes to PK, a second tie loses the badge', () => {
    const d = new Driver(YNLS);
    d.start();
    quietNight(d);
    signup(d, [1, 5]);
    d.endSpeeches();
    // voters: 2,3,4,6,7,8,9,10,11,12 → 5 each
    const v = (d.phase as any).voters as number[];
    const half = v.slice(0, 5);
    d.voteAll(1, Object.fromEntries(v.filter((x) => !half.includes(x)).map((x) => [x, 5])));
    expect(d.phase.kind).toBe('speech');
    expect((d.phase as any).context).toBe('sheriffPk');
    d.endSpeeches();
    expect((d.phase as any).context).toBe('sheriffPk');
    d.voteAll(1, Object.fromEntries(v.filter((x) => !half.includes(x)).map((x) => [x, 5])));
    expect(d.s.sheriff).toBe(null);
    expect(d.s.badgeLost).toBe(true);
  });

  it('everyone abstaining loses the badge', () => {
    const d = new Driver(YNLS);
    d.start();
    quietNight(d);
    signup(d, [1, 5]);
    d.endSpeeches();
    d.voteAll(null);
    expect(d.s.badgeLost).toBe(true);
  });
});

describe('self-destruct and the badge (双爆吞警徽)', () => {
  it('first 自爆 postpones the election, night deaths are still announced, next day resumes', () => {
    const d = new Driver(YNLS);
    d.start();
    quietNight(d, 9);
    signup(d, [1, 5, 10]);
    d.act(5, { type: 'selfDestruct', target: null });
    expect(d.s.players[4].alive).toBe(false);
    expect(d.s.election?.status).toBe('suspended');
    expect(d.s.election?.candidates.sort()).toEqual([1, 10]);
    // night deaths are announced, first-night death has last words, then night
    d.toPhase('deathSkills');
    expect(d.s.players[8].alive).toBe(false);
    d.skipSkills();
    expect((d.phase as any).context).toBe('lastWords');
    d.endSpeeches();
    expect(d.phase.kind).toBe('night');
    expect(d.s.night).toBe(2);
    // day 2: election resumes at the withdraw stage
    quietNight(d, null);
    d.toPhase('withdraw');
    expect(d.lastAnnouncement()).toContain('警长竞选继续');
    d.owner({ type: 'next' });
    expect(d.phase.kind).toBe('vote');
    expect((d.phase as any).context).toBe('sheriff');
    expect((d.phase as any).candidates.sort()).toEqual([1, 10]);
    d.voteAll(10);
    expect(d.s.sheriff).toBe(10);
  });

  it('second 自爆 during the resumed election swallows the badge', () => {
    const d = new Driver(YNLS);
    d.start();
    quietNight(d);
    signup(d, [1, 5]);
    d.act(5, { type: 'selfDestruct', target: null });
    d.until(() => d.phase.kind === 'night' && d.s.night === 2);
    quietNight(d);
    d.toPhase('withdraw');
    d.act(6, { type: 'selfDestruct', target: null });
    expect(d.s.badgeLost).toBe(true);
    expect(d.s.election?.status).toBe('done');
    // skips the rest of day 2 (no exile vote)
    d.until(() => d.phase.kind === 'night');
    expect(d.s.night).toBe(3);
  });

  it('single-爆 rule loses the badge immediately', () => {
    const d = new Driver(YNLS, { badgeSwallow: 'single' });
    d.start();
    quietNight(d);
    signup(d, [1, 5]);
    d.act(5, { type: 'selfDestruct', target: null });
    expect(d.s.badgeLost).toBe(true);
  });

  it('自爆 during the day discussion ends the day without a vote', () => {
    const d = new Driver(YNLS, { sheriff: false });
    d.start();
    quietNight(d);
    d.toPhase('speech');
    d.act(6, { type: 'selfDestruct', target: null });
    d.until(() => d.phase.kind === 'night');
    expect(d.s.night).toBe(2);
    expect(d.s.history.flatMap((h) => h.events).some((e) => e.kind === 'vote')).toBe(false);
  });

  it('cannot self-destruct while voting or as a non-wolf', () => {
    const d = new Driver(YNLS);
    d.start();
    quietNight(d);
    signup(d, [1, 5]);
    expect(d.tryAct(1, { type: 'selfDestruct', target: null })).toBeTruthy();
    d.endSpeeches();
    expect(d.phase.kind).toBe('vote');
    expect(d.tryAct(6, { type: 'selfDestruct', target: null })).toBeTruthy();
  });

  it('白狼王 can take someone; the taken player has no last words', () => {
    const d = new Driver(YNLB_WWK, { sheriff: false });
    d.start();
    quietNight(d);
    d.toPhase('speech');
    d.act(5, { type: 'selfDestruct', target: 1 });
    expect(d.s.players[0].alive).toBe(false);
    expect(d.s.players[0].death?.causes).toEqual(['whitewolf']);
    expect(d.s.players[4].revealed).toBe(true);
    d.until(() => d.phase.kind === 'night');
    expect(d.s.history.flatMap((h) => h.events).map((e) => e.text)).toContain('5号自爆（白狼王），带走1号');
  });

  it('a poisoned 白狼王 can self-destruct on the badge stage but cannot take anyone (吞毒自爆)', () => {
    const d = new Driver(YNLB_WWK);
    d.start();
    d.wolves(9);
    d.witch(2, null, 5); // poison the 白狼王
    d.toStep('wwkStatus');
    const pr = d.g.promptFor(5) as any;
    expect(pr.kind).toBe('status');
    expect(pr.lines[0]).toContain('不能');
    d.toDay();
    signup(d, [1, 5]);
    expect(d.tryAct(5, { type: 'selfDestruct', target: 1 })).toBe('你今晚被毒，自爆不能带人');
    d.act(5, { type: 'selfDestruct', target: null });
    // the poison death is swallowed: only 9 is announced
    d.toPhase('deathSkills');
    expect(d.lastAnnouncement()).toBe('请出局的玩家确认是否发动技能。');
    expect(d.announcements()).toContain('昨天晚上，9号玩家死亡。');
  });
});

describe('witch, guard, hunter', () => {
  it('同守同救 kills the target', () => {
    const d = new Driver(YNLS, { sheriff: false });
    d.start();
    d.pick(4, 'guard', [9]);
    d.wolves(9);
    d.witch(2, 9, null);
    d.toDay();
    d.toPhase('deathSkills');
    expect(d.s.players[8].alive).toBe(false);
  });

  it('the witch cannot save herself and cannot use both potions in one night', () => {
    const d = new Driver(YNLS, { sheriff: false });
    d.start();
    d.wolves(2);
    d.toStep('witch');
    const pr = d.g.promptFor(2) as any;
    expect(pr.kind).toBe('witch');
    expect(pr.knifed).toEqual([2]);
    expect(pr.saveOptions).toEqual([]);
    expect(pr.saveBlockedReason).toBe('女巫不能自救');
    expect(d.tryAct(2, { type: 'witch', save: 2, poison: null })).toBe('女巫不能自救');
    expect(d.tryAct(2, { type: 'witch', save: null, poison: 5 })).toBe(null);
  });

  it('witch self-save is allowed when the rule says so', () => {
    const d = new Driver(YNLS, { sheriff: false, witchSelfSave: 'firstNight' });
    d.start();
    d.wolves(2);
    d.toStep('witch');
    expect(d.tryAct(2, { type: 'witch', save: 2, poison: null })).toBe(null);
  });

  it('after using the antidote the witch no longer learns the knife target', () => {
    const d = new Driver(YNLS, { sheriff: false });
    d.start();
    d.wolves(9);
    d.witch(2, 9, null);
    d.toDay();
    d.toPhase('speech');
    d.endSpeeches();
    d.voteAll(null);
    d.until(() => d.phase.kind === 'night');
    d.wolves(10);
    d.toStep('witch');
    const pr = d.g.promptFor(2) as any;
    expect(pr.knifed).toBe(null);
    expect(pr.antidote).toBe(false);
    expect(pr.poison).toBe(true);
  });

  it('a guard cannot guard the same player two nights in a row', () => {
    const d = new Driver(YNLS, { sheriff: false });
    d.start();
    d.pick(4, 'guard', [9]);
    quietNight(d);
    d.toPhase('speech');
    d.endSpeeches();
    d.voteAll(null);
    d.until(() => d.phase.kind === 'night');
    d.toStep('guard');
    expect(d.tryAct(4, { type: 'pick', step: 'guard', targets: [9] })).toBe('不能选择这名玩家');
    expect(d.tryAct(4, { type: 'pick', step: 'guard', targets: [4] })).toBe(null);
  });

  it('a knifed hunter can shoot at dawn; the shot player gets last words', () => {
    const d = new Driver(YNLS, { sheriff: false });
    d.start();
    d.toStep('hunterStatus');
    d.wolves; // no-op
    const d2 = new Driver(YNLS, { sheriff: false });
    d2.start();
    d2.wolves(3);
    d2.toStep('hunterStatus');
    expect((d2.g.promptFor(3) as any).lines[0]).toBe('你的开枪状态：可以开枪');
    d2.toDay();
    d2.toPhase('deathSkills');
    const pr = d2.g.promptFor(3) as any;
    expect(pr.canShoot).toBe(true);
    d2.act(3, { type: 'shoot', target: 6 });
    expect(d2.s.players[5].alive).toBe(false);
    expect(d2.s.players[2].revealed).toBe(true);
    d2.skipSkills();
    expect((d2.phase as any).context).toBe('lastWords');
    expect((d2.phase as any).order).toEqual([3, 6]);
  });

  it('a poisoned hunter cannot shoot and knows it at night', () => {
    const d = new Driver(YNLS, { sheriff: false });
    d.start();
    d.wolves(null);
    d.witch(2, null, 3);
    d.toStep('hunterStatus');
    expect((d.g.promptFor(3) as any).lines[0]).toBe('你的开枪状态：不能开枪');
    d.toDay();
    d.toPhase('deathSkills');
    expect((d.g.promptFor(3) as any).canShoot).toBe(false);
    expect(d.tryAct(3, { type: 'shoot', target: 6 })).toBeTruthy();
  });

  it('an exiled hunter can shoot', () => {
    const d = new Driver(YNLS, { sheriff: false });
    d.start();
    quietNight(d);
    d.toPhase('speech');
    d.endSpeeches();
    d.voteAll(3);
    expect(d.phase.kind).toBe('deathSkills');
    d.act(3, { type: 'shoot', target: 7 });
    expect(d.s.players[6].alive).toBe(false);
  });

  it('the hunter as the last god cannot shoot: the game is already over', () => {
    // 1猎人 2-3狼 4-5平民
    const d = new Driver(['hunter', 'wolf', 'wolf', 'villager', 'villager'], { sheriff: false });
    d.start();
    quietNight(d);
    d.toPhase('speech');
    d.endSpeeches();
    d.voteAll(1);
    expect(d.s.winner).toBe('wolf');
    expect(d.phase.kind).toBe('ended');
  });
});

describe('exile vote', () => {
  it('sheriff vote counts 1.5', () => {
    const d = new Driver(YNLS);
    d.start();
    quietNight(d);
    signup(d, [1]);
    expect(d.s.sheriff).toBe(1);
    d.toPhase('orderChoice');
    d.act(1, { type: 'order', dir: 'ccw' });
    d.endSpeeches();
    // 1 (sheriff) + 2,3,4,9 → 5 ; 5,6,7,8 + 10 → 6 ... make it 4 vs 4 plus sheriff
    const votes: Record<number, number | null> = {};
    for (const s of [1, 2, 3, 4]) votes[s] = 5;
    for (const s of [5, 6, 7, 8]) votes[s] = 9;
    for (const s of [9, 10, 11, 12]) votes[s] = null;
    d.voteAll(null, votes);
    expect(d.s.players[4].alive).toBe(false);
    const ev = d.s.history.flatMap((h) => h.events).find((e) => e.votes?.context === 'exile');
    expect(ev?.votes?.rows[0]).toEqual({ target: 5, voters: [1, 2, 3, 4], score: 4.5, curse: false });
  });

  it('tie → PK → tie means nobody is exiled', () => {
    const d = new Driver(YNLS, { sheriff: false });
    d.start();
    quietNight(d);
    d.toPhase('speech');
    d.endSpeeches();
    const votes: Record<number, number | null> = {};
    for (const s of [1, 2, 3]) votes[s] = 5;
    for (const s of [6, 7, 8]) votes[s] = 9;
    d.voteAll(null, votes);
    expect((d.phase as any).context).toBe('exilePk');
    expect((d.phase as any).order).toEqual([5, 9]);
    d.endSpeeches();
    expect((d.phase as any).context).toBe('exilePk');
    expect((d.phase as any).candidates).toEqual([5, 9]);
    expect((d.phase as any).voters).not.toContain(5);
    const v2: Record<number, number | null> = {};
    for (const s of [1, 2, 3]) v2[s] = 5;
    for (const s of [6, 7, 8]) v2[s] = 9;
    d.voteAll(null, v2);
    expect(d.alive().length).toBe(12);
    expect(d.lastAnnouncement()).toBe('今天无人出局。');
  });

  it('白神 flips when exiled', () => {
    const d = new Driver(YNLB_WWK, { sheriff: false });
    d.start();
    quietNight(d);
    d.toPhase('speech');
    d.endSpeeches();
    d.voteAll(4);
    expect(d.s.players[3].revealed).toBe(true);
    expect(d.announcements()).toContain('4号玩家出局，翻牌为白神，请留遗言。');
  });

  it('cannot vote for yourself', () => {
    const d = new Driver(YNLS, { sheriff: false });
    d.start();
    quietNight(d);
    d.toPhase('speech');
    d.endSpeeches();
    expect(d.tryAct(5, { type: 'vote', target: 5 })).toBe('不能投给自己');
  });
});

describe('victory (屠边)', () => {
  it('wolves win by killing all villagers', () => {
    // 1预言家 2狼 3平民
    const d = new Driver(['seer', 'wolf', 'villager', 'wolf', 'villager', 'seer'].slice(0, 5) as RoleId[], {
      sheriff: false,
    });
    // seats: 1 seer, 2 wolf, 3 villager, 4 wolf, 5 villager
    d.start();
    quietNight(d, 3);
    d.toPhase('deathSkills');
    d.skipSkills();
    d.endSpeeches();
    d.endSpeeches();
    d.voteAll(5);
    expect(d.s.winner).toBe('wolf');
    expect(d.s.winReason).toContain('屠民');
  });

  it('good wins when the last wolf is exiled', () => {
    const d = new Driver(['seer', 'wolf', 'villager', 'villager', 'villager'], { sheriff: false });
    d.start();
    quietNight(d);
    d.toPhase('speech');
    d.endSpeeches();
    d.voteAll(2);
    expect(d.s.winner).toBe('good');
  });

  it('simultaneous conditions follow the configured rule', () => {
    // 1女巫 2狼 3平民: wolves kill the villager, witch poisons the wolf
    for (const [rule, expected] of [
      ['wolf', 'wolf'],
      ['good', 'good'],
      ['draw', 'draw'],
    ] as const) {
      const d = new Driver(['witch', 'wolf', 'villager', 'villager'], { sheriff: false, simultaneousWin: rule });
      d.start();
      // kill 3 then 4 over two nights: night 1 kill 3, witch poisons nobody
      d.wolves(3);
      d.witch(1, null, null);
      d.toDay();
      d.toPhase('deathSkills');
      d.skipSkills();
      d.endSpeeches();
      d.endSpeeches();
      d.voteAll(null);
      d.until(() => d.phase.kind === 'night');
      d.wolves(4);
      d.witch(1, null, 2);
      d.toDay();
      d.until(() => d.phase.kind === 'ended');
      expect(d.s.winner).toBe(expected);
    }
  });

  it('a game decided at night skips the election and ends at the announcement', () => {
    const d = new Driver(['witch', 'wolf', 'villager', 'wolf'], {});
    d.start();
    d.wolves(3);
    d.toDay();
    d.until(() => d.phase.kind === 'ended');
    expect(d.s.winner).toBe('wolf');
    expect(d.s.election).toBe(null);
  });
});

describe('crow, dreamer, mixed', () => {
  it('the crow curse adds a vote', () => {
    const roles: RoleId[] = ['crow', 'witch', 'hunter', 'seer', 'wolf', 'wolf', 'wolf', 'wolf', 'villager', 'villager', 'villager', 'villager'];
    const d = new Driver(roles, { sheriff: false });
    d.start();
    d.wolves(null);
    d.pick(1, 'crow', [9]);
    d.toDay();
    d.toPhase('speech');
    d.endSpeeches();
    const votes: Record<number, number | null> = {};
    for (const s of [1, 2, 3]) votes[s] = 5;
    for (const s of [6, 7, 8]) votes[s] = 9;
    d.voteAll(null, votes);
    expect(d.s.players[8].alive).toBe(false); // 3 votes + curse = 4 > 3
    const ev = d.s.history.flatMap((h) => h.events).find((e) => e.votes?.context === 'exile');
    expect(ev?.votes?.rows[0]).toMatchObject({ target: 9, score: 4, curse: true });
  });

  it('the crow cannot curse the same player twice in a row; must curse someone', () => {
    const roles: RoleId[] = ['crow', 'wolf', 'villager', 'villager', 'villager'];
    const d = new Driver(roles, { sheriff: false });
    d.start();
    d.toStep('crow');
    expect(d.tryAct(1, { type: 'pick', step: 'crow', targets: [] })).toBe('必须选择一名玩家');
    d.act(1, { type: 'pick', step: 'crow', targets: [3] });
    d.toDay();
    d.toPhase('speech');
    d.endSpeeches();
    // the curse alone is one vote: 4 gets 3 votes, 3 gets the curse
    d.voteAll(null, { 1: 4, 2: 4, 5: 4 });
    expect(d.s.players[3].alive).toBe(false);
    d.skipSkills();
    d.endSpeeches();
    d.toStep('crow');
    expect(d.tryAct(1, { type: 'pick', step: 'crow', targets: [3] })).toBe('不能选择这名玩家');
  });

  it('dreamer: sleepwalker immune to the knife; two nights in a row kills; dreamer death takes the sleepwalker', () => {
    // 1摄梦人 2狼 3狼 4-7平民 8预言家
    const roles: RoleId[] = ['dreamer', 'wolf', 'wolf', 'villager', 'villager', 'villager', 'villager', 'seer'];
    const d = new Driver(roles, { sheriff: false });
    d.start();
    d.pick(1, 'dreamer', [4]);
    d.wolves(4);
    d.toDay();
    d.toPhase('speech');
    expect(d.s.players[3].alive).toBe(true); // immune
    d.endSpeeches();
    d.voteAll(null);
    d.until(() => d.phase.kind === 'night');
    d.pick(1, 'dreamer', [4]); // second night in a row
    d.wolves(null);
    d.toDay();
    d.toPhase('deathSkills');
    expect(d.s.players[3].death?.causes).toEqual(['dream']);
    d.skipSkills();
    d.endSpeeches();
    d.voteAll(null);
    d.until(() => d.phase.kind === 'night');
    d.pick(1, 'dreamer', [5]);
    d.wolves(1); // kill the dreamer → 5 dies too
    d.toDay();
    d.toPhase('deathSkills');
    expect(d.s.players[0].alive).toBe(false);
    expect(d.s.players[4].death?.causes).toEqual(['dream']);
  });

  it('dreamer cannot dream themself and must pick someone', () => {
    const d = new Driver(['dreamer', 'wolf', 'villager', 'villager', 'villager'], { sheriff: false });
    d.start();
    d.toStep('dreamer');
    expect(d.tryAct(1, { type: 'pick', step: 'dreamer', targets: [1] })).toBe('不能选择这名玩家');
    expect(d.tryAct(1, { type: 'pick', step: 'dreamer', targets: [] })).toBe('必须选择一名玩家');
  });

  it('dreamer timeout picks someone at random', () => {
    const d = new Driver(['dreamer', 'wolf', 'villager', 'villager', 'villager'], { sheriff: false });
    d.start();
    d.toStep('dreamer');
    d.until(() => d.nightStep() !== 'dreamer');
    expect(d.s.nights[0].dream).toBeGreaterThan(1);
  });

  it('mixed: seer sees 好人, counts as villager, wins with the model', () => {
    // 1混血儿 2预言家 3狼 4平民 5狼
    const roles: RoleId[] = ['mixed', 'seer', 'wolf', 'villager', 'wolf'];
    const d = new Driver(roles, { sheriff: false });
    d.start();
    d.pick(1, 'mixed', [3]);
    d.wolves(null);
    d.pick(2, 'seer', [1]);
    expect(d.s.players[1].checks[0].result).toBe('好人');
    d.toDay();
    d.toPhase('speech');
    d.endSpeeches();
    d.voteAll(4); // villagers: 1 (mixed) and 4
    d.until(() => d.phase.kind !== 'deathSkills' || true);
    d.skipSkills();
    d.endSpeeches();
    d.wolves(1);
    d.toDay();
    d.until(() => d.phase.kind === 'ended');
    expect(d.s.winner).toBe('wolf');
    const res = d.g.result(() => null)!;
    expect(res.players.find((p) => p.seat === 1)?.won).toBe(true); // model is a wolf
    expect(res.players.find((p) => p.seat === 2)?.won).toBe(false);
  });
});
