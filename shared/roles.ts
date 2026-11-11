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
  | 'knight'
  | 'dancer'
  | 'magician'
  | 'prince'
  | 'mixed'
  | 'wolf'
  | 'wolfking'
  | 'whitewolfking'
  | 'mechwolf'
  | 'wolfbeauty'
  | 'trickster'
  | 'wolfwizard'
  | 'masque'
  | 'wolfgirl'
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
  knight: {
    id: 'knight',
    name: '骑士',
    category: 'god',
    faction: 'good',
    pack: false,
    canSelfDestruct: false,
    short: '白天翻牌决斗一人：狼人出局，好人则骑士出局',
    rules: [
      '放逐发言环节（含放逐PK发言）可以随时翻牌，与一名存活玩家决斗，整局一次；警长竞选环节不能决斗。',
      '对方是狼人阵营：对方出局（没有遗言），当天直接进入黑夜。被决斗的狼王不能开枪，狼美人的魅惑失效。',
      '对方是好人：骑士出局，留下遗言后继续发言环节。',
    ],
    icon: 'sword',
    order: 22,
  },
  dancer: {
    id: 'dancer',
    name: '舞者',
    category: 'god',
    faction: 'good',
    pack: false,
    canSelfDestruct: false,
    short: '次夜起选三人共舞，少数阵营出局',
    rules: [
      '从第二晚起，每晚可以选择三名玩家进入舞池（共舞），每名玩家整局只能进入一次舞池。',
      '天亮结算：三人同属一个阵营则无事发生；阵营不同时，人数少的一方出局（不能被解药或守护挡下）。',
      '舞者选择自己共舞时，当晚舞池中的三人都免疫狼刀。',
      '舞者免疫女巫的毒药。',
    ],
    icon: 'music',
    order: 23,
  },
  magician: {
    id: 'magician',
    name: '魔术师',
    category: 'god',
    faction: 'good',
    pack: false,
    canSelfDestruct: false,
    short: '每晚交换两个号码，当晚技能作用互换',
    rules: [
      '每晚可以交换两名玩家的号码（可以包括自己，也可以不交换）：当晚所有作用在其中一个号码上的技能（狼刀、毒药、解药、守护、查验等）都作用到另一名玩家身上。',
      '每个号码整局只能被魔术师交换一次。交换只在当晚有效。',
      '在「魔幻对决」中第二晚起才能交换（首夜只确认身份）。',
      '与诡术师当晚交换的两个号码完全相同时，两者均无效。',
    ],
    icon: 'wand',
    order: 24,
  },
  prince: {
    id: 'prince',
    name: '定序王子',
    category: 'god',
    faction: 'good',
    pack: false,
    canSelfDestruct: false,
    short: '放逐投票后可翻牌，作废本次放逐并重新投票',
    rules: [
      '放逐投票产生出局结果后，可以翻牌发动技能：本次放逐作废，定序王子进行一次额外发言后重新组织投票。整局一次。',
      '只对放逐投票有效，警长竞选不能发动；定序王子额外发言期间狼人不能自爆。',
    ],
    icon: 'hourglass',
    order: 25,
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
  wolfbeauty: {
    id: 'wolfbeauty',
    name: '狼美人',
    category: 'wolf',
    faction: 'wolf',
    pack: true,
    canSelfDestruct: false,
    short: '每晚魅惑一人，被放逐或毒杀时带走被魅惑者',
    rules: [
      '与狼队一起选择击杀目标，之后单独睁眼魅惑一名玩家（不能魅惑自己，不能连续两晚魅惑同一人）。狼队不能刀狼美人。',
      '狼美人被放逐或被毒杀时，被魅惑的玩家殉情出局（殉情的玩家没有遗言，猎人不能开枪）。',
      '被骑士决斗出局时魅惑失效；其他方式出局也不会殉情。',
      '不能自爆。作为最后一名狼人被放逐、且殉情带走了最后一名神职或平民时，狼人阵营获胜。',
    ],
    icon: 'rose',
    order: 34,
  },
  trickster: {
    id: 'trickster',
    name: '诡术师',
    category: 'wolf',
    faction: 'wolf',
    pack: true,
    canSelfDestruct: true,
    short: '狼人阵营，每晚交换两个号码',
    rules: [
      '狼人阵营，与狼队一起行动。每晚在魔术师之后睁眼，可以交换两名玩家的号码：当晚作用在其中一个号码上的技能作用到另一名玩家身上。',
      '每名玩家整局只能被诡术师交换一次；可以选择不交换，但不能连续两晚不交换。',
      '与魔术师当晚交换的两个号码完全相同时，两者均无效。',
    ],
    icon: 'cards',
    order: 35,
  },
  wolfwizard: {
    id: 'wolfwizard',
    name: '狼术师',
    category: 'wolf',
    faction: 'wolf',
    pack: true,
    canSelfDestruct: true,
    short: '狼人阵营，次夜起在魔术师之后再换两个座位',
    rules: [
      '狼人阵营，与狼队一起行动。从第二晚起，每晚在魔术师之后睁眼，可以再次交换两名玩家的座位：当晚作用在其中一个座位上的技能作用到另一名玩家身上。',
      '与魔术师交换同一对座位时相当于换回原位。',
    ],
    icon: 'wolf-star',
    order: 36,
  },
  masque: {
    id: 'masque',
    name: '假面',
    category: 'wolf',
    faction: 'wolf',
    pack: false,
    canSelfDestruct: false,
    short: '不与狼队见面；可验证舞池并赐予面具',
    rules: [
      '狼人阵营，与狼队互不见面，不能自爆。普通狼人（狼队）全部出局后接刀，此后每晚自己开刀。',
      '从第二晚起，每晚可以验证一名玩家当晚是否在舞池中，并可以赐予一名玩家面具：被赐予面具的玩家当晚在舞池中按相反阵营计算（只在舞池内、只在当晚有效）。不能连续两晚给同一名玩家面具。',
      '假面免疫女巫的毒药。',
    ],
    icon: 'theater',
    order: 37,
  },
  wolfgirl: {
    id: 'wolfgirl',
    name: '狼女孩',
    category: 'wolf',
    faction: 'wolf',
    pack: true,
    canSelfDestruct: true,
    short: '首夜表白一人：平民成为狼混；自爆时表白对象随之出局',
    rules: [
      '狼人阵营，与狼队一起睁眼。首夜在狼队之后单独睁眼，向一名玩家表白（必须表白，不能表白自己和狼队友），整局一次。',
      '被表白的平民成为狼混：身份牌仍是平民，预言家查验仍是好人，但与狼人阵营共同胜利（屠边时仍计入平民）。',
      '被表白的神职默认拒绝：身份、阵营和技能都不变。被表白者只知道自己被表白，不知道狼女孩是谁；狼女孩也不知道对方是否接受。',
      '狼女孩白天自爆时，表白对象（若仍存活）随之出局，两人都没有遗言；被带走的猎人不能开枪。以放逐、毒杀等其他方式出局时，表白对象不受影响。',
      '所有狼人（含狼女孩）出局即好人胜利，狼混仍存活也不影响。',
    ],
    icon: 'heart',
    order: 38,
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
      '· 学习守卫（机械守卫）：每晚可以守护一名玩家，挡狼刀；被守护的玩家被毒时，毒药反弹给用毒的人（弹毒），被守护的玩家不死。弹毒整局只有一次，用过后守护只能挡刀；不能连续两晚守护同一人。',
      '· 学习猎人：被狼人击杀或被放逐出局时可以开枪（被毒不能开枪）。',
      '· 学习狼人阵营的身份（狼人、狼王、白狼王、狼美人、诡术师、狼术师、假面）：成为双刀狼，普通狼人全部出局后的第一个夜晚可以刀两人，其中一刀为破盾刀，无视守卫守护；那一晚不用则作废。',
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
    default:
      // any wolf-faction card (狼人、狼王、白狼王、狼美人、诡术师、狼术师、假面) → 双刀
      return ROLES[learned].faction === 'wolf' && learned !== 'mechwolf' ? 'double' : 'none';
  }
}

export const MECH_SKILL_TEXT: Record<MechSkill, string> = {
  seer: '每晚查验一名玩家是好人还是狼人',
  psychic: '每晚查验一名玩家的具体身份',
  poison: '拥有一瓶毒药',
  guard: '每晚守护一名玩家：挡狼刀；被守护的人被毒时，毒药反弹给用毒的人（弹毒，整局一次）；不能连守',
  gun: '被刀或被放逐出局时可以开枪',
  double: '狼队全部出局后的第一晚可以双刀（含一刀破盾刀）',
  none: '没有技能',
};
