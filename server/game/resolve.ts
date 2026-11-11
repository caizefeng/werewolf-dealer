// Night settlement. Pure function: given what everyone did tonight, who dies and why.
// All targets are actual players (number swaps are applied before calling this).
import type { DeathCause } from './state.ts';

export interface NightInputs {
  /** wolf knives; a piercing knife (机械狼破盾刀) ignores guards */
  knives: { target: number; piercing: boolean }[];
  /** guards; the 机械守卫 also bounces poison back to whoever used it (弹毒) */
  guards: { target: number; bouncesPoison: boolean }[];
  /** dream targets; `by` dies at night → target dies too; consecutive → target dies */
  dreams: { by: number; target: number; consecutive: boolean }[];
  /** 女巫解药 target */
  save: number | null;
  /** poisons; `witch` marks the witch's (舞者/假面 are immune to it); `by`: who used it (a bounced poison hits them) */
  poisons: { target: number; witch: boolean; by?: number | null }[];
  dreamBlocksPoison: boolean;
  /** 舞者 dancing with the floor: the floor is immune to knives */
  knifeImmune?: number[];
  /** 舞者 / 假面: the witch's poison has no effect on them */
  witchPoisonImmune?: number[];
  /** deaths decided elsewhere that nothing blocks (舞池) */
  extra?: { seat: number; cause: DeathCause }[];
  /** 狼美人 poisoned tonight → the charmed player dies with her (殉情) */
  lovers?: { beauty: number; target: number }[];
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
  const bouncing = new Set(inp.guards.filter((g) => g.bouncesPoison).map((g) => g.target));
  const knifeImmune = new Set(inp.knifeImmune ?? []);
  const witchImmune = new Set(inp.witchPoisonImmune ?? []);

  for (const k of inp.knives) {
    const t = k.target;
    if (dreamImmune.has(t) || knifeImmune.has(t)) continue;
    const isGuarded = !k.piercing && guarded.has(t);
    const isSaved = inp.save === t;
    if (isGuarded && isSaved) add(t, 'knife'); // 同守同救
    else if (isGuarded || isSaved) continue;
    else add(t, 'knife');
  }
  const poisonHits = (target: number, witch: boolean) => {
    if (witch && witchImmune.has(target)) return;
    if (inp.dreamBlocksPoison && dreamImmune.has(target)) return;
    add(target, 'poison');
  };
  for (const p of inp.poisons) {
    // 机械守卫弹毒: the poison never reaches the guarded player and goes back to whoever used it
    if (bouncing.has(p.target)) {
      if (p.by != null && p.by !== p.target) poisonHits(p.by, false);
      continue;
    }
    poisonHits(p.target, p.witch);
  }
  for (const d of inp.dreams) if (d.consecutive) add(d.target, 'dream');
  for (const e of inp.extra ?? []) add(e.seat, e.cause);
  // chains: 摄梦人 dying takes the sleepwalker; a poisoned 狼美人 takes the charmed player
  for (let changed = true; changed; ) {
    changed = false;
    for (const d of inp.dreams) {
      if (deaths.has(d.by) && !(deaths.get(d.target) ?? []).includes('dream')) {
        add(d.target, 'dream');
        changed = true;
      }
    }
    for (const l of inp.lovers ?? []) {
      if ((deaths.get(l.beauty) ?? []).includes('poison') && l.target !== l.beauty && !(deaths.get(l.target) ?? []).includes('lovesick')) {
        add(l.target, 'lovesick');
        changed = true;
      }
    }
  }
  return deaths;
}

/** causes that disable death skills (猎人/狼王开枪, 白狼王带人) */
export function disablesSkill(causes: DeathCause[]): boolean {
  return causes.includes('poison') || causes.includes('dream') || causes.includes('lovesick');
}

export const CAUSE_TEXT: Record<DeathCause, string> = {
  knife: '狼刀',
  poison: '毒杀',
  dream: '梦亡',
  exile: '放逐',
  shot: '枪杀',
  whitewolf: '被白狼王带走',
  selfdestruct: '自爆',
  duel: '决斗',
  dance: '舞池',
  lovesick: '殉情',
  revenge: '自爆报复',
};
