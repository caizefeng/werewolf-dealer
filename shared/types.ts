// Wire protocol and view types shared by the server and the client.
import type { GameConfig } from './config.ts';
import type { MechSkill, RoleId } from './roles.ts';

export type NightStepId =
  | 'mixed'
  | 'mechLearn'
  | 'treasure'
  | 'dreamer'
  | 'guard'
  | 'wolves'
  | 'mechKill'
  | 'witch'
  | 'poisoner'
  | 'seer'
  | 'psychic'
  | 'crow'
  | 'mechSkill'
  | 'hunterStatus'
  | 'wolfkingStatus'
  | 'wwkStatus'
  | 'maskedConfirm'
  | 'whitegodConfirm';

export type Winner = 'good' | 'wolf' | 'draw';

export interface Announcement {
  id: number;
  at: number;
  text: string;
  clips: string[];
}

export interface SeatView {
  seat: number;
  name: string | null;
  occupied: boolean;
  connected: boolean;
  owner: boolean;
  alive: boolean;
  sheriff: boolean;
  /** publicly known role (白神翻牌, 开枪, 白狼王带人, 游戏结束) */
  revealed: RoleId | null;
  /** short public note for dead players, e.g. "第2天放逐" */
  deadNote: string | null;
  viewedRole: boolean;
  /** seat released by the owner during a game, waiting to be re-claimed */
  claimable: boolean;
}

export type SpeechContext = 'sheriff' | 'sheriffPk' | 'discussion' | 'exilePk' | 'lastWords';
export type VoteContext = 'sheriff' | 'sheriffPk' | 'exile' | 'exilePk';

export type PhaseView =
  | { kind: 'dealt'; viewed: number; total: number }
  | { kind: 'night'; step: NightStepId | null; stepName: string; sub: 'intro' | 'open' | 'act' | 'close' | 'outro' }
  | { kind: 'interlude' }
  | { kind: 'signup'; responded: number; total: number }
  | {
      kind: 'speech';
      context: SpeechContext;
      order: number[];
      idx: number;
      startedAt: number;
      candidates: number[];
      withdrawn: number[];
    }
  | { kind: 'withdraw'; candidates: number[]; withdrawn: number[] }
  | { kind: 'vote'; context: VoteContext; candidates: number[]; voters: number[]; voted: number[] }
  | { kind: 'deathSkills'; entries: { seat: number; done: boolean }[] }
  | { kind: 'orderChoice'; sheriff: number }
  | { kind: 'ended'; winner: Winner };

/** Generic seat-picking night prompt */
export interface PickPrompt {
  kind: 'pick';
  step: NightStepId;
  title: string;
  lines: string[];
  options: number[];
  /** max number of targets (2 for 机械狼双刀) */
  max: number;
  /** may submit without a target */
  allowNone: boolean;
  noneLabel: string;
  confirmLabel: string;
  /** submitted targets (null = not yet submitted) */
  submitted: number[] | null;
  /** result lines shown after submitting (查验结果 …) */
  result: string[];
}

export interface WolvesPrompt {
  kind: 'wolves';
  title: string;
  lines: string[];
  options: number[];
  teammates: { seat: number; role: RoleId; alive: boolean }[];
  picks: { seat: number; target: number | null | undefined; confirmed: boolean }[];
  myPick: number | null | undefined;
  myConfirmed: boolean;
  locked: boolean;
  final: number | null | undefined;
}

export interface WitchPrompt {
  kind: 'witch';
  title: string;
  /** knife targets; null = unknown (antidote already used) */
  knifed: number[] | null;
  antidote: boolean;
  poison: boolean;
  saveOptions: number[];
  saveBlockedReason: string | null;
  poisonOptions: number[];
  submitted: { save: number | null; poison: number | null } | null;
}

export interface TreasurePrompt {
  kind: 'treasure';
  title: string;
  lines: string[];
  cards: RoleId[];
  allowedCards: number[];
  /** per card: which skill it gives tonight */
  cardSkills: { card: number; skill: TreasureSkill; label: string; mandatory: boolean; options: number[] }[];
  canKill: boolean;
  /** 2 on the night after 盗宝蒙面 survived an exile (多一刀) */
  killMax: number;
  killOptions: number[];
  submitted: { card: number; target: number | null; kill: number | null; kill2?: number | null } | null;
  result: string[];
}

export type TreasureSkill = 'seer' | 'psychic' | 'poison' | 'guard' | 'dream' | 'curse' | 'none';

export interface StatusPrompt {
  kind: 'status';
  step: NightStepId;
  title: string;
  lines: string[];
  acked: boolean;
}

export interface SignupPrompt {
  kind: 'signup';
  joined: boolean | null;
}

export interface VotePrompt {
  kind: 'vote';
  context: VoteContext;
  candidates: number[];
  myVote: number | null | undefined;
}

export interface DeathSkillPrompt {
  kind: 'deathSkill';
  canShoot: boolean;
  shootOptions: number[];
  shot: number | null | undefined;
  badge: boolean;
  badgeOptions: number[];
  badgeDone: boolean;
  /** 盗宝蒙面 may use the active 蒙面 skill: survive the exile */
  mask: boolean;
  done: boolean;
}

export interface OrderPrompt {
  kind: 'orderChoice';
  cwFirst: number;
  ccwFirst: number;
}

export type Prompt =
  | PickPrompt
  | WolvesPrompt
  | WitchPrompt
  | TreasurePrompt
  | StatusPrompt
  | SignupPrompt
  | VotePrompt
  | DeathSkillPrompt
  | OrderPrompt;

export interface SkillView {
  /** null when the role can never self-destruct */
  selfDestruct: { available: boolean; canTake: boolean; reason: string | null; targets: number[] } | null;
  /** private status lines (potions, last guard target …) */
  notes: string[];
}

export interface PrivateView {
  seat: number;
  role: RoleId;
  /** current faction (盗宝大师 resolved) */
  faction: 'good' | 'wolf';
  countsAs: 'god' | 'villager' | 'wolf';
  info: string[];
  teammates: { seat: number; role: RoleId; alive: boolean }[];
  checks: { night: number; seat: number; result: string }[];
  treasureCards: RoleId[] | null;
  mech: { learned: RoleId | null; from: number | null; skill: MechSkill } | null;
  prompt: Prompt | null;
  /** deadline of my own night action (night deadlines are never public: they would
   *  reveal whether the called role is alive) */
  deadline: number | null;
  skills: SkillView;
  /** public alive flag (night deaths stay hidden until announced) */
  alive: boolean;
}

export interface VoteRow {
  target: number;
  voters: number[];
  score: number;
  curse: boolean;
}

export interface HistoryEvent {
  kind: 'death' | 'vote' | 'sheriff' | 'skill' | 'selfDestruct' | 'info';
  text: string;
  votes?: { context: VoteContext; rows: VoteRow[]; abstain: number[] };
}

export interface HistoryDay {
  day: number;
  events: HistoryEvent[];
}

export interface GameResult {
  winner: Winner;
  reason: string;
  players: {
    seat: number;
    name: string | null;
    role: RoleId;
    faction: 'good' | 'wolf';
    won: boolean;
    alive: boolean;
    note: string | null;
  }[];
  buried: RoleId[] | null;
  nights: { night: number; lines: string[] }[];
}

export interface GameView {
  gameNo: number;
  day: number;
  night: number;
  time: 'dealt' | 'night' | 'day' | 'ended';
  phase: PhaseView;
  banner: { title: string; sub: string | null };
  deadline: number | null;
  paused: boolean;
  sheriff: number | null;
  badgeLost: boolean;
  announcements: Announcement[];
  history: HistoryDay[];
  you: PrivateView | null;
  result: GameResult | null;
  nightSteps: string[];
}

export interface RoomView {
  roomId: string;
  now: number;
  you: { name: string; seat: number | null; owner: boolean };
  config: GameConfig;
  playerCount: number;
  seats: SeatView[];
  status: 'lobby' | 'game';
  game: GameView | null;
  ownerKey: string | null;
}

export type GameAction =
  | { type: 'viewRole' }
  | { type: 'pick'; step: NightStepId; targets: number[] }
  | { type: 'wolfPick'; target: number | null; confirm: boolean }
  | { type: 'witch'; save: number | null; poison: number | null }
  | { type: 'treasure'; card: number; target: number | null; kill: number | null; kill2?: number | null }
  | { type: 'ack'; step: NightStepId }
  | { type: 'signup'; join: boolean }
  | { type: 'withdraw' }
  | { type: 'vote'; target: number | null }
  | { type: 'endSpeech' }
  | { type: 'selfDestruct'; target: number | null }
  | { type: 'shoot'; target: number | null }
  | { type: 'badge'; target: number | null }
  | { type: 'skillDone' }
  | { type: 'mask'; use: boolean }
  | { type: 'order'; dir: 'cw' | 'ccw' };

export type OwnerCommand =
  | { type: 'deal' }
  | { type: 'start' }
  | { type: 'next' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'restart' }
  | { type: 'reconfigure'; config: GameConfig }
  | { type: 'abort' }
  | { type: 'kick'; seat: number }
  | { type: 'order'; dir: 'cw' | 'ccw' }
  /** test hook (server started with TEST_HOOKS=1 only): deal fixed roles */
  | { type: 'debugDeal'; seats: string[]; buried?: string[] };

export type ClientMsg =
  | { t: 'hello'; room: string; client: string; name?: string; ownerKey?: string }
  | { t: 'sit'; seat: number }
  | { t: 'stand' }
  | { t: 'rename'; name: string }
  | { t: 'act'; action: GameAction }
  | { t: 'owner'; cmd: OwnerCommand }
  | { t: 'ping' };

export type ServerMsg =
  | { t: 'state'; view: RoomView }
  | { t: 'error'; message: string }
  | { t: 'pong'; now: number };
