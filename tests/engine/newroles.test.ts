// Interaction tests for 骑士, 狼美人, 舞者, 假面, 魔术师, 诡术师, 狼术师 and 定序王子,
// alone and combined with the other roles.
import { describe, expect, it } from 'vitest';
import { mechSkillFor, ROLES, type RoleId } from '../../shared/roles.ts';
import { stepsForNight } from '../../server/game/engine.ts';
import { Driver } from './driver.ts';

const discuss = (d: Driver) => {
  d.toDiscussion();
  return d.phase as any;
};
/** finish the day without exiling anyone */
function quietDay(d: Driver): void {
  d.toDiscussion();
  d.endSpeeches();
  if (d.phase.kind === 'vote') d.voteAll(null);
  d.until(() => d.phase.kind === 'night' || d.phase.kind === 'ended');
}
/** ends speeches and waits out timers until `done` */
function runUntil(d: Driver, done: () => boolean): void {
  for (let i = 0; i < 80 && !done(); i++) {
    if (d.phase.kind === 'speech') d.endSpeeches();
    else d.step();
  }
  if (!done()) throw new Error(`not reached; phase=${d.phase.kind}`);
}

/** exile `seat` today (everyone else votes for it) */
function exileToday(d: Driver, seat: number): void {
  d.toDiscussion();
  d.endSpeeches();
  d.voteAll(seat);
}

describe('骑士 (knight)', () => {
  // 1骑士 2预言家 3女巫 4猎人 5狼美人 6狼王 7狼 8白狼王 9-12平民
  const T: RoleId[] = ['knight', 'seer', 'witch', 'hunter', 'wolfbeauty', 'wolfking', 'wolf', 'whitewolfking', 'villager', 'villager', 'villager', 'villager'];

  it('dueling a wolf: the wolf falls without last words and night falls at once', () => {
    const d = new Driver(T, { sheriff: false });
    d.start();
    d.wolves(null);
    d.toDay();
    discuss(d);
    d.act(1, { type: 'duel', target: 7 });
    expect(d.s.players[6].alive).toBe(false);
    expect(d.s.players[6].death?.causes).toEqual(['duel']);
    expect(d.s.players[0].revealed).toBe(true);
    expect(d.announcements()).toContain('7号玩家是狼人，出局。即将进入黑夜。');
    d.until(() => d.phase.kind === 'night');
    expect(d.s.night).toBe(2);
    // no exile vote happened and nobody gave last words
    expect(d.s.history.flatMap((h) => h.events).some((e) => e.votes?.context === 'exile')).toBe(false);
  });

  it('dueling a good player: the knight falls, gives last words, the speeches continue', () => {
    const d = new Driver(T, { sheriff: false });
    d.start();
    d.wolves(null);
    d.toDay();
    const ph = discuss(d);
    const speaker = ph.order[ph.idx];
    d.act(1, { type: 'duel', target: 9 });
    expect(d.s.players[0].alive).toBe(false);
    expect(d.s.players[8].alive).toBe(true);
    d.skipSkills();
    expect((d.phase as any).context).toBe('lastWords');
    expect((d.phase as any).order).toEqual([1]);
    d.endSpeeches();
    const back = d.phase as any;
    expect(back.context).toBe('discussion');
    // the interrupted speaker continues (unless it was the knight himself)
    expect(back.order[back.idx]).toBe(speaker === 1 ? back.order[ph.order.indexOf(1) + 1] : speaker);
    d.endSpeeches();
    expect(d.phase.kind).toBe('vote');
    expect((d.phase as any).voters).not.toContain(1);
  });

  it('only once, only in exile speeches, never at night, the election or last words', () => {
    const d = new Driver(T, {});
    d.start();
    d.toStep('wolves');
    expect(d.tryAct(1, { type: 'duel', target: 7 })).toBe('只能在放逐发言环节决斗');
    d.wolves(9);
    d.toDay();
    d.toPhase('signup');
    for (const s of d.alive()) if (d.phase.kind === 'signup') d.act(s, { type: 'signup', join: s === 1 || s === 2 });
    expect(d.phase.kind).toBe('speech');
    expect(d.tryAct(1, { type: 'duel', target: 7 })).toBe('只能在放逐发言环节决斗');
    d.endSpeeches();
    d.voteAll(1);
    d.toPhase('deathSkills');
    d.skipSkills();
    expect((d.phase as any).context).toBe('lastWords');
    expect(d.tryAct(1, { type: 'duel', target: 7 })).toBe('只能在放逐发言环节决斗');
    d.toDiscussion();
    d.act(1, { type: 'duel', target: 10 });
    d.skipSkills();
    d.endSpeeches();
    expect(d.tryAct(1, { type: 'duel', target: 7 })).toBeTruthy();
    expect(d.g.skillView(1).duel?.available).toBe(false);
  });

  it('the 狼王 dueled cannot shoot, the 白狼王 dueled takes no one, the 狼美人 dueled charms no one', () => {
    const d = new Driver(T, { sheriff: false });
    d.start();
    d.wolves(null);
    d.pick(5, 'beauty', [10]);
    d.toDay();
    discuss(d);
    d.act(1, { type: 'duel', target: 5 });
    expect(d.s.players[4].alive).toBe(false);
    expect(d.s.players[9].alive).toBe(true); // no 殉情 after a duel
    expect(d.g.canShootFor(d.g.p(6), ['duel'])).toBe(false);
  });

  it('dueling the sheriff wolf hands the badge over before night', () => {
    const d = new Driver(T, {});
    d.start();
    d.wolves(null);
    d.toDay();
    d.toPhase('signup');
    for (const s of d.alive()) if (d.phase.kind === 'signup') d.act(s, { type: 'signup', join: s === 7 });
    expect(d.s.sheriff).toBe(7);
    d.toPhase('orderChoice');
    d.act(7, { type: 'order', dir: 'cw' });
    d.act(1, { type: 'duel', target: 7 });
    expect(d.phase.kind).toBe('deathSkills');
    d.act(7, { type: 'badge', target: 6 });
    d.until(() => d.phase.kind === 'night');
    expect(d.s.sheriff).toBe(6);
  });

  it('dueling the last wolf wins the game; a good 混血儿 or good 盗宝 makes the knight fall', () => {
    const d = new Driver(['knight', 'wolf', 'villager', 'villager', 'seer'], { sheriff: false });
    d.start();
    d.wolves(null);
    d.toDay();
    discuss(d);
    d.act(1, { type: 'duel', target: 2 });
    expect(d.s.winner).toBe('good');

    const m = new Driver(['knight', 'wolf', 'mixed', 'villager', 'seer', 'wolf'], { sheriff: false });
    m.start();
    m.pick(3, 'mixed', [2]);
    m.wolves(null);
    m.toDay();
    discuss(m);
    m.act(1, { type: 'duel', target: 3 }); // 混血儿 following a wolf is still a villager card
    expect(m.s.players[0].alive).toBe(false);
  });

  it('dueling during the exile PK resumes the PK speeches', () => {
    const d = new Driver(T, { sheriff: false });
    d.start();
    d.wolves(null);
    d.toDay();
    d.toDiscussion();
    d.endSpeeches();
    const v: Record<number, number | null> = {};
    for (const s of [2, 3, 4]) v[s] = 9;
    for (const s of [6, 7, 8]) v[s] = 10;
    d.voteAll(null, v);
    expect((d.phase as any).context).toBe('exilePk');
    d.act(1, { type: 'duel', target: 11 });
    d.skipSkills();
    d.endSpeeches(); // knight's last words
    expect((d.phase as any).context).toBe('exilePk');
    d.endSpeeches();
    expect((d.phase as any).context).toBe('exilePk');
    expect((d.phase as any).kind).toBe('vote');
  });

  it('a PK knight who loses his duel leaves the other PK candidate as the result (定序王子 may still void it)', () => {
    const d = new Driver(T, { sheriff: false });
    d.start();
    d.wolves(null);
    d.toDay();
    d.toDiscussion();
    d.endSpeeches();
    const v: Record<number, number | null> = {};
    for (const s of [2, 3, 4]) v[s] = 1;
    for (const s of [6, 7, 8]) v[s] = 10;
    d.voteAll(null, v);
    expect((d.phase as any).context).toBe('exilePk');
    d.act(1, { type: 'duel', target: 11 }); // 11 is good: the knight goes out
    d.skipSkills();
    runUntil(d, () => !d.s.players[9].alive || d.phase.kind === 'night');
    expect(d.s.players[0].alive).toBe(false);
    expect(d.s.players[9].alive).toBe(false); // 10 is exiled without another vote
    expect(d.s.history.flatMap((h) => h.events.map((e) => e.text)).join('\n')).toMatch(/10号被放逐出局/);

    // 1骑士 2定序王子 3狼 4狼 5预言家 6-7平民
    const p = new Driver(['knight', 'prince', 'wolf', 'wolf', 'seer', 'villager', 'villager'], { sheriff: false });
    p.start();
    p.wolves(null);
    p.toDay();
    p.toDiscussion();
    p.endSpeeches();
    p.voteAll(null, { 3: 1, 4: 1, 5: 6, 7: 6 });
    expect((p.phase as any).context).toBe('exilePk');
    p.act(1, { type: 'duel', target: 7 });
    p.skipSkills();
    runUntil(p, () => p.phase.kind === 'princeWindow');
    expect((p.phase as any).target).toBe(6);
    p.act(2, { type: 'prince', use: true });
    expect((p.phase as any).context).toBe('prince');
  });

  it('a wounded 蒙面人 still goes out before night when a duel ends the day', () => {
    const d = new Driver(['knight', 'masked', 'wolf', 'wolf', 'villager', 'villager', 'seer'], { sheriff: false });
    d.start();
    d.wolves(2);
    d.toDay();
    discuss(d);
    expect(d.s.wounded.map((w) => w.seat)).toEqual([2]);
    d.act(1, { type: 'duel', target: 3 });
    d.until(() => d.phase.kind === 'night');
    expect(d.s.players[1].alive).toBe(false);
  });
});

describe('狼美人 (wolf beauty)', () => {
  // 1狼美人 2狼 3狼 4预言家 5女巫 6猎人 7守卫 8-10平民
  const T: RoleId[] = ['wolfbeauty', 'wolf', 'wolf', 'seer', 'witch', 'hunter', 'guard', 'villager', 'villager', 'villager'];

  it('exiled: the charmed player dies with her, without last words', () => {
    const d = new Driver(T, { sheriff: false });
    d.start();
    d.wolves(null);
    d.pick(1, 'beauty', [8]);
    d.toDay();
    exileToday(d, 1);
    expect(d.s.players[7].death?.causes).toEqual(['lovesick']);
    expect(d.announcements()).toContain('8号玩家殉情出局。');
    d.skipSkills();
    expect((d.phase as any).order).toEqual([1]); // only the beauty has last words
  });

  it('poisoned at night: the charmed player dies the same night', () => {
    const d = new Driver(T, { sheriff: false });
    d.start();
    d.wolves(null);
    d.pick(1, 'beauty', [9]);
    d.witch(5, null, 1);
    d.toDay();
    d.toPhase('deathSkills');
    expect(d.s.players[0].death?.causes).toEqual(['poison']);
    expect(d.s.players[8].death?.causes).toEqual(['lovesick']);
    expect(d.announcements()).toContain('昨天晚上，1号、9号玩家死亡。');
  });

  it('a charmed hunter dying of 殉情 cannot shoot; a charmed sheriff passes the badge', () => {
    const d = new Driver(T, {});
    d.start();
    d.wolves(null);
    d.pick(1, 'beauty', [6]);
    d.toDay();
    d.toPhase('signup');
    for (const s of d.alive()) if (d.phase.kind === 'signup') d.act(s, { type: 'signup', join: s === 6 });
    expect(d.s.sheriff).toBe(6);
    d.toPhase('orderChoice');
    d.act(6, { type: 'order', dir: 'cw' });
    d.endSpeeches();
    d.voteAll(1);
    const pr = d.g.promptFor(6) as any;
    expect(pr.canShoot).toBe(false);
    expect(pr.badge).toBe(true);
  });

  it('charm rules: not herself, not the same player twice in a row; the pack cannot knife her', () => {
    const d = new Driver(T, { sheriff: false });
    d.start();
    d.toStep('wolves');
    expect((d.g.promptFor(2) as any).options).not.toContain(1);
    expect(d.tryAct(2, { type: 'wolfPick', target: 1, confirm: true })).toBe('不能选择这名玩家');
    d.wolves(null);
    d.toStep('beauty');
    expect(d.tryAct(1, { type: 'pick', step: 'beauty', targets: [1] })).toBe('不能选择这名玩家');
    d.act(1, { type: 'pick', step: 'beauty', targets: [8] });
    d.toDay();
    quietDay(d);
    d.wolves(null);
    d.toStep('beauty');
    expect(d.tryAct(1, { type: 'pick', step: 'beauty', targets: [8] })).toBe('不能选择这名玩家');
    expect(d.g.skillView(1).selfDestruct).toBe(null); // cannot self-destruct
  });

  it('a charm persists when she skips a night', () => {
    const d = new Driver(T, { sheriff: false });
    d.start();
    d.wolves(null);
    d.pick(1, 'beauty', [8]);
    d.toDay();
    quietDay(d);
    d.wolves(null);
    d.pick(1, 'beauty', []);
    d.toDay();
    exileToday(d, 1);
    expect(d.s.players[7].alive).toBe(false);
  });

  it('shot by the hunter: no 殉情', () => {
    const d = new Driver(T, { sheriff: false });
    d.start();
    d.wolves(6);
    d.pick(1, 'beauty', [8]);
    d.toDay();
    d.toPhase('deathSkills');
    d.act(6, { type: 'shoot', target: 1 });
    expect(d.s.players[0].alive).toBe(false);
    expect(d.s.players[7].alive).toBe(true);
  });

  it('as the last wolf, exiled while charming the last god: the wolves win (whatever the tie rule)', () => {
    // 1狼美人 2预言家 3-4平民
    const d = new Driver(['wolfbeauty', 'seer', 'villager', 'villager'], { sheriff: false, simultaneousWin: 'good' });
    d.start();
    d.toStep('wolves');
    d.act(1, { type: 'wolfPick', target: null, confirm: true });
    d.pick(1, 'beauty', [2]);
    d.toDay();
    exileToday(d, 1);
    expect(d.s.players[1].alive).toBe(false);
    expect(d.s.winner).toBe('wolf');
  });

  it('a sleepwalker beauty survives the poison, so no 殉情 (dream blocks poison)', () => {
    const d = new Driver(['wolfbeauty', 'wolf', 'dreamer', 'witch', 'villager', 'villager', 'villager', 'seer'], { sheriff: false });
    d.start();
    d.pick(3, 'dreamer', [1]);
    d.wolves(null);
    d.pick(1, 'beauty', [5]);
    d.witch(4, null, 1);
    d.toDay();
    d.toPhase('speech');
    expect(d.s.players[0].alive).toBe(true);
    expect(d.s.players[4].alive).toBe(true);
  });
});

describe('舞者 & 假面 (dance floor)', () => {
  // 1舞者 2假面 3狼 4狼 5预言家 6女巫 7白神 8-11平民
  const T: RoleId[] = ['dancer', 'masque', 'wolf', 'wolf', 'seer', 'witch', 'whitegod', 'villager', 'villager', 'villager', 'villager'];

  function toNight2(d: Driver): void {
    d.start();
    d.wolves(null);
    d.toDay();
    quietDay(d);
  }

  it('starts on night 2; three of one side → nothing; mixed → the minority falls', () => {
    const d = new Driver(T, { sheriff: false });
    expect(stepsForNight(d.s.config, 1)).not.toContain('dancer');
    toNight2(d);
    d.pick(1, 'dancer', [8, 9, 3]); // two good + one wolf
    d.toStep('masque');
    d.act(2, { type: 'masqueAct', mask: null, kill: null });
    d.wolves(null);
    d.toDay();
    d.toPhase('deathSkills');
    expect(d.s.players[2].death?.causes).toEqual(['dance']);
    d.skipSkills();
    quietDay(d);
    d.pick(1, 'dancer', [10, 11, 5]); // all good
    d.wolves(null);
    d.toDay();
    d.toPhase('speech');
    expect(d.alive()).toEqual(expect.arrayContaining([10, 11, 5]));
  });

  it('one good dancing with two wolves dies', () => {
    const d = new Driver(T, { sheriff: false });
    toNight2(d);
    d.pick(1, 'dancer', [3, 4, 8]);
    d.wolves(null);
    d.toDay();
    d.toPhase('deathSkills');
    expect(d.s.players[7].death?.causes).toEqual(['dance']);
    expect(d.s.players[2].alive && d.s.players[3].alive).toBe(true);
  });

  it('the dancer on the floor makes the floor knife-immune; each player dances once', () => {
    const d = new Driver(T, { sheriff: false });
    toNight2(d);
    d.pick(1, 'dancer', [1, 8, 9]);
    d.wolves(8);
    d.toDay();
    d.toPhase('speech');
    expect(d.s.players[7].alive).toBe(true);
    quietDay(d);
    d.toStep('dancer');
    const pr = d.g.promptFor(1) as any;
    expect(pr.options).not.toContain(1);
    expect(pr.options).not.toContain(8);
    expect(pr.min).toBe(3);
    expect(d.tryAct(1, { type: 'pick', step: 'dancer', targets: [10, 11] })).toBe('需要选择3名玩家');
  });

  it('假面 verifies the floor and its mask flips a dancer’s side', () => {
    const d = new Driver(T, { sheriff: false });
    toNight2(d);
    d.pick(1, 'dancer', [8, 9, 3]); // good, good, wolf
    d.toStep('masque');
    d.act(2, { type: 'masqueVerify', target: 9 });
    expect((d.g.promptFor(2) as any).verified.result).toBe('9号玩家今晚在舞池中。');
    d.act(2, { type: 'masqueAct', mask: 3, kill: null }); // the wolf dances as good → all good
    d.wolves(null);
    d.toDay();
    d.toPhase('speech');
    expect(d.alive()).toEqual(expect.arrayContaining([8, 9, 3]));
    quietDay(d);
    d.pick(1, 'dancer', [10, 11, 4]);
    d.toStep('masque');
    expect(d.tryAct(2, { type: 'masqueAct', mask: 3, kill: null })).toBe('不能给这名玩家面具'); // not twice in a row
    d.act(2, { type: 'masqueAct', mask: 10, kill: null }); // 10 dances as a wolf: 10 & 4 vs 11
    d.wolves(null);
    d.toDay();
    d.toPhase('deathSkills');
    expect(d.s.players[10].death?.causes).toEqual(['dance']);
  });

  it('the witch cannot poison the dancer or the 假面', () => {
    const d = new Driver(T, { sheriff: false });
    d.start();
    d.wolves(null);
    d.witch(6, null, 2);
    d.toDay();
    d.toPhase('speech');
    expect(d.s.players[1].alive).toBe(true);
    quietDay(d);
    d.wolves(null);
    const e = new Driver(T, { sheriff: false });
    e.start();
    e.wolves(null);
    e.witch(6, null, 1);
    e.toDay();
    e.toPhase('speech');
    expect(e.s.players[0].alive).toBe(true);
  });

  it('假面 takes the knife after the pack is gone', () => {
    const d = new Driver(T, { sheriff: false });
    for (const w of [3, 4]) d.s.players[w - 1].alive = false;
    toNight2(d);
    d.pick(1, 'dancer', []);
    d.toStep('masque');
    const pr = d.g.promptFor(2) as any;
    expect(pr.canKill).toBe(true);
    d.act(2, { type: 'masqueVerify', target: null });
    d.act(2, { type: 'masqueAct', mask: null, kill: 8 });
    d.toDay();
    d.toPhase('deathSkills');
    expect(d.s.players[7].death?.causes).toEqual(['knife']);
  });

  it('dance deaths cannot be guarded or saved and disable the hunter gun', () => {
    const d = new Driver(['dancer', 'wolf', 'wolf', 'hunter', 'guard', 'witch', 'villager', 'villager', 'seer'], { sheriff: false });
    d.start();
    d.wolves(null);
    d.toDay();
    quietDay(d);
    d.pick(1, 'dancer', [4, 2, 3]); // hunter + two wolves → hunter dies
    d.pick(5, 'guard', [4]);
    d.wolves(null);
    d.toDay();
    d.toPhase('deathSkills');
    expect(d.s.players[3].death?.causes).toEqual(['dance']);
    expect((d.g.promptFor(4) as any).canShoot).toBe(false);
  });
});

describe('number swaps (魔术师 / 诡术师 / 狼术师)', () => {
  // 1魔术师 2诡术师 3狼 4狼 5预言家 6女巫 7守卫 8-11平民
  const T: RoleId[] = ['magician', 'trickster', 'wolf', 'wolf', 'seer', 'witch', 'guard', 'villager', 'villager', 'villager', 'villager'];

  it('the knife follows the swap; the witch saves by number', () => {
    const d = new Driver(T, { sheriff: false });
    d.start();
    d.pick(1, 'magician', [8, 9]);
    d.pick(2, 'trickster', []);
    d.wolves(8);
    d.toStep('witch');
    expect((d.g.promptFor(6) as any).knifed).toEqual([8]); // the witch sees the number
    d.act(6, { type: 'witch', save: null, poison: null });
    d.toDay();
    d.toPhase('deathSkills');
    expect(d.s.players[8].alive).toBe(false); // 9 died instead of 8
    expect(d.s.players[7].alive).toBe(true);

    const e = new Driver(T, { sheriff: false });
    e.start();
    e.pick(1, 'magician', [8, 9]);
    e.pick(2, 'trickster', []);
    e.wolves(8);
    e.witch(6, 8, null); // saving number 8 saves the player it points to (9)
    e.toDay();
    e.toPhase('speech');
    expect(e.alive().length).toBe(11);
  });

  it('checks, guards and poisons follow the swap', () => {
    const d = new Driver(T, { sheriff: false });
    d.start();
    d.pick(1, 'magician', [8, 3]); // 8 ↔ wolf 3
    d.pick(2, 'trickster', []);
    d.pick(7, 'guard', [9]);
    d.wolves(null);
    d.witch(6, null, 8); // poison on 8 hits wolf 3
    d.pick(5, 'seer', [8]);
    expect(d.s.players[4].checks[0].result).toBe('狼人');
    d.toDay();
    d.toPhase('deathSkills');
    expect(d.s.players[2].death?.causes).toEqual(['poison']);
    expect(d.s.players[7].alive).toBe(true);
  });

  it('the same pair from 魔术师 and 诡术师 cancels out; swaps do not last into the next night', () => {
    const d = new Driver(T, { sheriff: false });
    d.start();
    d.pick(1, 'magician', [8, 9]);
    d.pick(2, 'trickster', [8, 9]);
    d.wolves(8);
    d.toDay();
    d.toPhase('deathSkills');
    expect(d.s.players[7].alive).toBe(false); // 8 itself
    d.skipSkills();
    d.endSpeeches();
    quietDay(d);
    expect(d.g.mapT(9)).toBe(9);
  });

  it('魔术师 swaps each number once; 诡术师 swaps each player once and cannot skip twice', () => {
    const d = new Driver(T, { sheriff: false });
    d.start();
    d.pick(1, 'magician', [8, 9]);
    d.pick(2, 'trickster', []);
    d.wolves(null);
    d.toDay();
    quietDay(d);
    d.toStep('magician');
    const m = d.g.promptFor(1) as any;
    expect(m.options).not.toContain(8);
    expect(m.options).not.toContain(9);
    d.act(1, { type: 'pick', step: 'magician', targets: [] });
    d.toStep('trickster');
    const t = d.g.promptFor(2) as any;
    expect(t.allowNone).toBe(false);
    expect(d.tryAct(2, { type: 'pick', step: 'trickster', targets: [] })).toBe('必须选择2名玩家');
    // on timeout the 诡术师 is made to swap a random pair
    d.until(() => d.nightStep() !== 'trickster');
    expect(d.s.nights[1].swaps?.trickster?.length).toBe(2);
  });

  it('女巫不能自救 holds through a swap', () => {
    const d = new Driver(T, { sheriff: false });
    d.start();
    d.pick(1, 'magician', [8, 6]); // 8 ↔ witch
    d.pick(2, 'trickster', []);
    d.wolves(8);
    d.witch(6, 8, null);
    d.toDay();
    d.toPhase('deathSkills');
    expect(d.s.players[5].alive).toBe(false);
    expect(d.s.players[5].witch?.antidote).toBe(false);
  });

  it('魔幻对决: 魔术师 waits until night 2, 狼术师 swaps again after him', () => {
    // 1魔术师 2狼术师 3狼 4狼 5通灵师 6女巫 7猎人 8-11平民
    const M: RoleId[] = ['magician', 'wolfwizard', 'wolf', 'wolf', 'psychic', 'witch', 'hunter', 'villager', 'villager', 'villager', 'villager'];
    const d = new Driver(M, { sheriff: false, magicianFirstNight: false });
    expect(stepsForNight(d.s.config, 1)).not.toContain('wolfwizard');
    d.start();
    d.toStep('magician');
    expect((d.g.promptFor(1) as any).kind).toBe('status');
    d.wolves(null);
    d.toDay();
    quietDay(d);
    d.pick(1, 'magician', [8, 9]);
    d.pick(2, 'wolfwizard', [9, 10]);
    expect([d.g.mapT(8), d.g.mapT(9), d.g.mapT(10)]).toEqual([9, 10, 8]);
    d.wolves(9); // seat 9 now holds player 10
    d.toDay();
    d.toPhase('deathSkills');
    expect(d.s.players[9].alive).toBe(false);
  });

  it('swaps redirect 蒙面人, 混血儿, 机械狼 and the 摄梦人', () => {
    const d = new Driver(['magician', 'mixed', 'mechwolf', 'wolf', 'masked', 'dreamer', 'villager', 'villager', 'seer', 'wolf'], { sheriff: false });
    d.start();
    d.pick(1, 'magician', [7, 5]); // 7 ↔ 蒙面人
    d.pick(2, 'mixed', [7]);
    expect(d.s.players[1].mixedModel).toBe(5);
    d.pick(3, 'mechLearn', [7]);
    expect(d.s.players[2].mech?.learned).toBe('masked');
    d.pick(6, 'dreamer', [8]);
    d.wolves(7);
    d.toDay();
    expect(d.s.wounded.map((w) => w.seat)).toEqual([5]);
  });
});

describe('定序王子 (prince)', () => {
  // 1定序王子 2预言家 3女巫 4狼 5狼 6狼 7-10平民
  const T: RoleId[] = ['prince', 'seer', 'witch', 'wolf', 'wolf', 'wolf', 'villager', 'villager', 'villager', 'villager'];

  it('voids the exile once: the prince speaks and everyone votes again', () => {
    const d = new Driver(T, { sheriff: false });
    d.start();
    d.wolves(null);
    d.toDay();
    exileToday(d, 7);
    expect(d.phase.kind).toBe('princeWindow');
    expect(d.s.players[6].alive).toBe(true);
    d.act(1, { type: 'prince', use: true });
    expect(d.s.players[0].revealed).toBe(true);
    expect((d.phase as any).context).toBe('prince');
    expect(d.tryAct(4, { type: 'selfDestruct', target: null })).toBe('只能在白天发言阶段自爆');
    d.endSpeeches();
    expect((d.phase as any).context).toBe('exile');
    expect((d.phase as any).voters.length).toBe(10);
    d.voteAll(4);
    // the second result goes straight through: the skill is spent
    expect(d.s.players[3].alive).toBe(false);
  });

  it('declining keeps the exile; the window lasts the same when the prince is dead', () => {
    const d = new Driver(T, { sheriff: false });
    d.start();
    d.wolves(null);
    d.toDay();
    exileToday(d, 7);
    expect(d.g.promptFor(1)).toMatchObject({ kind: 'prince', decided: false });
    d.act(1, { type: 'prince', use: false });
    expect(d.phase.kind).toBe('princeWindow'); // declining does not shorten it
    expect(d.g.promptFor(1)).toMatchObject({ kind: 'prince', decided: true });
    // the decision stays private: the public phase is the same either way
    expect(d.g.phaseView()).toEqual({ kind: 'princeWindow', target: 7 });
    d.step();
    expect(d.s.players[6].alive).toBe(false);

    const e = new Driver(T, { sheriff: false });
    e.s.players[0].alive = false;
    e.start();
    e.wolves(null);
    e.toDay();
    exileToday(e, 8);
    expect(e.phase.kind).toBe('princeWindow');
    expect(e.g.promptFor(1)).toBe(null);
  });

  it('a buried prince card still opens the window, so the table cannot tell it is buried', () => {
    // custom 盗宝大师 table, buried 定序王子 + 2 villagers: 1盗宝 2预言家 3女巫 4猎人 5-7狼 8-9平民
    const seats: RoleId[] = ['treasure', 'seer', 'witch', 'hunter', 'wolf', 'wolf', 'wolf', 'villager', 'villager'];
    const d = new Driver(seats, { sheriff: false }, ['prince', 'villager', 'villager']);
    d.start();
    d.wolves(null);
    d.toDay();
    exileToday(d, 8);
    expect(d.phase.kind).toBe('princeWindow');
    for (const p of d.s.players) expect(d.g.promptFor(p.seat)?.kind).not.toBe('prince');
    d.step();
    expect(d.s.players[7].alive).toBe(false);
    // and without a prince card in the pool there is no window at all
    const e = new Driver(['seer', 'witch', 'hunter', 'wolf', 'wolf', 'wolf', 'villager', 'villager', 'villager'], { sheriff: false });
    e.start();
    e.wolves(null);
    e.toDay();
    exileToday(e, 8);
    expect(e.phase.kind).not.toBe('princeWindow');
    expect(e.s.players[7].alive).toBe(false);
  });

  it('the prince can void his own exile; elections never open the window', () => {
    const d = new Driver(T, {});
    d.start();
    d.wolves(null);
    d.toDay();
    d.toPhase('signup');
    for (const s of d.alive()) if (d.phase.kind === 'signup') d.act(s, { type: 'signup', join: s === 2 || s === 4 });
    d.endSpeeches();
    d.voteAll(2);
    expect(d.s.sheriff).toBe(2);
    d.toPhase('orderChoice');
    d.act(2, { type: 'order', dir: 'cw' });
    d.endSpeeches();
    d.voteAll(1);
    expect(d.phase.kind).toBe('princeWindow');
    d.act(1, { type: 'prince', use: true });
    d.endSpeeches();
    d.voteAll(5);
    expect(d.s.players[0].alive).toBe(true);
    expect(d.s.players[4].alive).toBe(false);
  });
});

describe('狼女孩 (wolf girl)', () => {
  // 1狼女孩 2-4狼 5预言家 6毒师 7猎人 8守卫 9-12平民
  const T: RoleId[] = ['wolfgirl', 'wolf', 'wolf', 'wolf', 'seer', 'poisoner', 'hunter', 'guard', 'villager', 'villager', 'villager', 'villager'];
  const R = { sheriff: false, firstNightNoKnife: true };
  const signup = (d: Driver, joiners: number[]) => {
    d.toPhase('signup');
    for (const s of d.alive()) {
      if (d.phase.kind !== 'signup') break;
      d.act(s, { type: 'signup', join: joiners.includes(s) });
    }
  };
  const confessNight = (d: Driver, target: number) => {
    d.start();
    d.wolves(null);
    d.pick(1, 'wolfgirl', [target]);
  };

  it('首夜禁刀: the pack only confirms each other on night 1; the knife works from night 2', () => {
    const d = new Driver(T, R);
    d.start();
    d.toStep('wolves');
    expect(d.g.promptFor(2)).toMatchObject({ kind: 'wolves', noKnife: true, options: [] });
    expect(d.tryAct(2, { type: 'wolfPick', target: 9, confirm: true })).not.toBe(null);
    expect(d.announcements().join('')).toContain('首夜禁刀，今晚不能刀人');
    d.wolves(null);
    d.pick(1, 'wolfgirl', [9]);
    d.toDay();
    expect(d.s.nights[0].deaths).toEqual([]);
    quietDay(d);
    d.wolves(10);
    d.toDay();
    expect(d.s.nights[1].deaths).toEqual([{ seat: 10, causes: ['knife'] }]);
    // without the option night 1 is an ordinary knife night
    const e = new Driver(T, { sheriff: false });
    e.start();
    e.toStep('wolves');
    expect((e.g.promptFor(2) as any).options.length).toBeGreaterThan(0);
  });

  it('a confessed 平民 becomes 狼混: wins with the wolves, still checks as 好人, and only they learn it', () => {
    const d = new Driver(T, R);
    d.start();
    d.wolves(null);
    d.toStep('wolfgirl');
    const pr = d.g.promptFor(1) as any;
    expect(pr.options).toEqual([5, 6, 7, 8, 9, 10, 11, 12]); // never herself or her pack
    expect(pr.allowNone).toBe(false);
    d.act(1, { type: 'pick', step: 'wolfgirl', targets: [9] });
    expect(d.s.confession).toEqual({ by: 1, picked: 9, target: 9, turned: true });
    d.toStep('confessed');
    const st = d.g.promptFor(9) as any;
    expect(st.kind).toBe('status');
    expect(st.lines.join('')).toContain('成为狼混');
    for (const x of [1, 2, 5, 10]) expect(d.g.promptFor(x)).toBe(null);
    // the 狼女孩 never learns whether it worked; nobody else learns anything
    const herView = JSON.stringify([d.g.privateInfo(1), d.g.skillView(1), d.s.nights[0].results.wolfgirl]);
    expect(herView).toContain('9号');
    expect(herView).not.toContain('狼混');
    for (const x of [2, 5, 10]) expect(JSON.stringify([d.g.privateInfo(x), d.g.skillView(x)])).not.toContain('表白');
    expect(d.g.privateInfo(9).join('')).toContain('狼混');
    d.pick(5, 'seer', [9]);
    expect(d.s.nights[0].results.seer.join('')).toContain('好人');
    d.toDay();
    // the gods fall: 屠神, and the 狼混 wins with the wolves
    for (const g of [5, 6, 8]) d.s.players[g - 1].alive = false;
    quietDay(d);
    d.wolves(7);
    d.toDay();
    d.until(() => d.phase.kind === 'ended');
    expect(d.s.winner).toBe('wolf');
    const lh = d.g.result(() => null)!.players.find((p) => p.seat === 9)!;
    expect(lh).toMatchObject({ faction: 'wolf', won: true, note: '狼混' });
  });

  it('a confessed god refuses by default; good wins once every real wolf is out, 狼混 or not', () => {
    const d = new Driver(T, R);
    confessNight(d, 5);
    expect(d.s.confession?.turned).toBe(false);
    d.toStep('confessed');
    expect((d.g.promptFor(5) as any).lines.join('')).toContain('默认拒绝');
    d.toDay();
    expect(d.g.result(() => null)).toBe(null);

    const e = new Driver(T, R);
    confessNight(e, 10);
    e.toDay();
    for (const w of [2, 3, 4]) e.s.players[w - 1].alive = false;
    exileToday(e, 1); // the 狼女孩 is exiled: no revenge, and the 狼混 (10) does not keep the game going
    expect(e.s.players[9].alive).toBe(true);
    expect(e.s.winner).toBe('good');
    expect(e.g.result(() => null)!.players.find((p) => p.seat === 10)).toMatchObject({ faction: 'wolf', won: false });
  });

  it('自爆报复: her confessed player goes out with her, without last words; a hunter cannot shoot', () => {
    const d = new Driver(T, R);
    confessNight(d, 7);
    d.toDay();
    d.toDiscussion();
    expect(d.g.skillView(1).selfDestruct?.revenge).toBe(7);
    d.act(1, { type: 'selfDestruct', target: null });
    expect(d.s.players[6].death?.causes).toEqual(['revenge']);
    expect(d.s.players[6].death?.note).toBeTruthy();
    expect(d.announcements()).toContain('1号玩家自爆，翻牌为狼女孩，表白对象7号玩家随之出局。');
    expect(d.s.players[0].revealed).toBe(true);
    expect(d.phase.kind).toBe('interlude'); // no gun, no last words, straight to night
    d.until(() => d.phase.kind === 'night');
    // the other wolves self-destructing take nobody
    const e = new Driver(T, R);
    confessNight(e, 9);
    e.toDay();
    e.toDiscussion();
    expect(e.g.skillView(2).selfDestruct?.revenge ?? null).toBe(null);
    e.act(2, { type: 'selfDestruct', target: null });
    expect(e.s.players[8].alive).toBe(true);
  });

  it('自爆报复 during the election takes an unannounced-dead target and passes a sheriff badge', () => {
    // night 1: 毒师 poisons the confessed 9; 狼女孩 self-destructs during the sheriff speeches
    const d = new Driver(T, { firstNightNoKnife: true });
    confessNight(d, 9);
    d.pick(6, 'poisoner', [9]);
    d.toDay();
    signup(d, [1, 5]);
    d.act(1, { type: 'selfDestruct', target: null });
    expect(d.s.players[8].death?.causes).toEqual(['revenge']);
    d.until(() => d.phase.kind === 'night', 60);
    // the poison death was swallowed, so the dawn announcement shows no extra death
    expect(d.announcements()).toContain('昨天晚上是平安夜。');

    // the confessed sheriff passes the badge before night
    const e = new Driver(T, { firstNightNoKnife: true });
    confessNight(e, 11);
    e.toDay();
    signup(e, [11]);
    runUntil(e, () => e.s.sheriff === 11);
    e.toDiscussion();
    e.act(1, { type: 'selfDestruct', target: null });
    expect(e.phase.kind).toBe('deathSkills');
    expect((e.phase as any).entries).toMatchObject([{ seat: 11, badge: true }]);
  });

  it('a timed-out 狼女孩 confesses to a random outsider; a swap redirects the confession', () => {
    const d = new Driver(T, R);
    d.start();
    d.wolves(null);
    d.toStep('wolfgirl');
    d.step(); // let the timer run out
    d.until(() => d.nightStep() !== 'wolfgirl');
    expect(d.s.confession?.by).toBe(1);
    expect([5, 6, 7, 8, 9, 10, 11, 12]).toContain(d.s.confession?.target);

    // 1狼女孩 2狼 3魔术师 4预言家 5-6平民: the magician swaps 5 ↔ 4, the confession on 5 lands on 4
    const e = new Driver(['wolfgirl', 'wolf', 'magician', 'seer', 'villager', 'villager'], R);
    e.start();
    e.pick(3, 'magician', [5, 4]);
    e.wolves(null);
    e.pick(1, 'wolfgirl', [5]);
    expect(e.s.confession).toEqual({ by: 1, picked: 5, target: 4, turned: false });
    e.toStep('confessed');
    expect(e.g.promptFor(4)?.kind).toBe('status');
    expect(e.g.promptFor(5)).toBe(null);
    expect(e.g.skillView(1).notes.join('')).toContain('表白对象：5号');
  });
});

describe('new roles on custom tables (with 机械狼 and 盗宝大师)', () => {
  it('机械狼 learning any wolf card gets the double knife; the new god cards give nothing', () => {
    for (const id of Object.keys(ROLES) as RoleId[]) {
      if (ROLES[id].faction === 'wolf' && id !== 'mechwolf') expect(mechSkillFor(id), id).toBe('double');
    }
    for (const id of ['knight', 'dancer', 'magician', 'prince'] as RoleId[]) expect(mechSkillFor(id)).toBe('none');

    // 1通灵师 2女巫 3守卫 4狼美人 5狼 6机械狼 7-9平民
    const d = new Driver(['psychic', 'witch', 'guard', 'wolfbeauty', 'wolf', 'mechwolf', 'villager', 'villager', 'villager'], { sheriff: false });
    d.start();
    d.pick(6, 'mechLearn', [4]);
    expect(d.s.nights[0].results.mechLearn[0]).toBe('4号玩家的身份是：狼美人');
    d.wolves(null);
    d.toDay();
    for (const w of [4, 5]) d.s.players[w - 1].alive = false;
    quietDay(d);
    d.pick(3, 'guard', [8]);
    d.toStep('mechKill');
    expect((d.g.promptFor(6) as any).max).toBe(2);
    d.act(6, { type: 'pick', step: 'mechKill', targets: [7, 8] });
    d.toDay();
    d.toPhase('deathSkills');
    expect([d.s.players[6].alive, d.s.players[7].alive]).toEqual([false, false]); // 8 guarded but pierced
  });

  it('盗宝大师 holding 骑士/舞者/魔术师/定序王子 cards gets no night skill from them; a buried 舞者 is still called', () => {
    // 1盗宝 2预言家 3女巫 4猎人 5-7狼 8-9平民; buried 舞者 + 魔术师 + 平民 (2神1民)
    const seats: RoleId[] = ['treasure', 'seer', 'witch', 'hunter', 'wolf', 'wolf', 'wolf', 'villager', 'villager'];
    const d = new Driver(seats, { sheriff: false }, ['dancer', 'magician', 'villager']);
    expect(stepsForNight(d.s.config, 1)).toContain('magician');
    expect(stepsForNight(d.s.config, 2)).toContain('dancer');
    d.start();
    d.toStep('treasure');
    const pr = d.g.promptFor(1) as any;
    expect(pr.kind).toBe('treasure');
    for (const c of pr.cardSkills) expect(c.options).toEqual([]); // camouflage only
    expect(d.s.players[0].treasure?.countsAs).toBe('god');
    // the buried 魔术师's step waits a fake time and swaps nothing
    expect(d.s.nights[0].swaps).toBeUndefined();
  });
});

describe('the four new boards are complete', () => {
  it('night orders', () => {
    const cfg = (roles: Partial<Record<RoleId, number>>, magicianFirstNight = true) => ({
      boardName: 't',
      roles,
      rules: { ...new Driver(['seer', 'wolf', 'villager', 'villager']).s.config.rules, magicianFirstNight },
    });
    expect(stepsForNight(cfg({ seer: 1, witch: 1, guard: 1, knight: 1, wolfbeauty: 1, wolf: 3, villager: 4 }), 2)).toEqual([
      'guard',
      'wolves',
      'beauty',
      'witch',
      'seer',
    ]);
    expect(stepsForNight(cfg({ seer: 1, witch: 1, whitegod: 1, dancer: 1, masque: 1, wolf: 3, villager: 4 }), 2)).toEqual([
      'dancer',
      'masque',
      'wolves',
      'witch',
      'seer',
    ]);
    expect(stepsForNight(cfg({ seer: 1, witch: 1, magician: 1, prince: 1, trickster: 1, wolf: 3, villager: 4 }), 1)).toEqual([
      'magician',
      'trickster',
      'wolves',
      'witch',
      'seer',
    ]);
    expect(
      stepsForNight(cfg({ psychic: 1, witch: 1, hunter: 1, magician: 1, wolfwizard: 1, wolf: 3, villager: 4 }, false), 2),
    ).toEqual(['magician', 'wolfwizard', 'wolves', 'witch', 'psychic', 'hunterStatus']);
  });
});
