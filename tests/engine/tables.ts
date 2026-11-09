// Random custom tables for the fuzz tests (engine fuzz and bot games): any size, any mix of roles.
import { presetConfig, validateConfig, type GameConfig } from '../../shared/config.ts';
import type { RoleId } from '../../shared/roles.ts';
import { rand, shuffle, type RngHolder } from '../../server/game/rng.ts';

export const SINGLE_GOOD: RoleId[] = ['seer', 'psychic', 'witch', 'hunter', 'guard', 'whitegod', 'poisoner', 'dreamer', 'crow', 'masked', 'knight', 'dancer', 'magician', 'prince', 'mixed'];
export const SINGLE_WOLF: RoleId[] = ['wolfking', 'whitewolfking', 'mechwolf', 'wolfbeauty', 'trickster', 'wolfwizard', 'masque', 'wolfgirl'];

export function randomConfig(seed: number): GameConfig {
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
