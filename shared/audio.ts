// Judge voice lines. Each clip is pre-generated as client/public/audio/<id>.mp3
// by scripts/gen_audio.py; durations land in shared/audio-durations.json.
// Public audio must never carry private information (the witch hears the same
// line whatever happened; numbers are only spoken for public events).

export const CLIPS = {
  night_start: '天黑请闭眼。',
  dawn: '天亮了，请所有玩家睁眼。',

  mixed_open: '混血儿请睁眼。',
  mixed_act: '请选择你的榜样。',
  mixed_close: '混血儿请闭眼。',

  mech_open: '机械狼请睁眼。',
  mech_close: '机械狼请闭眼。',
  mechlearn_act: '请选择你要学习的玩家。',
  mechkill_act: '请确认你的带刀状态，可以带刀时请选择击杀目标。',
  mechskill_act: '请根据学习到的身份，选择技能目标。',

  treasure_open: '盗宝大师请睁眼。',
  treasure_act1: '请查看三张底牌，选择今晚使用的身份牌，并选择技能目标。',
  treasure_act: '请确认你的开刀状态，选择今晚使用的身份牌，并选择技能目标。',
  treasure_close: '盗宝大师请闭眼。',

  dreamer_open: '摄梦人请睁眼。',
  dreamer_act: '请选择今晚的梦游者。',
  dreamer_close: '摄梦人请闭眼。',

  guard_open: '守卫请睁眼。',
  guard_act: '请选择你要守护的玩家。',
  guard_close: '守卫请闭眼。',

  wolves_open: '狼人请睁眼。',
  wolves_act1: '狼人请互相确认身份，并选择今晚要击杀的玩家。',
  wolves_act: '请选择今晚要击杀的玩家。',
  wolves_close: '狼人请闭眼。',

  witch_open: '女巫请睁眼。',
  witch_act: '你要使用解药吗？你要使用毒药吗？',
  witch_close: '女巫请闭眼。',

  poisoner_open: '毒师请睁眼。',
  poisoner_act: '你要使用毒药吗？',
  poisoner_close: '毒师请闭眼。',

  seer_open: '预言家请睁眼。',
  check_act: '请选择你要查验的玩家。',
  seer_close: '预言家请闭眼。',

  psychic_open: '通灵师请睁眼。',
  psychic_close: '通灵师请闭眼。',

  crow_open: '乌鸦请睁眼。',
  crow_act: '请选择你要诅咒的玩家。',
  crow_close: '乌鸦请闭眼。',

  hunter_open: '猎人请睁眼。',
  status_gun: '请确认你的开枪状态。',
  hunter_close: '猎人请闭眼。',

  wolfking_open: '狼王请睁眼。',
  wolfking_close: '狼王请闭眼。',

  wwk_open: '白狼王请睁眼。',
  status_skill: '请确认你的技能状态。',
  wwk_close: '白狼王请闭眼。',

  masked_open: '蒙面人请睁眼。',
  masked_close: '蒙面人请闭眼。',

  whitegod_open: '白神请睁眼。',
  confirm_identity: '请确认你的身份。',
  whitegod_close: '白神请闭眼。',

  signup: '现在开始警长竞选，想要上警的玩家请在手机上举手。',
  signup_result: '上警的玩家是：',
  signup_none: '无人上警，警徽流失。',
  sheriff_speech: '请警上玩家依次发言。',
  speech_from: '从',
  speech_cw: '开始，顺序发言。',
  speech_ccw: '开始，逆序发言。',
  withdraw_continue: '警长竞选继续，警上玩家可以选择退水。',
  sheriff_vote: '请警下玩家投票。',
  pk_speech: '平票，请平票的玩家进行PK发言。',
  pk_vote: '请再次投票。',
  sheriff_elected: '当选警长。',
  badge_lost: '警徽流失。',
  election_postponed: '警长竞选推迟到明天。',
  last_night: '昨天晚上，',
  died_suffix: '玩家死亡。',
  peaceful: '昨天晚上是平安夜。',
  death_skill: '请出局的玩家确认是否发动技能。',
  please: '请',
  lw_suffix: '玩家发表遗言。',
  order_choose: '请警长选择发言顺序。',
  exile_vote: '发言结束，请所有存活玩家投票。',
  exiled_suffix: '玩家被放逐出局。',
  whitegod_flip: '玩家出局，翻牌为白神，请留遗言。',
  no_exile: '今天无人出局。',
  sd_suffix: '玩家自爆。',
  out_suffix: '玩家出局。',
  mask_survive: '玩家发动蒙面技能，被推不死。',
  wwk_take: '翻牌为白狼王，带走了',
  shot_mid: '玩家开枪，带走了',
  player: '玩家。',
  badge_pass: '警长将警徽移交给',
  badge_tear: '警长撕毁了警徽。',
  night_soon: '即将进入黑夜。',
  game_over_good: '游戏结束，好人阵营胜利。',
  game_over_wolf: '游戏结束，狼人阵营胜利。',
  game_over_draw: '游戏结束，双方同时达成胜利条件，平局。',
} as const;

export type FixedClipId = keyof typeof CLIPS;
/** number clips are n1..n20 ("1号".."20号") */
export type ClipId = FixedClipId | `n${number}`;

export const MAX_NUMBER_CLIP = 20;

export function allClips(): Record<string, string> {
  const out: Record<string, string> = { ...CLIPS };
  for (let i = 1; i <= MAX_NUMBER_CLIP; i++) out[`n${i}`] = `${i}号`;
  return out;
}

export function numClip(seat: number): ClipId {
  return `n${seat}` as ClipId;
}

/** Rough duration estimate used when the generated manifest is missing (tests). */
export function estimateDuration(id: string): number {
  const text = allClips()[id] ?? '';
  return Math.max(0.6, text.length * 0.24 + 0.3);
}
