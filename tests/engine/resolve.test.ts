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
    expect(deaths({ knives: [{ target: 3, piercing: false }], guards: [{ target: 3, blocksPoison: false }] })).toEqual({});
  });

  it('antidote saves the knifed player', () => {
    expect(deaths({ knives: [{ target: 3, piercing: false }], save: 3 })).toEqual({});
  });

  it('同守同救: guard + antidote on the same player kills', () => {
    expect(
      deaths({ knives: [{ target: 3, piercing: false }], guards: [{ target: 3, blocksPoison: false }], save: 3 }),
    ).toEqual({ 3: ['knife'] });
  });

  it('guard does not block poison', () => {
    expect(deaths({ poisons: [4], guards: [{ target: 4, blocksPoison: false }] })).toEqual({ 4: ['poison'] });
  });

  it('机械守卫 blocks poison and knife', () => {
    expect(
      deaths({ poisons: [4], knives: [{ target: 4, piercing: false }], guards: [{ target: 4, blocksPoison: true }] }),
    ).toEqual({});
  });

  it('破盾刀 ignores the guard but not the antidote', () => {
    expect(deaths({ knives: [{ target: 5, piercing: true }], guards: [{ target: 5, blocksPoison: false }] })).toEqual({
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
    expect(deaths({ poisons: [6], dreams: d, dreamBlocksPoison: true })).toEqual({});
    expect(deaths({ poisons: [6], dreams: d, dreamBlocksPoison: false })).toEqual({ 6: ['poison'] });
  });

  it('consecutive dream kills (even if protected otherwise)', () => {
    expect(
      deaths({ dreams: [{ by: 9, target: 6, consecutive: true }], guards: [{ target: 6, blocksPoison: false }] }),
    ).toEqual({ 6: ['dream'] });
  });

  it('a dreamer dying at night takes the sleepwalker along', () => {
    expect(
      deaths({ knives: [{ target: 9, piercing: false }], dreams: [{ by: 9, target: 6, consecutive: false }] }),
    ).toEqual({ 9: ['knife'], 6: ['dream'] });
    expect(deaths({ poisons: [9], dreams: [{ by: 9, target: 6, consecutive: false }] })).toEqual({
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
    expect(deaths({ knives: [{ target: 2, piercing: false }], poisons: [2] })).toEqual({ 2: ['knife', 'poison'] });
  });
});
