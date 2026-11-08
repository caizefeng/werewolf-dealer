import { rolesList, type RoleCounts } from '../../shared/config.ts';
import { ROLES, type RoleId } from '../../shared/roles.ts';
import { shuffle, type RngHolder } from './rng.ts';

export interface DealResult {
  /** role per seat, index 0 = seat 1 */
  seats: RoleId[];
  /** 盗宝大师's three buried cards, or null */
  buried: RoleId[] | null;
}

type Kind = 'W' | 'G' | 'V' | 'X';

/**
 * Deals the configured roles. With 盗宝大师 three cards are buried first; the
 * buried set must be 1狼1神1民, 2神1民 or 1神2民 (so the table keeps the usual
 * 4/4/4 balance). The buried wolf is always a 普通狼人 when the pool has one.
 */
export function deal(roles: RoleCounts, rng: RngHolder): DealResult {
  const all = rolesList(roles);
  if (!all.includes('treasure')) return { seats: shuffle(rng, all), buried: null };

  const pool = all.filter((r) => r !== 'treasure');
  const hasPlainWolf = pool.includes('wolf');
  const kindOf = (r: RoleId): Kind => {
    const d = ROLES[r];
    if (d.category === 'god') return 'G';
    if (d.category === 'villager') return 'V';
    if (d.category === 'wolf' && d.pack && (!hasPlainWolf || r === 'wolf')) return 'W';
    return 'X';
  };
  const valid = (set: RoleId[]): boolean => {
    const k = set.map(kindOf);
    if (k.includes('X')) return false;
    const w = k.filter((x) => x === 'W').length;
    const g = k.filter((x) => x === 'G').length;
    const v = k.filter((x) => x === 'V').length;
    return (w === 1 && g === 1 && v === 1) || (w === 0 && g === 2 && v === 1) || (w === 0 && g === 1 && v === 2);
  };
  // Rejection sampling over uniformly random 3-card subsets (conditioned on validity).
  for (let attempt = 0; attempt < 10000; attempt++) {
    const shuffled = shuffle(rng, pool);
    const buried = shuffled.slice(0, 3);
    if (!valid(buried)) continue;
    const field = shuffle(rng, [...shuffled.slice(3), 'treasure' as RoleId]);
    return { seats: field, buried };
  }
  throw new Error('无法为盗宝大师埋牌，请检查配置');
}

export function treasureFaction(buried: RoleId[]): { faction: 'good' | 'wolf'; countsAs: 'god' | 'villager' | 'wolf' } {
  if (buried.some((r) => ROLES[r].faction === 'wolf')) return { faction: 'wolf', countsAs: 'wolf' };
  const gods = buried.filter((r) => ROLES[r].category === 'god').length;
  return { faction: 'good', countsAs: gods >= 2 ? 'god' : 'villager' };
}
