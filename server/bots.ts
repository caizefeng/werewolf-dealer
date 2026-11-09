// Built-in bot players. The owner seats them in the lobby (or lets one take over a released seat
// during a game) and the room plays for them (Room.planBots). A bot decides only from the RoomView
// of its own seat, the same projection a phone gets, so it never knows more than a person in that
// seat would. Bots play simply: night skills on plausible random targets, votes that lean on what
// they know, speeches that end after a few seconds, and never a 自爆 or 决斗 of their own.
import { ROLES, ROLE_IDS } from '../shared/roles.ts';
import type { GameAction, GameView, PickPrompt, PrivateView, Prompt, RoomView, VotePrompt, WolvesPrompt } from '../shared/types.ts';

export const BOT_PREFIX = 'bot:';
export const BOT_NAME = '机器人';

/** bot client ids contain ':' which real client ids (CLIENT_ID_RE) never do */
export const isBotId = (id: string | null | undefined): boolean => typeof id === 'string' && id.startsWith(BOT_PREFIX);

export interface BotMove {
  /** identity of the decision: the room keeps one timer per bot and decision */
  key: string;
  /** thinking time in game seconds (scaled like every other duration) */
  think: number;
  action: GameAction;
}

// ── seeded randomness: the same decision always comes out the same way ──

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function prng(seed: string): () => number {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rnd = () => number;

function pickOne(r: Rnd, xs: readonly number[]): number | null {
  return xs.length ? xs[Math.floor(r() * xs.length)] : null;
}

function pickN(r: Rnd, xs: readonly number[], n: number): number[] {
  const pool = xs.slice();
  const out: number[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  return out;
}

/** a 查验 result: 预言家 sees 好人/狼人, 通灵师 a role name */
function checkSaysWolf(result: string): boolean | null {
  if (result === '狼人') return true;
  if (result === '好人') return false;
  const id = ROLE_IDS.find((r) => ROLES[r].name === result);
  return id ? ROLES[id].faction === 'wolf' : null;
}

/** the number in "昨晚…：X号" on a prompt (摄梦人 must not dream of the same player twice by accident) */
function lastNight(p: PickPrompt): number | null {
  for (const l of p.lines) {
    const m = /^昨晚[^：]*：(\d+)号/.exec(l);
    if (m) return Number(m[1]);
  }
  return null;
}

/** what one bot knows: its own seat's view and nothing else */
class Mind {
  readonly v: RoomView;
  readonly g: GameView;
  readonly me: PrivateView;
  readonly seat: number;
  readonly salt: string;
  readonly wolf: boolean;
  /** wolf teammates who know each other (not me) */
  readonly mates: Set<number>;
  readonly wolves = new Set<number>();
  readonly goods = new Set<number>();

  constructor(v: RoomView, g: GameView, me: PrivateView, salt: string) {
    this.v = v;
    this.g = g;
    this.me = me;
    this.seat = me.seat;
    this.salt = salt;
    this.wolf = me.faction === 'wolf';
    this.mates = new Set(me.teammates.map((t) => t.seat).filter((x) => x !== me.seat));
    for (const c of me.checks) {
      const w = checkSaysWolf(c.result);
      if (w === true) this.wolves.add(c.seat);
      else if (w === false) this.goods.add(c.seat);
    }
    for (const s of v.seats) {
      if (!s.revealed || s.seat === this.seat) continue;
      if (ROLES[s.revealed].faction === 'wolf') this.wolves.add(s.seat);
      else this.goods.add(s.seat);
    }
  }

  /** decision keys are unique per game, day and night */
  private k(key: string): string {
    return `${this.g.gameNo}:${this.g.day}:${this.g.night}:${key}`;
  }

  move(key: string, think: [number, number], build: (r: Rnd) => GameAction | null): BotMove | null {
    const full = this.k(key);
    const r = prng(`${this.salt}|${this.seat}|${full}`);
    const t = think[0] + r() * (think[1] - think[0]);
    const action = build(r);
    return action ? { key: full, think: t, action } : null;
  }

  /** someone to hurt (knife, poison, curse, exile, shot): never a teammate, a known wolf first for the good side */
  hostile(r: Rnd, options: readonly number[]): number | null {
    const pool = options.filter((x) => x !== this.seat && !this.mates.has(x));
    if (this.wolf) return pickOne(r, pool);
    const known = pool.filter((x) => this.wolves.has(x));
    if (known.length) return pickOne(r, known);
    const unknown = pool.filter((x) => !this.goods.has(x));
    return pickOne(r, unknown.length ? unknown : pool);
  }

  /** someone to help (save, guard, badge, sheriff vote): wolves help teammates, the good side avoids known wolves */
  friendly(r: Rnd, options: readonly number[]): number | null {
    if (this.wolf) {
      const m = options.filter((x) => this.mates.has(x));
      return pickOne(r, m.length ? m : options);
    }
    const good = options.filter((x) => this.goods.has(x) && x !== this.seat);
    if (good.length) return pickOne(r, good);
    const safe = options.filter((x) => !this.wolves.has(x));
    return pickOne(r, safe.length ? safe : options);
  }

  /** someone to look at (查验, 验证): not checked yet, not myself, not a teammate */
  probe(r: Rnd, options: readonly number[]): number | null {
    const checked = new Set(this.me.checks.map((c) => c.seat));
    const pool = options.filter((x) => x !== this.seat && !this.mates.has(x));
    const fresh = pool.filter((x) => !checked.has(x));
    return pickOne(r, fresh.length ? fresh : pool.length ? pool : options);
  }

  decide(p: Prompt): BotMove | null {
    const g = this.g;
    switch (p.kind) {
      case 'status':
        return p.acked ? null : this.move(`ack-${p.step}`, [1.5, 3], () => ({ type: 'ack', step: p.step }));
      case 'pick':
        return p.submitted ? null : this.move(`pick-${p.step}`, [2, 5], (r) => this.pick(p, r));
      case 'wolves':
        return this.wolvesMove(p);
      case 'witch':
        if (p.submitted) return null;
        return this.move('witch', [2, 5], (r) => {
          if (p.antidote && p.saveOptions.length && r() < (g.night === 1 ? 0.9 : 0.4))
            return { type: 'witch', save: this.friendly(r, p.saveOptions), poison: null };
          if (p.poison && p.poisonOptions.length && g.night >= 2 && r() < 0.25)
            return { type: 'witch', save: null, poison: this.hostile(r, p.poisonOptions) };
          return { type: 'witch', save: null, poison: null };
        });
      case 'treasure':
        if (p.submitted) return null;
        return this.move('treasure', [2.5, 5.5], (r) => {
          const skillOf = (c: number) => p.cardSkills.find((x) => x.card === c);
          // a card whose skill must hit someone is useless without a target
          const usable = p.allowedCards.filter((c) => !(skillOf(c)?.mandatory && !skillOf(c)?.options.length));
          const card = pickOne(r, usable.length ? usable : p.allowedCards);
          if (card == null) return null;
          const sk = skillOf(card);
          let target: number | null = null;
          if (sk && sk.skill !== 'none' && sk.options.length) {
            const use = sk.mandatory || (sk.skill === 'poison' ? g.night >= 2 && r() < 0.3 : r() < 0.85);
            if (use) {
              if (sk.skill === 'seer' || sk.skill === 'psychic') target = this.probe(r, sk.options);
              else if (sk.skill === 'poison' || sk.skill === 'curse') target = this.hostile(r, sk.options);
              else target = this.friendly(r, sk.options);
            }
            if (target == null && sk.mandatory) target = pickOne(r, sk.options);
          }
          let kill: number | null = null;
          let kill2: number | null = null;
          if (p.canKill) {
            kill = this.hostile(r, p.killOptions);
            if (kill != null && p.killMax >= 2) kill2 = this.hostile(r, p.killOptions.filter((x) => x !== kill));
          }
          return { type: 'treasure', card, target, kill, kill2 };
        });
      case 'masque':
        if (p.submitted) return null;
        if (!p.verified && p.verifyOptions.length)
          return this.move('masque-verify', [2, 4], (r) => ({ type: 'masqueVerify', target: r() < 0.85 ? this.probe(r, p.verifyOptions) : null }));
        return this.move('masque-act', [2, 4], (r) => ({
          type: 'masqueAct',
          mask: p.maskOptions.length && r() < 0.8 ? pickOne(r, p.maskOptions) : null,
          kill: p.canKill ? this.hostile(r, p.killOptions) : null,
        }));
      case 'signup':
        if (p.joined !== null) return null;
        return this.move(`signup-${g.deadline}`, [1.5, 5], (r) => ({ type: 'signup', join: r() < (this.me.checks.length ? 0.6 : 0.3) }));
      case 'vote':
        if (p.myVote !== undefined) return null;
        return this.move(`vote-${p.context}-${g.deadline}`, [2, 6], (r) => ({ type: 'vote', target: this.vote(p, `vote-${p.context}-${g.deadline}`, r) }));
      case 'deathSkill':
        if (p.done) return null;
        if (p.mask) return this.move(`mask-${g.deadline}`, [1.5, 3], () => ({ type: 'mask', use: true }));
        if (p.badge && !p.badgeDone)
          return this.move(`badge-${g.deadline}`, [2, 4], (r) => ({ type: 'badge', target: this.friendly(r, p.badgeOptions) }));
        if (p.canShoot && p.shot === undefined)
          return this.move(`shoot-${g.deadline}`, [2, 4], (r) => {
            const known = this.wolf ? [] : p.shootOptions.filter((x) => this.wolves.has(x));
            if (known.length) return { type: 'shoot', target: pickOne(r, known) };
            return { type: 'shoot', target: r() < (this.wolf ? 0.85 : 0.5) ? this.hostile(r, p.shootOptions) : null };
          });
        return this.move(`done-${g.deadline}`, [1, 2], () => ({ type: 'skillDone' }));
      case 'orderChoice':
        return this.move(`order-${g.deadline}`, [2, 4], (r) => ({ type: 'order', dir: r() < 0.5 ? 'cw' : 'ccw' }));
      case 'prince':
        if (p.decided) return null;
        return this.move(`prince-${g.deadline}`, [2, 4], (r) => ({ type: 'prince', use: r() < (p.target === this.seat ? 0.9 : 0.2) }));
      default:
        return null;
    }
  }

  private pick(p: PickPrompt, r: Rnd): GameAction | null {
    const o = p.options;
    const none: GameAction | null = p.allowNone ? { type: 'pick', step: p.step, targets: [] } : null;
    const one = (t: number | null): GameAction | null => (t == null ? none : { type: 'pick', step: p.step, targets: [t] });
    const several = (n: number): GameAction | null => {
      const ts = pickN(r, o, Math.min(Math.max(n, p.min, 1), p.max));
      return ts.length >= Math.max(1, p.min) ? { type: 'pick', step: p.step, targets: ts } : none;
    };
    /** optional skills are used with this probability; mandatory ones always */
    const use = (prob: number) => !p.allowNone || r() < prob;
    const night = this.g.night;
    switch (p.step) {
      case 'seer':
      case 'psychic':
        return one(this.probe(r, o));
      case 'mechSkill': {
        const sk = this.me.mech?.skill;
        if (sk === 'seer' || sk === 'psychic') return one(this.probe(r, o));
        if (sk === 'poison') return use(night >= 2 ? 0.3 : 0.1) ? one(this.hostile(r, o)) : none;
        return use(0.85) ? one(this.friendly(r, o)) : none;
      }
      case 'guard':
        return use(0.9) ? one(this.friendly(r, o)) : none;
      case 'dreamer': {
        const last = lastNight(p);
        const fresh = o.filter((x) => x !== last);
        return one(this.friendly(r, fresh.length ? fresh : o));
      }
      case 'poisoner':
        return use(night >= 2 ? 0.3 : 0.1) ? one(this.hostile(r, o)) : none;
      case 'crow':
      case 'beauty':
        return use(0.85) ? one(this.hostile(r, o)) : none;
      case 'wolfgirl':
        return one(this.hostile(r, o) ?? pickOne(r, o));
      case 'mechKill': {
        const t = this.hostile(r, o);
        if (t == null) return none;
        if (p.max >= 2 && r() < 0.5) {
          const t2 = this.hostile(r, o.filter((x) => x !== t));
          if (t2 != null) return { type: 'pick', step: p.step, targets: [t, t2] };
        }
        return one(t);
      }
      case 'magician':
      case 'trickster':
      case 'wolfwizard':
        return use(0.5) ? several(2) : none;
      case 'dancer':
        return use(0.6) ? several(3) : none;
      case 'mixed':
      case 'mechLearn':
        return one(pickOne(r, o.filter((x) => x !== this.seat)));
      default:
        return use(0.8) ? several(1) : none;
    }
  }

  /** the pack agrees quickly: follow a human teammate's pick, else any teammate's, else one shared choice */
  private wolvesMove(p: WolvesPrompt): BotMove | null {
    if (p.locked) return null;
    const human = (s: number) => !this.v.seats[s - 1]?.bot;
    const others = p.picks.filter((x) => x.seat !== this.seat && x.target !== undefined);
    const lead = others.find((x) => human(x.seat)) ?? others.find((x) => x.target !== null);
    let target: number | null;
    let think: [number, number] = [2.5, 5];
    if (p.noKnife || !p.options.length) target = null;
    else if (lead) {
      target = lead.target ?? null;
      think = [1, 2.5];
    } else {
      // every bot of the pack draws the same target from the same seed, so they agree at once
      const pack = new Set(p.teammates.map((t) => t.seat));
      const pool = p.options.filter((x) => !pack.has(x));
      target = pickOne(prng(`${this.salt}|knife|${this.g.gameNo}|${this.g.night}`), pool.length ? pool : p.options);
    }
    if (p.myConfirmed && p.myPick === target) return null;
    return this.move(`wolves-${target}`, think, () => ({ type: 'wolfPick', target, confirm: true }));
  }

  private vote(p: VotePrompt, key: string, r: Rnd): number | null {
    const c = p.candidates;
    if (!c.length || r() < 0.04) return null;
    if (p.context === 'sheriff' || p.context === 'sheriffPk') return this.friendly(r, c);
    if (!this.wolf) {
      const known = c.filter((x) => this.wolves.has(x));
      if (known.length) return pickOne(r, known);
    }
    // a shared hunch per side so that votes gather instead of scattering into ties:
    // the pack mostly pushes one non-wolf together, uninformed good players often agree on one name
    const ph = this.g.phase;
    const all = ph.kind === 'vote' ? ph.candidates : c;
    const pack = this.wolf && this.mates.size > 0;
    const pool = pack ? all.filter((x) => x !== this.seat && !this.mates.has(x)) : all;
    const hunch = pickOne(prng(`${this.salt}|${pack ? 'pack' : 'town'}|${key}`), pool);
    if (hunch != null && hunch !== this.seat && c.includes(hunch) && !this.goods.has(hunch) && r() < (pack ? 0.75 : 0.6)) return hunch;
    return this.hostile(r, c);
  }
}

/** the bot's next move for its seat, or null when it has nothing to do */
export function botMove(v: RoomView, salt: string): BotMove | null {
  const g = v.game;
  const seat = v.you.seat;
  const me = g?.you;
  if (!g || !seat || !me || g.paused || g.time === 'ended') return null;
  const m = new Mind(v, g, me, salt);
  const ph = g.phase;
  if (ph.kind === 'dealt') {
    if (v.seats[seat - 1]?.viewedRole) return null;
    return m.move('view', [1, 3.5], () => ({ type: 'viewRole' }));
  }
  if (ph.kind === 'speech') {
    if (ph.order[ph.idx] !== seat) return null;
    return m.move(`speech-${ph.context}-${ph.idx}-${ph.startedAt}`, [3, 6], () => ({ type: 'endSpeech' }));
  }
  return me.prompt ? m.decide(me.prompt) : null;
}
