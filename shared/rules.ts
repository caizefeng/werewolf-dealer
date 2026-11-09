// General rules text shown in the in-game rules panel (京城大师赛 conventions).
// Lines about special roles appear only when the room's config contains them.
import type { RoleCounts, RuleOptions } from './config.ts';
import { ROLES, type RoleId } from './roles.ts';

export interface RuleSection {
  title: string;
  items: string[];
}

export function generalRules(r: RuleOptions, roles: RoleCounts = {}): RuleSection[] {
  const has = (id: RoleId) => (roles[id] ?? 0) > 0;
  const noSelfDestruct = (Object.keys(roles) as RoleId[])
    .filter((id) => has(id) && ROLES[id].faction === 'wolf' && !ROLES[id].canSelfDestruct)
    .map((id) => ROLES[id].name);
  const noSd = noSelfDestruct.length ? `${noSelfDestruct.join('、')}不能自爆。` : '';
  const swappers = (['magician', 'trickster', 'wolfwizard'] as const).filter(has).map((id) => ROLES[id].name);
  const sim = { wolf: '狼人阵营胜利', good: '好人阵营胜利', draw: '平局' }[r.simultaneousWin];
  const sections: RuleSection[] = [
    {
      title: '胜负（屠边）',
      items: [
        '狼人阵营：所有神职出局，或所有平民出局（屠边），即获得胜利。',
        '好人阵营：所有狼人阵营的玩家出局，即获得胜利。',
        '胜利条件一旦达成，游戏立即结束，之后的技能不再发动（例如作为最后一名神职出局的猎人不能开枪）。',
        `双方因同一事件同时达成胜利条件时：${sim}。`,
        '混血儿的胜负跟随其榜样的阵营。',
      ],
    },
  ];
  if (r.sheriff) {
    sections.push(
      {
        title: '上警与警徽',
        items: [
          '第一天天亮后、公布昨夜死讯之前进行警长竞选。昨夜出局的玩家此时还不知道自己出局，仍然可以上警、发言和投票。',
          '想竞选的玩家在倒计时内选择「上警」。上警玩家按随机的起点和方向依次发言，发言期间可以随时退水。',
          '发言结束后只剩一名上警玩家时直接当选；无人上警或全部退水时警徽流失。',
          '由未上警的玩家投票（退水的玩家没有投票权，可以弃票），得票最多者当选警长。',
          '平票时平票的玩家进行PK发言，然后警下玩家再次投票；再次平票则警徽流失。',
          '警长在放逐投票中计1.5票；警长决定白天的发言方向（从警长左手或右手边开始），并最后发言归票。',
          '警长出局时可以将警徽移交给一名存活玩家，或者撕毁警徽（警徽流失）。',
        ],
      },
      {
        title: r.badgeSwallow === 'double' ? '自爆与双爆吞警徽' : '自爆与单爆吞警徽',
        items: [
          `狼人可以在白天的发言阶段（警上发言、退水环节、PK发言、放逐发言）自爆。${noSd}`,
          '自爆的狼人没有遗言。自爆后若尚未公布昨夜死讯则先公布，然后直接进入黑夜，当天不再放逐投票。',
          r.badgeSwallow === 'double'
            ? '警长竞选期间第一次自爆：竞选推迟到第二天，保留当时的警上玩家，第二天从退水环节继续投票；竞选期间第二次自爆：警徽流失（双爆吞警徽）。'
            : '警长竞选期间有狼人自爆：警徽流失（单爆吞警徽）。',
          '前一晚被毒杀的白狼王在警上自爆（吞毒自爆）不能带人。',
        ],
      },
    );
  } else {
    sections.push({
      title: '自爆',
      items: [
        `本局没有警长。狼人可以在白天的发言阶段自爆。${noSd}`,
        '自爆的狼人没有遗言，当天直接进入黑夜，不再放逐投票。',
      ],
    });
  }
  sections.push(
    {
      title: '放逐投票',
      items: [
        '发言结束后所有存活玩家同时投票（可以弃票），得票最多的玩家被放逐出局。',
        '平票时平票的玩家进行PK发言，其余存活玩家在平票玩家中再次投票；再次平票则当天无人出局。',
        '无人得票时当天无人出局。',
        ...(has('prince')
          ? ['定序王子在场且未发动技能时，每次放逐投票出结果后都会等待固定的时间（即使定序王子已经出局），由定序王子决定是否翻牌作废本次放逐。']
          : []),
        ...(has('knight') ? ['骑士只能在放逐发言（含PK发言）环节翻牌决斗；决斗出狼人后当天不再放逐投票，直接进入黑夜。'] : []),
      ],
    },
    {
      title: '遗言',
      items: [
        '第一晚出局的玩家、被放逐的玩家、白天被枪带走的玩家有遗言。',
        '第二晚起夜间出局的玩家、自爆的玩家、被白狼王带走的玩家没有遗言。',
        ...(has('knight') ? ['被骑士决斗出局的狼人没有遗言；决斗失败出局的骑士有遗言。'] : []),
        ...(has('wolfbeauty') ? ['殉情出局的玩家没有遗言。'] : []),
        ...(has('wolfgirl') ? ['狼女孩自爆时随之出局的表白对象没有遗言。'] : []),
      ],
    },
    {
      title: '夜间结算',
      items: [
        r.witchSelfSave === 'never'
          ? '女巫全程不能自救，同一晚只能使用一瓶药。'
          : r.witchSelfSave === 'firstNight'
            ? '女巫仅第一晚可以自救，同一晚只能使用一瓶药。'
            : '女巫可以自救，同一晚只能使用一瓶药。',
        '同守同救：守卫守护和女巫解药作用于同一名玩家时，该玩家死亡。',
        '守卫的守护只能抵挡狼刀，不能抵挡毒药。',
        r.dreamBlocksPoison
          ? '梦游者免疫当晚的狼刀和毒药；连续两晚梦游或摄梦人夜间出局时，梦游者梦亡。'
          : '梦游者免疫当晚的狼刀，但不免疫毒药；连续两晚梦游或摄梦人夜间出局时，梦游者梦亡。',
        '被毒杀或梦亡的猎人、狼王不能开枪。',
        ...(has('masked') ? ['蒙面人夜间被刀、被毒或梦亡时不会出现在当晚死讯中，而是在第二天自己发言结束后出局。'] : []),
        ...(swappers.length
          ? [
              `号码交换按${swappers.join(' → ')}的顺序依次生效：当晚作用在一个号码上的所有技能（狼刀、毒药、解药、守护、查验、共舞、面具、魅惑等）都作用到与之交换的玩家身上。女巫看到的刀口是狼人选择的号码。`,
            ]
          : []),
        ...(has('dancer')
          ? ['舞池中阵营不同时人数少的一方出局，解药和守护都挡不住；舞池出局、决斗出局和殉情的猎人、狼王不能开枪。']
          : []),
        ...(r.firstNightNoKnife ? ['首夜禁刀：第一晚狼人只互相确认身份，任何人都不能刀人（毒药等其他技能照常）。'] : []),
        '夜间所有角色都会被依次呼叫（包括已经出局的角色），以免暴露身份信息。',
      ],
    },
  );
  return sections;
}

/** the full order of every night step (the rules panel shows the room's own steps once a game runs) */
export const NIGHT_ORDER_TEXT =
  '魔术师 → 诡术师 → 狼术师（次夜起）→ 混血儿（首夜）→ 机械狼学习（首夜）→ 盗宝大师 → 舞者（次夜起）→ 假面 → 摄梦人 → 守卫 → 狼人 → 狼美人魅惑 → 狼女孩表白（首夜）→ 被表白者（首夜）→ 机械狼刀人 → 女巫 → 毒师 → 预言家 → 通灵师 → 乌鸦 → 机械狼技能 → 猎人 → 狼王 → 白狼王 → 蒙面人（首夜）→ 白神（首夜）';
