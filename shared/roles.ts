// Role catalogue. Rules follow 京城大师赛 conventions (see shared/rules.ts for the
// general rules and README for the sources and the judgement calls made).

export type RoleId =
  | 'villager'
  | 'seer'
  | 'psychic'
  | 'witch'
  | 'hunter'
  | 'guard'
  | 'whitegod'
  | 'poisoner'
  | 'dreamer'
  | 'crow'
  | 'masked'
  | 'mixed'
  | 'wolf'
  | 'wolfking'
  | 'whitewolfking'
  | 'mechwolf'
  | 'treasure';

/** god / villager / wolf decide the 屠边 count; treasure depends on its buried cards */
export type RoleCategory = 'god' | 'villager' | 'wolf' | 'treasure';

export interface RoleDef {
  id: RoleId;
  name: string;
  category: RoleCategory;
  /** faction printed on the card; 'variable' = decided during the game (盗宝大师) */
  faction: 'good' | 'wolf' | 'variable';
  /** wakes up with the wolf pack at night (sees teammates, shares the knife) */
  pack: boolean;
  /** can self-destruct (自爆) during the day */
  canSelfDestruct: boolean;
  /** one-line summary for compact lists */
  short: string;
  /** full rule text shown in the rules panel and on the role card */
  rules: string[];
  /** icon key (client/src/components/RoleIcon.tsx) */
  icon: string;
  /** display order in the setup screen */
  order: number;
}

export const ROLES: Record<RoleId, RoleDef> = {
  seer: {
    id: 'seer',
    name: '预言家',
    category: 'god',
    faction: 'good',
    pack: false,
    canSelfDestruct: false,
    short: '每晚查验一名玩家是好人还是狼人',
    rules: [
      '每晚可以查验一名存活玩家，得知其身份是「好人」还是「狼人」。',
      '机械狼查验为狼人；混血儿查验为好人；盗宝大师按其当晚使用的身份牌显示。',
    ],
    icon: 'eye',
    order: 10,
  },
  psychic: {
    id: 'psychic',
    name: '通灵师',
    category: 'god',
    faction: 'good',
    pack: false,
    canSelfDestruct: false,
    short: '每晚查验一名玩家的具体身份',
    rules: [
      '每晚可以查验一名存活玩家的具体身份（例如「女巫」「狼王」「普通村民」）。',
      '机械狼未学习时查验为「机械狼」，学习后查验为其学习的身份。',
      '盗宝大师查验为其当晚使用的身份牌。',
    ],
    icon: 'spiral',
    order: 11,
  },
  witch: {
    id: 'witch',
    name: '女巫',
    category: 'god',
    faction: 'good',
    pack: false,
    canSelfDestruct: false,
    short: '一瓶解药、一瓶毒药；不能自救',
    rules: [
      '拥有一瓶解药和一瓶毒药，各只能使用一次。',
      '解药可以救活当晚被狼人击杀的玩家；毒药可以毒杀一名玩家。',
      '女巫全程不能自救；同一晚不能同时使用两瓶药。',
      '解药用掉之后，女巫不再得知夜间被击杀的玩家。',
      '守卫守护与解药作用于同一名玩家时（同守同救），该玩家死亡。',
    ],
    icon: 'flask',
    order: 12,
  },
  hunter: {
    id: 'hunter',
    name: '猎人',
    category: 'god',
    faction: 'good',
    pack: false,
    canSelfDestruct: false,
    short: '被刀或被放逐时可以开枪带走一人',
    rules: [
      '被狼人击杀或被放逐出局时，可以开枪带走一名存活玩家，也可以选择不开枪。',
      '被毒杀、梦亡，或被枪杀、被白狼王带走时不能开枪。',
      '若猎人出局时游戏已经结束（例如猎人是最后一名神职），不能开枪。',
      '每晚法官会告知猎人当晚的开枪状态。',
    ],
    icon: 'crosshair',
    order: 13,
  },
  guard: {
    id: 'guard',
    name: '守卫',
    category: 'god',
    faction: 'good',
    pack: false,
    canSelfDestruct: false,
    short: '每晚守护一人免疫狼刀；不能连守',
    rules: [
      '每晚可以守护一名玩家（可以守护自己，也可以空守），被守护的玩家当晚不会被狼人击杀。',
      '不能连续两晚守护同一名玩家。',
      '守护不能抵挡毒药。',
      '守卫守护与女巫解药作用于同一名玩家时（同守同救），该玩家死亡。',
    ],
    icon: 'shield',
    order: 14,
  },
  whitegod: {
    id: 'whitegod',
    name: '白神',
    category: 'god',
    faction: 'good',
    pack: false,
    canSelfDestruct: false,
    short: '无技能；被放逐时翻牌',
    rules: [
      '没有主动技能，计入神职。',
      '被放逐出局时翻牌公布身份：「x号玩家出局，翻牌为白神（请留遗言）」。',
      '夜间出局时不翻牌。',
    ],
    icon: 'blank',
    order: 15,
  },
  poisoner: {
    id: 'poisoner',
    name: '毒师',
    category: 'god',
    faction: 'good',
    pack: false,
    canSelfDestruct: false,
    short: '一瓶毒药，任意一晚毒杀一人',
    rules: [
      '拥有一瓶毒药，可以在任意一晚毒杀一名玩家。',
      '被毒杀的猎人、狼王不能发动技能。',
    ],
    icon: 'skull',
    order: 16,
  },
  dreamer: {
    id: 'dreamer',
    name: '摄梦人',
    category: 'god',
    faction: 'good',
    pack: false,
    canSelfDestruct: false,
    short: '每晚必须摄梦一人；连续两晚梦游者出局',
    rules: [
      '每晚必须选择一名其他玩家成为梦游者（不能选择自己），梦游者当晚免疫夜间伤害。',
      '连续两晚成为梦游者的玩家会梦亡出局。',
      '摄梦人在夜间出局时，当晚的梦游者随之梦亡出局。',
      '梦亡的玩家不能发动技能。',
    ],
    icon: 'moon',
    order: 17,
  },
  crow: {
    id: 'crow',
    name: '乌鸦',
    category: 'god',
    faction: 'good',
    pack: false,
    canSelfDestruct: false,
    short: '每晚诅咒一人，次日放逐时多计一票',
    rules: [
      '每晚必须诅咒一名其他玩家，不能连续两晚诅咒同一名玩家。',
      '被诅咒的玩家在次日白天的放逐投票中额外被计一票（结果中会标注）。',
    ],
    icon: 'feather',
    order: 18,
  },
  masked: {
    id: 'masked',
    name: '蒙面人',
    category: 'god',
    faction: 'good',
    pack: false,
    canSelfDestruct: false,
    short: '夜间被刀/毒/梦亡时，延迟到次日发言后出局',
    rules: [
      '神职阵营。夜间被狼人击杀、被毒杀或梦亡时，被动发动蒙面技能，进入中毒和负伤状态：当晚不会死亡，在第二天自己发言结束后出局（这段发言即遗言）。',
      '天亮时的死讯不包含负伤的蒙面人；若当天还没轮到蒙面人发言就进入黑夜，则在入夜前出局。',
      '若蒙面人出局必然导致屠神，且场上还有两名及以上狼人，则天亮时直接结算狼人胜利。',
      '盗宝大师当晚使用蒙面人牌时同样享有被动技能；若盗宝大师属于狼人阵营且是场上最后一名狼人，被放逐时可以发动主动蒙面技能：被推不死，当晚多一刀（整局一次）。',
    ],
    icon: 'mask',
    order: 19,
  },
  villager: {
    id: 'villager',
    name: '普通村民',
    category: 'villager',
    faction: 'good',
    pack: false,
    canSelfDestruct: false,
    short: '没有技能，靠发言和投票找狼',
    rules: ['没有特殊技能，白天通过发言和投票找出狼人。'],
    icon: 'person',
    order: 20,
  },
  mixed: {
    id: 'mixed',
    name: '混血儿',
    category: 'villager',
    faction: 'good',
    pack: false,
    canSelfDestruct: false,
    short: '首夜选榜样，胜负跟随榜样阵营',
    rules: [
      '首夜选择一名其他玩家作为榜样，胜利条件与榜样的阵营相同；混血儿不知道榜样的身份。',
      '自身属性为平民：屠边时计入平民，预言家查验为好人。',
      '榜样出局后混血儿的阵营不变。',
    ],
    icon: 'half',
    order: 21,
  },
  wolf: {
    id: 'wolf',
    name: '狼人',
    category: 'wolf',
    faction: 'wolf',
    pack: true,
    canSelfDestruct: true,
    short: '每晚与狼队一起击杀一人',
    rules: [
      '每晚与狼队友一起选择击杀一名玩家（可以空刀，也可以击杀狼队友）。',
      '白天发言阶段可以自爆，自爆后没有遗言，当天直接进入黑夜。',
    ],
    icon: 'wolf',
    order: 30,
  },
  wolfking: {
    id: 'wolfking',
    name: '狼王',
    category: 'wolf',
    faction: 'wolf',
    pack: true,
    canSelfDestruct: true,
    short: '被刀或被放逐时可以开枪带走一人',
    rules: [
      '与狼队一起行动。',
      '被狼人击杀或被放逐出局时，可以开枪带走一名存活玩家。',
      '被毒杀、梦亡、自爆、被枪杀时不能开枪；作为最后一名狼人出局时游戏已经结束，不能开枪。',
      '每晚法官会告知狼王当晚的开枪状态。',
    ],
    icon: 'crown',
    order: 31,
  },
  whitewolfking: {
    id: 'whitewolfking',
    name: '白狼王',
    category: 'wolf',
    faction: 'wolf',
    pack: true,
    canSelfDestruct: true,
    short: '白天自爆时可以带走一人',
    rules: [
      '与狼队一起行动。',
      '白天发言阶段可以自爆并带走一名存活玩家，被带走的玩家没有遗言。',
      '非自爆出局不能发动技能；当晚被毒杀后在警上自爆（吞毒自爆）不能带人。',
      '每晚法官会告知白狼王当晚的技能状态。',
    ],
    icon: 'crown-white',
    order: 32,
  },
  mechwolf: {
    id: 'mechwolf',
    name: '机械狼',
    category: 'wolf',
    faction: 'wolf',
    pack: false,
    canSelfDestruct: false,
    short: '首夜学习一人的技能；不与狼队见面',
    rules: [
      '机械狼与其他狼人互不见面、互不相识，不能自爆。',
      '首夜可以学习（模仿）一名玩家，得知其身份并获得对应的机械技能，从第二晚起生效：',
      '· 学习预言家 / 通灵师：每晚可以查验一名玩家（结果同对应神职）。',
      '· 学习女巫 / 毒师：获得一瓶毒药。',
      '· 学习守卫：每晚可以守护一名玩家，可以挡狼刀，也可以挡毒药；不能连续两晚守护同一人。',
      '· 学习猎人：被狼人击杀或被放逐出局时可以开枪（被毒不能开枪）。',
      '· 学习狼人（含狼王、白狼王）：成为双刀狼，普通狼人全部出局后的第一个夜晚可以刀两人，其中一刀为破盾刀，无视守卫守护；那一晚不用则作废。',
      '· 学习其他身份：没有技能。',
      '普通狼人（狼队）全部出局后，机械狼获得刀人能力。',
    ],
    icon: 'gear',
    order: 33,
  },
  treasure: {
    id: 'treasure',
    name: '盗宝大师',
    category: 'treasure',
    faction: 'variable',
    pack: false,
    canSelfDestruct: false,
    short: '每晚从三张底牌中选一张作为身份',
    rules: [
      '本局发牌时额外埋下三张底牌（组合固定为「一狼一神一民」「两神一民」或「一神两民」之一）。',
      '首夜盗宝大师查看三张底牌；此后每晚从中选择一张作为当晚的身份牌，不能连续两晚选择同一张。',
      '选择神职牌时可以发动该神职当晚的技能（女巫牌只有毒药）；选择狼牌、民牌只有伪装作用。持有猎人牌时出局可以开枪；持有蒙面人牌时享有蒙面人的被动技能。',
      '使用摄梦人牌时，隔夜（相邻两次使用摄梦人牌）梦游同一名玩家，该玩家梦亡。',
      '盗宝大师属于狼人阵营、是场上最后一名狼人且当晚使用蒙面人牌时，被放逐可以发动主动蒙面技能：被推不死，当晚多一刀（整局一次）。',
      '底牌中有狼牌：盗宝大师属于狼人阵营，不与狼队见面，狼队友全部出局后获得刀人能力。',
      '底牌中没有狼牌：盗宝大师属于好人阵营；两神一民时计入神职，一神两民时计入平民。',
      '通灵师查验结果为其当晚使用的身份牌；预言家按该牌的阵营显示好人或狼人。',
    ],
    icon: 'chest',
    order: 40,
  },
};

export const ROLE_IDS = (Object.keys(ROLES) as RoleId[]).sort((a, b) => ROLES[a].order - ROLES[b].order);

export function roleName(id: RoleId): string {
  return ROLES[id].name;
}

export function isWolfRole(id: RoleId): boolean {
  return ROLES[id].faction === 'wolf';
}

/** Roles that are god cards (for 盗宝大师's buried-card split) */
export function isGodRole(id: RoleId): boolean {
  return ROLES[id].category === 'god';
}

export function isVillagerRole(id: RoleId): boolean {
  return ROLES[id].category === 'villager';
}

/** Skills the 机械狼 obtains by learning a role */
export type MechSkill = 'seer' | 'psychic' | 'poison' | 'guard' | 'gun' | 'double' | 'none';

export function mechSkillFor(learned: RoleId): MechSkill {
  switch (learned) {
    case 'seer':
      return 'seer';
    case 'psychic':
      return 'psychic';
    case 'witch':
    case 'poisoner':
      return 'poison';
    case 'guard':
      return 'guard';
    case 'hunter':
      return 'gun';
    case 'wolf':
    case 'wolfking':
    case 'whitewolfking':
      return 'double';
    default:
      return 'none';
  }
}

export const MECH_SKILL_TEXT: Record<MechSkill, string> = {
  seer: '每晚查验一名玩家是好人还是狼人',
  psychic: '每晚查验一名玩家的具体身份',
  poison: '拥有一瓶毒药',
  guard: '每晚守护一名玩家（挡刀、挡毒，不能连守）',
  gun: '被刀或被放逐出局时可以开枪',
  double: '狼队全部出局后的第一晚可以双刀（含一刀破盾刀）',
  none: '没有技能',
};
