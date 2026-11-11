import { describe, expect, it } from 'vitest';
import { resolveNight, type NightInputs } from '../../server/game/resolve.ts';

const base = (o: Partial<NightInputs>): NightInputs => ({
  knives: [],
  guards: [],
  dreams: [],
  save: null,
  poisons: [],
  dreamBlocksPoison: true,
  ...o,
});
const deaths = (o: Partial<NightInputs>) => Object.fromEntries(resolveNight(base(o)));

describe('night settlement', () => {
  it('a wolf knife kills', () => {
    expect(deaths({ knives: [{ target: 3, piercing: false }] })).toEqual({ 3: ['knife'] });
  });

  it('empty knife is a peaceful night', () => {
    expect(deaths({})).toEqual({});
  });

  it('guard blocks the knife', () => {
    expect(deaths({ knives: [{ target: 3, piercing: false }], guards: [{ target: 3, bouncesPoison: false }] })).toEqual({});
  });

  it('antidote saves the knifed player', () => {
    expect(deaths({ knives: [{ target: 3, piercing: false }], save: 3 })).toEqual({});
  });

  it('同守同救: guard + antidote on the same player kills', () => {
    expect(
      deaths({ knives: [{ target: 3, piercing: false }], guards: [{ target: 3, bouncesPoison: false }], save: 3 }),
    ).toEqual({ 3: ['knife'] });
  });

  it('guard does not block poison', () => {
    expect(deaths({ poisons: [{ target: 4, witch: true }], guards: [{ target: 4, bouncesPoison: false }] })).toEqual({ 4: ['poison'] });
  });

  it('机械守卫 blocks the knife and bounces the poison back to whoever used it (弹毒)', () => {
    const guards = [{ target: 4, bouncesPoison: true }];
    expect(deaths({ poisons: [{ target: 4, witch: true, by: 2 }], knives: [{ target: 4, piercing: false }], guards })).toEqual({ 2: ['poison'] });
    // the 毒师's poison bounces the same way
    expect(deaths({ poisons: [{ target: 4, witch: false, by: 7 }], guards })).toEqual({ 7: ['poison'] });
    // a sleepwalker is immune to the bounced poison too (梦游者免疫毒药)
    expect(deaths({ poisons: [{ target: 4, witch: true, by: 2 }], dreams: [{ by: 9, target: 2, consecutive: false }], guards })).toEqual({});
    // unknown user: the poison just stops
    expect(deaths({ poisons: [{ target: 4, witch: true }], guards })).toEqual({});
    // poisons aimed elsewhere are untouched
    expect(deaths({ poisons: [{ target: 5, witch: true, by: 2 }], guards })).toEqual({ 5: ['poison'] });
  });

  it('破盾刀 ignores the guard but not the antidote', () => {
    expect(deaths({ knives: [{ target: 5, piercing: true }], guards: [{ target: 5, bouncesPoison: false }] })).toEqual({
      5: ['knife'],
    });
    expect(deaths({ knives: [{ target: 5, piercing: true }], save: 5 })).toEqual({});
  });

  it('double knife kills two players', () => {
    expect(
      deaths({
        knives: [
          { target: 1, piercing: false },
          { target: 2, piercing: true },
        ],
      }),
    ).toEqual({ 1: ['knife'], 2: ['knife'] });
  });

  it('dream protects from the knife', () => {
    expect(deaths({ knives: [{ target: 6, piercing: false }], dreams: [{ by: 9, target: 6, consecutive: false }] })).toEqual(
      {},
    );
  });

  it('dream protects from poison only when the rule says so', () => {
    const d = [{ by: 9, target: 6, consecutive: false }];
    expect(deaths({ poisons: [{ target: 6, witch: true }], dreams: d, dreamBlocksPoison: true })).toEqual({});
    expect(deaths({ poisons: [{ target: 6, witch: true }], dreams: d, dreamBlocksPoison: false })).toEqual({ 6: ['poison'] });
  });

  it('consecutive dream kills (even if protected otherwise)', () => {
    expect(
      deaths({ dreams: [{ by: 9, target: 6, consecutive: true }], guards: [{ target: 6, bouncesPoison: false }] }),
    ).toEqual({ 6: ['dream'] });
  });

  it('a dreamer dying at night takes the sleepwalker along', () => {
    expect(
      deaths({ knives: [{ target: 9, piercing: false }], dreams: [{ by: 9, target: 6, consecutive: false }] }),
    ).toEqual({ 9: ['knife'], 6: ['dream'] });
    expect(deaths({ poisons: [{ target: 9, witch: true }], dreams: [{ by: 9, target: 6, consecutive: false }] })).toEqual({
      9: ['poison'],
      6: ['dream'],
    });
  });

  it('a saved dreamer keeps the sleepwalker alive', () => {
    expect(
      deaths({ knives: [{ target: 9, piercing: false }], save: 9, dreams: [{ by: 9, target: 6, consecutive: false }] }),
    ).toEqual({});
  });

  it('knife plus poison on the same player records both causes', () => {
    expect(deaths({ knives: [{ target: 2, piercing: false }], poisons: [{ target: 2, witch: true }] })).toEqual({ 2: ['knife', 'poison'] });
  });
});
