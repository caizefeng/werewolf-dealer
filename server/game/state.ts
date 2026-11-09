// Internal (server-only) game state. Everything here is plain JSON so a room
// can be persisted to disk and restored after a restart.
import type { GameConfig } from '../../shared/config.ts';
import type { RoleId } from '../../shared/roles.ts';
import type {
  Announcement,
  HistoryDay,
  NightStepId,
  SpeechContext,
  VoteContext,
  Winner,
} from '../../shared/types.ts';

export type DeathCause =
  | 'knife'
  | 'poison'
  | 'dream'
  | 'exile'
  | 'shot'
  | 'whitewolf'
  | 'selfdestruct'
  | 'duel'
  | 'dance'
  | 'lovesick'
  | 'revenge';

export interface DeathRecord {
  causes: DeathCause[];
  time: 'night' | 'day';
  /** night number for night deaths, day number for day deaths */
  index: number;
  note: string;
}

export interface MechState {
  learned: RoleId | null;
  from: number | null;
  poison: boolean;
  guardLast: number | null;
  double: 'unused' | 'used' | 'expired';
}

export interface TreasureState {
  cards: RoleId[];
  faction: 'good' | 'wolf';
  countsAs: 'god' | 'villager' | 'wolf';
  current: number | null;
  last: number | null;
  /** poison still available per card index (毒师 / 女巫 cards) */
  poisons: boolean[];
  /** last use of the 摄梦人 card (盗宝摄梦隔夜梦亡) */
  lastDream: { night: number; target: number } | null;
  /** 盗宝蒙面 used its active skill (once per game) */
  maskUsed: boolean;
  /** an extra knife tonight after surviving an exile */
  extraKnife: boolean;
}

export interface Player {
  seat: number;
  role: RoleId;
  alive: boolean;
  death: DeathRecord | null;
  viewed: boolean;
  revealed: boolean;
  witch: { antidote: boolean; poison: boolean } | null;
  poisonerPoison: boolean;
  guardLast: number | null;
  dreamLast: number | null;
  crowLast: number | null;
  checks: { night: number; seat: number; result: string }[];
  mech: MechState | null;
  treasure: TreasureState | null;
  mixedModel: number | null;
  /** 魔术师 / 诡术师: numbers already swapped */
  swapUsed: number[];
  /** 诡术师 skipped last night (cannot skip twice in a row) */
  swapSkipped: boolean;
  /** 舞者: numbers that already danced */
  danced: number[];
  /** 狼美人: last night's charm (number) */
  charmLast: number | null;
  /** 假面: last night's mask (number) */
  maskLast: number | null;
  /** 骑士 / 定序王子: one-shot skill used */
  skillUsed: boolean;
}

export interface NightRecord {
  night: number;
  mixed?: number | null;
  mechLearn?: number | null;
  treasure?: { card: number; target: number | null; kill: number | null; kill2?: number | null };
  dream?: number | null;
  guard?: number | null;
  wolfPicks: Record<string, { target: number | null; confirmed: boolean }>;
  /** number swaps tonight in order (魔术师, 诡术师, 狼术师); [] = chose not to swap */
  swaps?: Partial<Record<'magician' | 'trickster' | 'wolfwizard', number[]>>;
  dance?: number[];
  masqueVerify?: { target: number | null; result: string };
  masque?: { mask: number | null; kill: number | null };
  charm?: number | null;
  /** 狼女孩's confession (the number she picked) */
  confess?: number | null;
  wolfTarget?: number | null;
  mechKill?: number[];
  witchSaw?: number[] | null;
  witch?: { save: number | null; poison: number | null };
  poison?: number | null;
  seer?: number | null;
  psychic?: number | null;
  curse?: number | null;
  mechSkill?: number | null;
  acks: string[];
  /** results shown to the actor, keyed by step */
  results: Record<string, string[]>;
  deaths: { seat: number; causes: DeathCause[] }[] | null;
  log: string[];
}

export type NightSub = 'intro' | 'open' | 'act' | 'close' | 'outro';

export interface NightPhase {
  kind: 'night';
  steps: NightStepId[];
  idx: number;
  sub: NightSub;
  /** end of the current timed sub-phase (intro/open/close/outro, fake act) */
  until: number;
  actMin: number;
  actMax: number;
  fake: boolean;
  doneAt: number | null;
}

export interface DeathEntry {
  seat: number;
  causes: DeathCause[];
  canShoot: boolean;
  shot: number | null | undefined;
  badge: boolean;
  badgeDone: boolean;
  /** 盗宝蒙面 deciding whether to survive the exile (the death is not applied yet) */
  mask?: boolean;
  done: boolean;
}

export type Phase =
  | { kind: 'dealt' }
  | NightPhase
  | { kind: 'interlude'; until: number }
  | { kind: 'signup'; deadline: number; responses: Record<string, boolean> }
  | { kind: 'speech'; context: SpeechContext; order: number[]; idx: number; startedAt: number }
  | { kind: 'withdraw'; deadline: number }
  | {
      kind: 'vote';
      context: VoteContext;
      candidates: number[];
      voters: number[];
      votes: Record<string, number | null>;
      deadline: number;
    }
  | {
      kind: 'deathSkills';
      entries: DeathEntry[];
      deadline: number;
      /** who gets last words once the skills are settled */
      lastWords: number[];
    }
  | { kind: 'orderChoice'; deadline: number }
  | { kind: 'princeWindow'; deadline: number; target: number; context: VoteContext; used: boolean; declined?: boolean }
  | { kind: 'ended' };

export type DayStage = 'election' | 'nightDeaths' | 'discussion' | 'exile';

export interface Election {
  signedUp: number[];
  candidates: number[];
  withdrawn: number[];
  selfDestructs: number;
  status: 'running' | 'suspended' | 'done';
  dir: 'cw' | 'ccw';
  pk: number[] | null;
  resumed: boolean;
}

export interface GameState {
  version: 1;
  gameNo: number;
  config: GameConfig;
  rng: number;
  players: Player[];
  buried: RoleId[] | null;
  night: number;
  day: number;
  phase: Phase;
  dayQueue: DayStage[];
  sheriff: number | null;
  badgeLost: boolean;
  election: Election | null;
  exilePk: number[] | null;
  /** night deaths that have not been announced yet */
  pending: { seat: number; causes: DeathCause[] }[];
  /** 蒙面人 hit at night: alive until their own speech the next day */
  wounded: { seat: number; causes: DeathCause[]; night: number }[];
  /** 狼美人's current charm (the charmed player) */
  charm: { by: number; target: number } | null;
  /** 狼女孩's confession: the number she picked, the player hit (after swaps), whether a 平民 became 狼混 */
  confession?: { by: number; picked: number; target: number; turned: boolean } | null;
  /** speech phase to continue once deaths/last words in the middle of it are settled */
  resume: { context: SpeechContext; order: number[]; idx: number } | null;
  /** night-1 deaths get last words even if announced late */
  pendingNight: number;
  nights: NightRecord[];
  /** players cursed by 乌鸦 (or 盗宝大师's 乌鸦 card) for today's exile vote */
  curses: number[];
  history: HistoryDay[];
  announcements: Announcement[];
  nextAnnId: number;
  winner: Winner | null;
  winReason: string;
  paused: { at: number } | null;
  /** speaking direction picked for today's discussion */
  discussionNote: string | null;
}
