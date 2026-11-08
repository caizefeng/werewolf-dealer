// 蒙面人 (京城大师赛 盗宝大师 board) and the 盗宝大师 card interactions around it.
import { describe, expect, it } from 'vitest';
import type { RoleId } from '../../shared/roles.ts';
import { stepsForNight } from '../../server/game/engine.ts';
import { Driver } from './driver.ts';

// 1盗宝 2通灵师 3蒙面人 4猎人 5摄梦人 6狼王 7-8狼人 9-12平民 (毒师 buried)
const DB_MASKED: RoleId[] = ['treasure', 'psychic', 'masked', 'hunter', 'dreamer', 'wolfking', 'wolf', 'wolf', 'villager', 'villager', 'villager', 'villager'];
// 1蒙面人 2女巫 3守卫 4预言家 5-6狼人 7-9平民
const WG_MASKED: RoleId[] = ['masked', 'witch', 'guard', 'seer', 'wolf', 'wolf', 'villager', 'villager', 'villager'];

/** end speeches until `seat` has spoken (inclusive) */
function speakThrough(d: Driver, seat: number): void {
  for (;;) {
    const ph = d.phase as any;
    if (ph.kind !== 'speech') throw new Error(`expected speech, got ${ph.kind}`);
    const cur = ph.order[ph.idx];
    d.act(cur, { type: 'endSpeech' });
    if (cur === seat) return;
  }
}

describe('蒙面人', () => {
  it('a knifed 蒙面人 is not announced dead and goes out right after their own speech', () => {
    const d = new Driver(WG_MASKED, { sheriff: false });
    d.start();
    d.wolves(1);
    d.witch(2, null, null);
    d.toDay();
    d.toPhase('speech');
    expect(d.announcements()).toContain('昨天晚上是平安夜。');
    expect(d.s.players[0].alive).toBe(true);
    expect(d.s.wounded).toEqual([{ seat: 1, causes: ['knife'], night: 1 }]);
    expect(d.g.privateInfo(1)[0]).toContain('负伤');
    const order = (d.phase as any).order as number[];
    speakThrough(d, 1);
    expect(d.s.players[0].alive).toBe(false);
    expect(d.announcements()).toContain('1号玩家出局。');
    // the discussion continues with the next speaker (unless 1 spoke last)
    if (order[order.length - 1] !== 1) {
      expect(d.phase.kind).toBe('speech');
      expect((d.phase as any).order[(d.phase as any).idx]).toBe(order[order.indexOf(1) + 1]);
    } else {
      expect(d.phase.kind).toBe('vote');
    }
    expect(d.s.history.flatMap((h) => h.events).some((e) => /1号出局（第1夜负伤/.test(e.text))).toBe(true);
  });

  it('the antidote or the guard prevent the wound; 同守同救 wounds', () => {
    const saved = new Driver(WG_MASKED, { sheriff: false });
    saved.start();
    saved.wolves(1);
    saved.witch(2, 1, null);
    saved.toDay();
    expect(saved.s.wounded).toEqual([]);

    const guarded = new Driver(WG_MASKED, { sheriff: false });
    guarded.start();
    guarded.pick(3, 'guard', [1]);
    guarded.wolves(1);
    guarded.toDay();
    expect(guarded.s.wounded).toEqual([]);

    const both = new Driver(WG_MASKED, { sheriff: false });
    both.start();
    both.pick(3, 'guard', [1]);
    both.wolves(1);
    both.witch(2, 1, null);
    both.toDay();
    expect(both.s.wounded.map((w) => w.seat)).toEqual([1]);
  });

  it('poison and dream death wound the 蒙面人 too', () => {
    const d = new Driver(WG_MASKED, { sheriff: false });
    d.start();
    d.wolves(null);
    d.witch(2, null, 1);
    d.toDay();
    expect(d.s.wounded).toEqual([{ seat: 1, causes: ['poison'], night: 1 }]);

    const e = new Driver(DB_MASKED, { sheriff: false }, ['poisoner', 'villager', 'wolf']);
    e.start();
    e.toStep('treasure');
    e.act(1, { type: 'treasure', card: 1, target: null, kill: null });
    e.pick(5, 'dreamer', [3]);
    e.wolves(null);
    e.toDay();
    e.toPhase('speech');
    speakThrough(e, (e.phase as any).order[(e.phase as any).order.length - 1]);
    e.voteAll(null);
    e.until(() => e.phase.kind === 'night');
    e.toStep('treasure');
    e.act(1, { type: 'treasure', card: 0, target: null, kill: null });
    e.pick(5, 'dreamer', [3]); // second night in a row → 梦亡
    e.wolves(null);
    e.toDay();
    expect(e.s.wounded).toEqual([{ seat: 3, causes: ['dream'], night: 2 }]);
  });

  it('a wounded 蒙面人 who never gets to speak goes out before night falls (day cut short by 自爆)', () => {
    const d = new Driver(WG_MASKED, { sheriff: false });
    d.start();
    d.wolves(1);
    d.toDay();
    d.toPhase('speech');
    // a wolf self-destructs before anybody has finished speaking
    d.act(5, { type: 'selfDestruct', target: null });
    expect(d.s.players[0].alive).toBe(true);
    d.until(() => d.phase.kind === 'night');
    expect(d.s.players[0].alive).toBe(false);
    const ann = d.announcements();
    expect(ann.indexOf('1号玩家出局。')).toBeGreaterThan(-1);
    expect(ann.indexOf('1号玩家出局。')).toBeLessThan(ann.lastIndexOf('天黑请闭眼。'));
  });

  it('ends the game at dawn when the 蒙面人 is the last god and two wolves remain (提前结算)', () => {
    // 1蒙面人 2-3狼 4-5平民: only one god
    const d = new Driver(['masked', 'wolf', 'wolf', 'villager', 'villager'], { sheriff: true });
    d.start();
    d.wolves(1);
    d.toDay();
    d.until(() => d.phase.kind === 'ended');
    expect(d.s.winner).toBe('wolf');
    expect(d.s.election).toBe(null); // no sheriff election: the night decided the game
    expect(d.s.players[0].alive).toBe(false);
  });

  it('with a single wolf left the day goes on until the 蒙面人 has spoken', () => {
    // 1蒙面人 2狼 3-4平民 5预言家
    const d = new Driver(['masked', 'wolf', 'villager', 'villager', 'seer'], { sheriff: false });
    d.start();
    d.wolves(5); // seer dies tonight
    d.toStep('seer');
    d.act(5, { type: 'pick', step: 'seer', targets: [2] });
    d.toDay();
    d.toPhase('deathSkills');
    d.skipSkills();
    d.endSpeeches(); // 5's last words
    // 蒙面人 not wounded this time; next night the wolf knifes the 蒙面人
    d.toPhase('speech');
    d.endSpeeches();
    d.voteAll(null);
    d.until(() => d.phase.kind === 'night');
    d.wolves(1);
    d.toDay();
    d.toPhase('speech');
    expect(d.phase.kind).toBe('speech');
    expect(d.s.winner).toBe(null);
    speakThrough(d, 1);
    expect(d.s.winner).toBe('wolf'); // the last god went out after speaking
  });

  it('a wounded sheriff speaks last, goes out, and hands over the badge before the vote', () => {
    const d = new Driver(DB_MASKED, { sheriff: true }, ['poisoner', 'villager', 'wolf']);
    d.start();
    d.toStep('treasure');
    d.act(1, { type: 'treasure', card: 0, target: 3, kill: null }); // 盗宝 uses the 毒师 card on the 蒙面人
    d.pick(5, 'dreamer', [10]);
    d.wolves(9);
    d.pick(2, 'psychic', [3]);
    expect(d.s.players[1].checks[0].result).toBe('蒙面人');
    d.toDay();
    expect(d.s.wounded.map((w) => w.seat)).toEqual([3]);
    // the wounded 蒙面人 runs alone and becomes sheriff (deaths are announced after the election)
    d.toPhase('signup');
    for (const s of d.alive()) if (d.phase.kind === 'signup') d.act(s, { type: 'signup', join: s === 3 });
    expect(d.s.sheriff).toBe(3);
    d.toPhase('deathSkills');
    expect(d.announcements()).toContain('昨天晚上，9号玩家死亡。');
    d.skipSkills();
    d.endSpeeches(); // 9's last words
    d.toPhase('orderChoice');
    d.act(3, { type: 'order', dir: 'cw' });
    speakThrough(d, 3); // the sheriff speaks last
    expect(d.s.players[2].alive).toBe(false);
    expect(d.phase.kind).toBe('deathSkills');
    d.act(3, { type: 'badge', target: 2 });
    expect(d.s.sheriff).toBe(2);
    // no last words (the speech was the last words) → the exile vote follows
    expect(d.phase.kind).toBe('vote');
    expect((d.phase as any).context).toBe('exile');
  });

  it('the 蒙面人 is called on night 1 only; the 通灵师 sees it', () => {
    const d = new Driver(DB_MASKED, {}, ['poisoner', 'villager', 'wolf']);
    expect(stepsForNight(d.s.config, 1)).toContain('maskedConfirm');
    expect(stepsForNight(d.s.config, 2)).not.toContain('maskedConfirm');
    expect(d.g.psychicResult(3)).toBe('蒙面人');
    expect(d.g.seerResult(3)).toBe('好人');
  });
});

describe('盗宝大师 with the 蒙面人 card', () => {
  // 1盗宝 2通灵师 3毒师 4猎人 5摄梦人 6狼王 7-8狼人 9-12平民, buried 蒙面人/平民/狼人 → 盗宝狼
  const DB: RoleId[] = ['treasure', 'psychic', 'poisoner', 'hunter', 'dreamer', 'wolfking', 'wolf', 'wolf', 'villager', 'villager', 'villager', 'villager'];

  function lastWolfTreasure(): Driver {
    const d = new Driver(DB, { sheriff: false }, ['masked', 'villager', 'wolf']);
    for (const w of [6, 7, 8]) d.s.players[w - 1].alive = false;
    return d;
  }

  it('the last-wolf 盗宝蒙面 survives being exiled once and kills twice that night', () => {
    const d = lastWolfTreasure();
    d.start();
    d.toStep('treasure');
    d.act(1, { type: 'treasure', card: 0, target: null, kill: 9 });
    d.pick(5, 'dreamer', [11]);
    d.toDay();
    d.toDiscussion();
    d.endSpeeches();
    d.voteAll(1);
    expect(d.phase.kind).toBe('deathSkills');
    const pr = d.g.promptFor(1) as any;
    expect(pr.mask).toBe(true);
    expect(d.s.players[0].alive).toBe(true); // not applied yet
    expect(d.tryAct(1, { type: 'skillDone' })).toBe('请选择是否发动蒙面技能');
    d.act(1, { type: 'mask', use: true });
    expect(d.s.players[0].alive).toBe(true);
    expect(d.announcements()).toContain('1号玩家发动蒙面技能，被推不死。');
    d.until(() => d.phase.kind === 'night');
    d.toStep('treasure');
    const tp = d.g.promptFor(1) as any;
    expect(tp.killMax).toBe(2);
    expect(tp.allowedCards).toEqual([1, 2]);
    d.act(1, { type: 'treasure', card: 1, target: null, kill: 10, kill2: 12 });
    d.pick(5, 'dreamer', [2]);
    d.toDay();
    d.until(() => d.phase.kind === 'deathSkills' || d.phase.kind === 'ended');
    expect(d.s.players[9].alive).toBe(false);
    expect(d.s.players[11].alive).toBe(false);
    expect(d.s.players[0].treasure?.extraKnife).toBe(false);
    expect(d.s.players[0].treasure?.maskUsed).toBe(true);
  });

  it('declining the 蒙面 skill lets the exile stand: good wins', () => {
    const d = lastWolfTreasure();
    d.start();
    d.toStep('treasure');
    d.act(1, { type: 'treasure', card: 0, target: null, kill: null });
    d.pick(5, 'dreamer', [11]);
    d.toDay();
    d.toPhase('speech');
    d.endSpeeches();
    d.voteAll(1);
    d.act(1, { type: 'mask', use: false });
    expect(d.s.winner).toBe('good');
  });

  it('not eligible when other wolves are alive or another card is held', () => {
    const d = new Driver(DB, { sheriff: false }, ['masked', 'villager', 'wolf']);
    d.start();
    d.toStep('treasure');
    d.act(1, { type: 'treasure', card: 0, target: null, kill: null });
    d.pick(5, 'dreamer', [11]);
    d.wolves(null);
    d.toDay();
    expect(d.g.maskActiveEligible(1)).toBe(false); // the pack is alive
    for (const w of [6, 7, 8]) d.s.players[w - 1].alive = false;
    expect(d.g.maskActiveEligible(1)).toBe(true);
    d.s.players[0].treasure!.current = 1;
    expect(d.g.maskActiveEligible(1)).toBe(false);
  });

  it('holding the 蒙面人 card, a poisoned 盗宝 is wounded instead of dying', () => {
    const d = new Driver(DB, { sheriff: false }, ['masked', 'villager', 'wolf']);
    d.start();
    d.toStep('treasure');
    d.act(1, { type: 'treasure', card: 0, target: null, kill: null });
    d.pick(5, 'dreamer', [11]);
    d.wolves(null);
    d.pick(3, 'poisoner', [1]);
    d.toDay();
    expect(d.s.wounded).toEqual([{ seat: 1, causes: ['poison'], night: 1 }]);
  });

  it('盗宝摄梦隔夜梦亡: the same sleepwalker on two successive uses of the card dies', () => {
    const d = new Driver(DB, { sheriff: false }, ['dreamer', 'villager', 'wolf']);
    // seat 5 is the real 摄梦人 in DB; the buried dreamer card is the 盗宝's
    d.start();
    d.toStep('treasure');
    d.act(1, { type: 'treasure', card: 0, target: 9, kill: null });
    d.pick(5, 'dreamer', [10]);
    d.wolves(null);
    d.toDay();
    d.toPhase('speech');
    d.endSpeeches();
    d.voteAll(null);
    d.until(() => d.phase.kind === 'night');
    d.toStep('treasure');
    d.act(1, { type: 'treasure', card: 1, target: null, kill: null });
    d.pick(5, 'dreamer', [11]);
    d.wolves(null);
    d.toDay();
    d.toPhase('speech');
    d.endSpeeches();
    d.voteAll(null);
    d.until(() => d.phase.kind === 'night');
    d.toStep('treasure');
    d.act(1, { type: 'treasure', card: 0, target: 9, kill: null }); // night 3, same target as night 1
    d.pick(5, 'dreamer', [12]);
    d.wolves(null);
    d.toDay();
    d.toPhase('deathSkills');
    expect(d.s.players[8].death?.causes).toEqual(['dream']);
  });
});
