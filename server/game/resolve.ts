// Night settlement. Pure function: given what everyone did tonight, who dies and why.
import type { DeathCause } from './state.ts';

export interface NightInputs {
  /** wolf knives; a piercing knife (机械狼破盾刀) ignores guards */
  knives: { target: number; piercing: boolean }[];
  /** guards; the 机械守卫 also blocks poison */
  guards: { target: number; blocksPoison: boolean }[];
  /** dream targets; `by` dies at night → target dies too; consecutive → target dies */
  dreams: { by: number; target: number; consecutive: boolean }[];
  /** 女巫解药 target */
  save: number | null;
  poisons: number[];
  dreamBlocksPoison: boolean;
}

export function resolveNight(inp: NightInputs): Map<number, DeathCause[]> {
  const deaths = new Map<number, DeathCause[]>();
  const add = (seat: number, cause: DeathCause) => {
    const list = deaths.get(seat) ?? [];
    if (!list.includes(cause)) list.push(cause);
    deaths.set(seat, list);
  };
  const dreamImmune = new Set(inp.dreams.map((d) => d.target));
  const guarded = new Set(inp.guards.map((g) => g.target));
  const poisonGuarded = new Set(inp.guards.filter((g) => g.blocksPoison).map((g) => g.target));

  for (const k of inp.knives) {
    const t = k.target;
    if (dreamImmune.has(t)) continue;
    const isGuarded = !k.piercing && guarded.has(t);
    const isSaved = inp.save === t;
    if (isGuarded && isSaved) add(t, 'knife'); // 同守同救
    else if (isGuarded || isSaved) continue;
    else add(t, 'knife');
  }
  for (const p of inp.poisons) {
    if (inp.dreamBlocksPoison && dreamImmune.has(p)) continue;
    if (poisonGuarded.has(p)) continue;
    add(p, 'poison');
  }
  for (const d of inp.dreams) if (d.consecutive) add(d.target, 'dream');
  // 摄梦人夜间出局，梦游者随之梦亡 (iterate: a dreamer can be someone else's dream target)
  for (let changed = true; changed; ) {
    changed = false;
    for (const d of inp.dreams) {
      if (deaths.has(d.by) && !(deaths.get(d.target) ?? []).includes('dream')) {
        add(d.target, 'dream');
        changed = true;
      }
    }
  }
  return deaths;
}

/** causes that disable death skills (猎人/狼王开枪, 白狼王带人) */
export function disablesSkill(causes: DeathCause[]): boolean {
  return causes.includes('poison') || causes.includes('dream');
}

export const CAUSE_TEXT: Record<DeathCause, string> = {
  knife: '狼刀',
  poison: '毒杀',
  dream: '梦亡',
  exile: '放逐',
  shot: '枪杀',
  whitewolf: '被白狼王带走',
  selfdestruct: '自爆',
};
