import { ROLES, ROLE_IDS, type RoleId } from './roles.ts';

export interface RuleOptions {
  /** 警长竞选 on day 1 */
  sheriff: boolean;
  /** 双爆吞警徽 (default) or 单爆吞警徽 */
  badgeSwallow: 'double' | 'single';
  /** 女巫自救: 京城 = never */
  witchSelfSave: 'never' | 'firstNight' | 'always';
  /** 梦游者是否免疫毒药 (盗宝大师 board: no) */
  dreamBlocksPoison: boolean;
  /** what happens if both sides meet their win condition by the same event */
  simultaneousWin: 'wolf' | 'good' | 'draw';
  /** seconds for a night action */
  actionSeconds: number;
  /** seconds for the wolf pack to agree on a target */
  wolfSeconds: number;
  /** seconds for a vote */
  voteSeconds: number;
  /** seconds for 上警 sign-up */
  signupSeconds: number;
  /** 魔术师 may swap on night 1 (诡术之境) or only from night 2 (魔幻对决) */
  magicianFirstNight: boolean;
  /** 首夜禁刀: nobody may kill on night 1 (狼女孩 board); missing in old snapshots = false */
  firstNightNoKnife: boolean;
}

export type RoleCounts = Partial<Record<RoleId, number>>;

export interface GameConfig {
  boardName: string;
  roles: RoleCounts;
  rules: RuleOptions;
}

export const DEFAULT_RULES: RuleOptions = {
  sheriff: true,
  badgeSwallow: 'double',
  witchSelfSave: 'never',
  dreamBlocksPoison: true,
  simultaneousWin: 'wolf',
  actionSeconds: 120,
  wolfSeconds: 180,
  voteSeconds: 30,
  signupSeconds: 30,
  magicianFirstNight: true,
  firstNightNoKnife: false,
};

export interface BoardPreset {
  id: string;
  name: string;
  note?: string;
  roles: RoleCounts;
  rules?: Partial<RuleOptions>;
}

export const BOARDS: BoardPreset[] = [
  {
    id: 'ynlb',
    name: '预女猎白',
    roles: { seer: 1, witch: 1, hunter: 1, whitegod: 1, wolf: 4, villager: 4 },
  },
  {
    id: 'ynls',
    name: '预女猎守',
    roles: { seer: 1, witch: 1, hunter: 1, guard: 1, wolf: 4, villager: 4 },
  },
  {
    id: 'ynlbh',
    name: '预女猎白混',
    roles: { seer: 1, witch: 1, hunter: 1, whitegod: 1, wolf: 4, villager: 3, mixed: 1 },
  },
  {
    id: 'jxl',
    name: '机械狼通灵师',
    roles: { psychic: 1, witch: 1, hunter: 1, guard: 1, wolf: 3, mechwolf: 1, villager: 4 },
  },
  {
    id: 'lwsw',
    name: '狼王守卫',
    roles: { seer: 1, witch: 1, hunter: 1, guard: 1, wolfking: 1, wolf: 3, villager: 4 },
  },
  {
    id: 'blwsw',
    name: '白狼王守卫',
    roles: { seer: 1, witch: 1, hunter: 1, guard: 1, whitewolfking: 1, wolf: 3, villager: 4 },
  },
  {
    id: 'lwsmr',
    name: '狼王摄梦人',
    roles: { seer: 1, witch: 1, hunter: 1, dreamer: 1, wolfking: 1, wolf: 3, villager: 4 },
  },
  {
    id: 'dbds',
    name: '盗宝大师',
    note: '15张牌，埋3张底牌，首夜禁刀',
    roles: { treasure: 1, psychic: 1, poisoner: 1, hunter: 1, dreamer: 1, masked: 1, wolfking: 1, wolf: 3, villager: 5 },
    rules: { firstNightNoKnife: true },
  },
  {
    id: 'lmqs',
    name: '狼美骑士',
    roles: { seer: 1, witch: 1, guard: 1, knight: 1, wolfbeauty: 1, wolf: 3, villager: 4 },
  },
  {
    id: 'jmwh',
    name: '假面舞会',
    roles: { seer: 1, witch: 1, whitegod: 1, dancer: 1, masque: 1, wolf: 3, villager: 4 },
  },
  {
    id: 'gszj',
    name: '诡术之境',
    roles: { seer: 1, witch: 1, magician: 1, prince: 1, trickster: 1, wolf: 3, villager: 4 },
  },
  {
    id: 'mhdj',
    name: '魔幻对决',
    roles: { psychic: 1, witch: 1, hunter: 1, magician: 1, wolfwizard: 1, wolf: 3, villager: 4 },
    rules: { magicianFirstNight: false },
  },
  {
    id: 'lnh',
    name: '狼女孩',
    note: '首夜禁刀',
    roles: { seer: 1, poisoner: 1, hunter: 1, guard: 1, wolfgirl: 1, wolf: 3, villager: 4 },
    rules: { firstNightNoKnife: true },
  },
  {
    id: 'n10',
    name: '10人 预女猎白',
    roles: { seer: 1, witch: 1, hunter: 1, whitegod: 1, wolf: 3, villager: 3 },
  },
  {
    id: 'n9',
    name: '9人 预女猎',
    roles: { seer: 1, witch: 1, hunter: 1, wolf: 3, villager: 3 },
  },
];

/** Roles that may appear more than once */
export const MULTI_ROLES: RoleId[] = ['villager', 'wolf'];

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 20;

export function totalCards(roles: RoleCounts): number {
  let n = 0;
  for (const id of ROLE_IDS) n += roles[id] ?? 0;
  return n;
}

export function playerCountOf(roles: RoleCounts): number {
  return totalCards(roles) - ((roles.treasure ?? 0) > 0 ? 3 : 0);
}

export function rolesList(roles: RoleCounts): RoleId[] {
  const out: RoleId[] = [];
  for (const id of ROLE_IDS) for (let i = 0; i < (roles[id] ?? 0); i++) out.push(id);
  return out;
}

export function countBy(roles: RoleCounts, pred: (id: RoleId) => boolean): number {
  let n = 0;
  for (const id of ROLE_IDS) if (pred(id)) n += roles[id] ?? 0;
  return n;
}

/** Validates a config; returns a Chinese error message or null. */
export function validateConfig(cfg: GameConfig): string | null {
  if (!cfg || typeof cfg !== 'object') return '配置无效';
  if (typeof cfg.boardName !== 'string' || cfg.boardName.length > 30) return '板子名称无效';
  for (const [k, v] of Object.entries(cfg.roles ?? {})) {
    if (!(k in ROLES)) return `未知身份：${k}`;
    if (!Number.isInteger(v) || (v as number) < 0) return '身份数量无效';
    if (!MULTI_ROLES.includes(k as RoleId) && (v as number) > 1) return `${ROLES[k as RoleId].name}最多只能有一张`;
    if ((v as number) > MAX_PLAYERS) return '身份数量无效';
  }
  const roles = cfg.roles;
  const players = playerCountOf(roles);
  if (players < MIN_PLAYERS) return `至少需要${MIN_PLAYERS}名玩家`;
  if (players > MAX_PLAYERS) return `最多支持${MAX_PLAYERS}名玩家`;
  const wolves = countBy(roles, (id) => ROLES[id].faction === 'wolf');
  const gods = countBy(roles, (id) => ROLES[id].category === 'god');
  const villagers = countBy(roles, (id) => ROLES[id].category === 'villager');
  if ((roles.treasure ?? 0) > 0) {
    // the three buried cards are always one god, one villager and one (plain) pack wolf: 盗宝大师 is a wolf
    const buryWolves = countBy(roles, (id) => ROLES[id].pack);
    if (!(buryWolves >= 1 && gods >= 1 && villagers >= 1)) return '盗宝大师需要牌池中至少有一张神职、一张平民和一张狼人可以埋作底牌';
  } else if (wolves < 1) {
    return '至少需要一名狼人阵营的身份';
  }
  if (gods + villagers < 1) return '至少需要一名好人';
  if ((roles.mechwolf ?? 0) > 0 && countBy(roles, (id) => ROLES[id].pack) < 1)
    return '机械狼需要至少一名普通狼人（狼队）';
  const r = cfg.rules;
  if (!r) return '规则无效';
  const secs = [r.actionSeconds, r.wolfSeconds, r.voteSeconds, r.signupSeconds];
  if (secs.some((s) => !Number.isInteger(s) || s < 5 || s > 300)) return '时限需要在5到300秒之间';
  if (!['double', 'single'].includes(r.badgeSwallow)) return '规则无效';
  if (!['never', 'firstNight', 'always'].includes(r.witchSelfSave)) return '规则无效';
  if (!['wolf', 'good', 'draw'].includes(r.simultaneousWin)) return '规则无效';
  for (const b of [r.sheriff, r.dreamBlocksPoison, r.magicianFirstNight, r.firstNightNoKnife])
    if (typeof b !== 'boolean') return '规则无效';
  return null;
}

export function sanitizeConfig(raw: unknown): GameConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const roles: RoleCounts = {};
  const rr = (o.roles ?? {}) as Record<string, unknown>;
  for (const id of ROLE_IDS) {
    const v = rr[id];
    if (typeof v === 'number' && v > 0) roles[id] = Math.floor(v);
  }
  const ru = (o.rules ?? {}) as Record<string, unknown>;
  const rules: RuleOptions = { ...DEFAULT_RULES };
  for (const k of Object.keys(DEFAULT_RULES) as (keyof RuleOptions)[]) {
    if (k in ru && typeof ru[k] === typeof DEFAULT_RULES[k]) (rules as unknown as Record<string, unknown>)[k] = ru[k];
  }
  const cfg: GameConfig = {
    boardName: typeof o.boardName === 'string' ? o.boardName.slice(0, 30) : '自定义',
    roles,
    rules,
  };
  return cfg;
}

export function presetConfig(id: string): GameConfig {
  const b = BOARDS.find((x) => x.id === id) ?? BOARDS[0];
  return { boardName: b.name, roles: { ...b.roles }, rules: { ...DEFAULT_RULES, ...(b.rules ?? {}) } };
}
