import { useEffect, useRef, useState } from 'preact/hooks';
import { ROLES } from '../../shared/roles.ts';
import type {
  DeathSkillPrompt,
  GameAction,
  MasquePrompt,
  OwnerCommand,
  PickPrompt,
  RoomView,
  StatusPrompt,
  TreasurePrompt,
  VotePrompt,
  WitchPrompt,
  WolvesPrompt,
} from '../../shared/types.ts';
import { rolesSummary } from './Config.tsx';
import type { ModalKind } from './Room.tsx';
import { send } from './lib/ws.ts';
import { Btn, Elapsed, RoleIcon, factionClass, seatList } from './ui.tsx';

export const act = (a: GameAction) => send({ t: 'act', action: a });
export const ownerCmd = (c: OwnerCommand) => send({ t: 'owner', cmd: c });

function nameOf(v: RoomView, seat: number): string {
  return v.seats[seat - 1]?.name ?? '';
}

/** grid of seat buttons limited to the valid options */
export function SeatPicker({
  v,
  options,
  selected,
  max = 1,
  onChange,
  disabled,
  tags,
}: {
  v: RoomView;
  options: number[];
  selected: number[];
  max?: number;
  onChange: (s: number[]) => void;
  disabled?: boolean;
  tags?: Record<number, string>;
}) {
  if (!options.length) return <p class="muted">没有可以选择的玩家</p>;
  return (
    <div class="seat-picker" role="listbox" aria-multiselectable={max > 1}>
      {options.map((s) => {
        const on = selected.includes(s);
        return (
          <button
            type="button"
            key={s}
            role="option"
            aria-selected={on}
            disabled={disabled}
            class={`pick${on ? ' on' : ''}${s === v.you.seat ? ' self' : ''}`}
            onClick={() => {
              if (on) onChange(selected.filter((x) => x !== s));
              else if (max === 1) onChange([s]);
              else onChange([...selected, s].slice(-max));
            }}
          >
            <b>{s}</b>
            <span>{s === v.you.seat ? '自己' : nameOf(v, s)}</span>
            {tags?.[s] && <em>{tags[s]}</em>}
          </button>
        );
      })}
    </div>
  );
}

/** identity of the current prompt: changes when a new decision is asked for */
function promptKey(v: RoomView): string {
  const g = v.game;
  if (!g) return '';
  const ph = g.phase;
  // my turn to speak is a decision too: 结束发言 must not stay hidden under the bottom bar
  if (ph.kind === 'speech' && ph.order[ph.idx] === v.you.seat) return `${g.gameNo}-${g.day}-speech-${ph.context}-${ph.idx}`;
  const p = g.you?.prompt;
  if (!p) return '';
  const sub = ph.kind === 'night' ? ph.step : ph.kind === 'vote' || ph.kind === 'speech' ? ph.context : '';
  // two-stage panels grow after their first answer: bring the second stage into view as well
  const stage = p.kind === 'masque' && p.verified ? '-2' : '';
  return `${g.gameNo}-${g.day}-${g.night}-${ph.kind}-${sub}-${p.kind}${stage}`;
}

export function ActionArea({ v, openModal }: { v: RoomView; openModal: (m: ModalKind) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const key = promptKey(v);
  useEffect(() => {
    if (!key || !ref.current) return;
    // bring a freshly opened decision into view on small phones
    const t = setTimeout(() => ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 60);
    return () => clearTimeout(t);
  }, [key]);
  return (
    <div ref={ref} class="action-inner">
      <ActionBody v={v} openModal={openModal} />
    </div>
  );
}

function ActionBody({ v, openModal }: { v: RoomView; openModal: (m: ModalKind) => void }) {
  const g = v.game;
  if (!g) return <LobbyPanel v={v} openModal={openModal} />;
  const ph = g.phase;
  const you = g.you;
  const p = you?.prompt ?? null;
  let body = null;
  if (ph.kind === 'dealt') body = <DealtPanel v={v} openModal={openModal} />;
  else if (ph.kind === 'ended') body = <ResultPanel v={v} />;
  else if (ph.kind === 'night') {
    if (
      p &&
      (p.kind === 'pick' || p.kind === 'wolves' || p.kind === 'witch' || p.kind === 'treasure' || p.kind === 'status' || p.kind === 'masque')
    ) {
      const key = `${g.gameNo}-${g.night}-${ph.step}`;
      body = <NightPrompt key={key} v={v} p={p} />;
    } else body = <NightIdle v={v} />;
  } else if (ph.kind === 'signup') body = <SignupPanel v={v} />;
  else if (ph.kind === 'speech') body = <SpeechPanel v={v} />;
  else if (ph.kind === 'withdraw') body = <WithdrawPanel v={v} />;
  else if (ph.kind === 'vote') body = <VotePanel key={`${g.gameNo}-${g.day}-${ph.context}`} v={v} />;
  else if (ph.kind === 'deathSkills') body = <DeathSkillsPanel key={`${g.gameNo}-${g.day}`} v={v} />;
  else if (ph.kind === 'orderChoice') body = <OrderPanel v={v} />;
  else if (ph.kind === 'princeWindow') body = <PrincePanel v={v} />;
  else body = <InterludePanel v={v} />;
  return (
    <>
      {body}
      {v.you.owner && <OwnerBar v={v} />}
    </>
  );
}

// ── lobby ──

function LobbyPanel({ v, openModal }: { v: RoomView; openModal: (m: ModalKind) => void }) {
  const filled = v.seats.filter((s) => s.occupied).length;
  const full = filled === v.playerCount;
  const me = v.you.seat;
  return (
    <div class="panel action">
      <div class="lobby-config">
        <div class="cfg-title">{v.config.boardName}</div>
        <div class="cfg-roles">{rolesSummary(v.config.roles)}</div>
      </div>
      {me ? (
        <div class="row between">
          <span>
            你坐在 <b class="hl">{me}号</b>
          </span>
          <Btn small kind="ghost" onClick={() => send({ t: 'stand' })}>
            离开座位
          </Btn>
        </div>
      ) : (
        <p class="hint strong">点击上方的空座位入座</p>
      )}
      {v.you.owner ? (
        <div class="btn-row">
          <Btn kind="primary" disabled={!full} onClick={() => ownerCmd({ type: 'deal' })}>
            {full ? '发牌' : `发牌（${filled}/${v.playerCount}）`}
          </Btn>
          <Btn onClick={() => openModal('reconfig')}>修改配置</Btn>
          <Btn kind="ghost" onClick={() => openModal('invite')}>
            邀请
          </Btn>
        </div>
      ) : (
        <p class="muted">等待房主发牌…</p>
      )}
    </div>
  );
}

function DealtPanel({ v, openModal }: { v: RoomView; openModal: (m: ModalKind) => void }) {
  const g = v.game!;
  const ph = g.phase.kind === 'dealt' ? g.phase : null;
  return (
    <div class="panel action">
      {v.you.seat ? (
        <Btn kind="gold" block onClick={() => openModal('role')}>
          查看我的身份
        </Btn>
      ) : (
        <p class="muted">你没有座位，正在旁观。</p>
      )}
      <p class="hint">
        已查看身份：{ph?.viewed ?? 0}/{ph?.total ?? v.playerCount}　·　游戏中可以随时点击下方「身份」再次查看
      </p>
      {v.you.owner && (
        <Btn kind="primary" block onClick={() => ownerCmd({ type: 'start' })}>
          开始游戏（天黑请闭眼）
        </Btn>
      )}
    </div>
  );
}

// ── night ──

function NightIdle({ v }: { v: RoomView }) {
  const g = v.game!;
  const ph = g.phase.kind === 'night' ? g.phase : null;
  return (
    <div class="panel action night-idle">
      <p class="night-line">{v.you.seat && !g.you?.alive ? '你已出局，请保持安静' : '请闭眼，等待法官指令'}</p>
      {ph?.stepName && <p class="muted">当前：{ph.stepName}</p>}
    </div>
  );
}

function NightPrompt({
  v,
  p,
}: {
  v: RoomView;
  p: PickPrompt | WolvesPrompt | WitchPrompt | TreasurePrompt | StatusPrompt | MasquePrompt;
}) {
  switch (p.kind) {
    case 'masque':
      return <MasquePanel v={v} p={p} />;
    case 'pick':
      return <PickPanel v={v} p={p} />;
    case 'wolves':
      return <WolvesPanel v={v} p={p} />;
    case 'witch':
      return <WitchPanel v={v} p={p} />;
    case 'treasure':
      return <TreasurePanel v={v} p={p} />;
    case 'status':
      return <StatusPanel p={p} />;
  }
}

function PickPanel({ v, p }: { v: RoomView; p: PickPrompt }) {
  const [sel, setSel] = useState<number[]>([]);
  const done = p.submitted !== null;
  return (
    <div class="panel action night-act">
      <h3>{p.title}</h3>
      {p.lines.map((l) => (
        <p class="muted" key={l}>
          {l}
        </p>
      ))}
      {done ? (
        <div class="submitted">
          <p>
            已确认：
            {p.submitted!.length ? p.submitted!.map((s) => `${s}号`).join('、') : p.noneLabel || '不选择'}
          </p>
          {p.result.map((r) => (
            <p class="result" key={r}>
              {r}
            </p>
          ))}
        </div>
      ) : (
        <>
          <SeatPicker
            v={v}
            options={p.options}
            selected={sel}
            max={p.max}
            onChange={setSel}
            tags={p.step === 'mechKill' && p.max === 2 && sel.length === 2 ? { [sel[1]]: '破盾刀' } : undefined}
          />
          {p.min > 1 && (
            <p class="muted">
              已选 {sel.length}/{p.min}
            </p>
          )}
          <div class="btn-row">
            <Btn
              kind="primary"
              disabled={sel.length < Math.max(1, p.min)}
              onClick={() => act({ type: 'pick', step: p.step, targets: sel })}
            >
              {p.confirmLabel}
              {sel.length ? ` ${sel.map((s) => `${s}号`).join('、')}` : ''}
            </Btn>
            {p.allowNone && (
              <Btn kind="ghost" onClick={() => act({ type: 'pick', step: p.step, targets: [] })}>
                {p.noneLabel}
              </Btn>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function WolvesPanel({ v, p }: { v: RoomView; p: WolvesPrompt }) {
  // how many teammates currently point at each seat
  const counts: Record<number, number> = {};
  for (const x of p.picks) {
    if (x.target == null || x.seat === v.you.seat) continue;
    counts[x.target] = (counts[x.target] ?? 0) + 1;
  }
  const pickTag: Record<number, string> = {};
  for (const [t, n] of Object.entries(counts)) pickTag[Number(t)] = `队友×${n}`;
  const my = p.myPick;
  const choose = (t: number | null, confirm: boolean) => act({ type: 'wolfPick', target: t, confirm });
  const confirmations = (
    <div class="wolf-picks">
      {p.picks.map((x) => (
        <span key={x.seat} class={x.confirmed ? 'ok' : ''}>
          {x.seat}号：{p.noKnife ? (x.confirmed ? '已确认' : '未确认') : x.target === undefined ? '未选择' : x.target === null ? '空刀' : `${x.target}号`}
          {x.confirmed ? ' ✓' : ''}
        </span>
      ))}
    </div>
  );
  return (
    <div class="panel action night-act wolves">
      <h3>{p.title}</h3>
      <div class="teammates">
        <span class="muted">狼队：</span>
        {p.teammates.map((t) => (
          <span class={`mate${t.alive ? '' : ' dead'}${t.seat === v.you.seat ? ' self' : ''}`} key={t.seat}>
            {t.seat}号{t.role !== 'wolf' ? `（${ROLES[t.role].name}）` : ''}
            {t.seat === v.you.seat ? '·我' : ''}
          </span>
        ))}
      </div>
      {p.locked ? (
        <div class="submitted">
          <p class="result">{p.noKnife ? '狼队已互相确认身份（首夜禁刀）' : `狼队已确定：${p.final == null ? '空刀' : `击杀${p.final}号`}`}</p>
        </div>
      ) : p.noKnife ? (
        <>
          <p class="muted">{p.lines[0]}</p>
          <div class="btn-row">
            <Btn kind="primary" disabled={p.myConfirmed} onClick={() => choose(null, true)}>
              {p.myConfirmed ? '已确认，等待队友' : '确认'}
            </Btn>
          </div>
          {confirmations}
        </>
      ) : (
        <>
          <p class="muted">{p.lines[0]}</p>
          <SeatPicker
            v={v}
            options={p.options}
            selected={my != null ? [my] : []}
            onChange={(s) => choose(s[0] ?? null, false)}
            tags={pickTag}
          />
          <div class="btn-row">
            <Btn kind="danger" disabled={my === undefined || p.myConfirmed} onClick={() => choose(my ?? null, true)}>
              {p.myConfirmed ? '已确认，等待队友' : my == null ? (my === null ? '确认空刀' : '请选择目标') : `确认击杀${my}号`}
            </Btn>
            <Btn kind="ghost" onClick={() => choose(null, false)}>
              空刀
            </Btn>
          </div>
          {confirmations}
        </>
      )}
    </div>
  );
}

function WitchPanel({ v, p }: { v: RoomView; p: WitchPrompt }) {
  const [mode, setMode] = useState<'main' | 'poison'>('main');
  const [sel, setSel] = useState<number[]>([]);
  if (p.submitted) {
    return (
      <div class="panel action night-act">
        <h3>女巫</h3>
        <div class="submitted">
          <p class="result">
            {p.submitted.save != null
              ? `你使用解药救了${p.submitted.save}号`
              : p.submitted.poison != null
                ? `你对${p.submitted.poison}号使用了毒药`
                : '你今晚没有用药'}
          </p>
        </div>
      </div>
    );
  }
  const knifeText =
    p.knifed === null
      ? '你的解药已经用过，无法得知今晚的刀口。'
      : p.knifed.length === 0
        ? '今晚没有玩家被击杀。'
        : `今晚被击杀的是：${seatList(p.knifed)}`;
  return (
    <div class="panel action night-act">
      <h3>{p.title}</h3>
      <p class="knife-info">{knifeText}</p>
      <p class="muted">
        解药：{p.antidote ? '可用' : '已用'}　毒药：{p.poison ? '可用' : '已用'}　·　同一晚只能用一瓶药
      </p>
      {mode === 'main' ? (
        <div class="btn-col">
          {p.saveOptions.map((s) => (
            <Btn kind="gold" key={s} onClick={() => act({ type: 'witch', save: s, poison: null })}>
              使用解药，救{s}号
            </Btn>
          ))}
          {p.saveBlockedReason && <p class="muted">{p.saveBlockedReason}</p>}
          {p.poison && (
            <Btn kind="danger" onClick={() => setMode('poison')}>
              使用毒药…
            </Btn>
          )}
          <Btn kind="ghost" onClick={() => act({ type: 'witch', save: null, poison: null })}>
            今晚不用药
          </Btn>
        </div>
      ) : (
        <>
          <p>选择要毒杀的玩家：</p>
          <SeatPicker v={v} options={p.poisonOptions} selected={sel} onChange={setSel} />
          <div class="btn-row">
            <Btn kind="danger" disabled={!sel.length} onClick={() => act({ type: 'witch', save: null, poison: sel[0] })}>
              确认毒杀{sel.length ? `${sel[0]}号` : ''}
            </Btn>
            <Btn kind="ghost" onClick={() => setMode('main')}>
              返回
            </Btn>
          </div>
        </>
      )}
    </div>
  );
}

function TreasurePanel({ v, p }: { v: RoomView; p: TreasurePrompt }) {
  const [card, setCard] = useState<number | null>(null);
  const [target, setTarget] = useState<number[]>([]);
  const [kill, setKill] = useState<number[]>([]);
  if (p.submitted) {
    return (
      <div class="panel action night-act">
        <h3>盗宝大师</h3>
        <div class="submitted">
          {p.result.map((r) => (
            <p class="result" key={r}>
              {r}
            </p>
          ))}
          {p.submitted.target != null && <p>技能目标：{p.submitted.target}号</p>}
          {p.submitted.kill != null && (
            <p>
              击杀：{p.submitted.kill}号{p.submitted.kill2 != null ? `、${p.submitted.kill2}号` : ''}
            </p>
          )}
        </div>
      </div>
    );
  }
  const sk = card != null ? p.cardSkills.find((c) => c.card === card) : null;
  const ready = card != null && (!sk?.mandatory || target.length > 0);
  return (
    <div class="panel action night-act">
      <h3>{p.title}</h3>
      {p.lines.map((l) => (
        <p class="muted" key={l}>
          {l}
        </p>
      ))}
      <div class="tcards">
        {p.cards.map((r, i) => {
          const allowed = p.allowedCards.includes(i);
          return (
            <button
              type="button"
              key={i}
              disabled={!allowed}
              class={`tcard ${factionClass(r)}${card === i ? ' on' : ''}`}
              onClick={() => {
                setCard(i);
                setTarget([]);
              }}
            >
              <RoleIcon role={r} size={26} />
              <span>{ROLES[r].name}</span>
              {!allowed && <em>昨晚已用</em>}
            </button>
          );
        })}
      </div>
      {sk && (
        <>
          <p class="muted">{sk.label}</p>
          {sk.skill !== 'none' && <SeatPicker v={v} options={sk.options} selected={target} onChange={setTarget} />}
        </>
      )}
      {p.canKill && card != null && (
        <>
          <p class="muted">
            {p.killMax === 2 ? '你可以开刀：今晚可以击杀两人（可以不刀）' : '你可以开刀：选择击杀目标（可以不刀）'}
          </p>
          <SeatPicker v={v} options={p.killOptions} selected={kill} max={p.killMax} onChange={setKill} />
        </>
      )}
      <div class="btn-row">
        <Btn
          kind="primary"
          disabled={!ready}
          onClick={() =>
            act({ type: 'treasure', card: card!, target: target[0] ?? null, kill: kill[0] ?? null, kill2: kill[1] ?? null })
          }
        >
          确认
        </Btn>
      </div>
    </div>
  );
}

function MasquePanel({ v, p }: { v: RoomView; p: MasquePrompt }) {
  const [verify, setVerify] = useState<number[]>([]);
  const [mask, setMask] = useState<number[]>([]);
  const [kill, setKill] = useState<number[]>([]);
  if (p.submitted) {
    return (
      <div class="panel action night-act">
        <h3>假面</h3>
        <div class="submitted">
          {p.verified && <p class="result">{p.verified.result}</p>}
          <p>面具：{p.submitted.mask != null ? `${p.submitted.mask}号` : '没有赐予'}</p>
          {p.canKill && <p>击杀：{p.submitted.kill != null ? `${p.submitted.kill}号` : '不刀人'}</p>}
        </div>
      </div>
    );
  }
  const needVerify = !p.verified && p.verifyOptions.length > 0;
  return (
    <div class="panel action night-act">
      <h3>{p.title}</h3>
      {p.lines.map((l) => (
        <p class="muted" key={l}>
          {l}
        </p>
      ))}
      {needVerify ? (
        <>
          <p>① 选择验证目标（是否在舞池中）：</p>
          <SeatPicker v={v} options={p.verifyOptions} selected={verify} onChange={setVerify} />
          <div class="btn-row">
            <Btn kind="primary" disabled={!verify.length} onClick={() => act({ type: 'masqueVerify', target: verify[0] })}>
              验证{verify.length ? ` ${verify[0]}号` : ''}
            </Btn>
            <Btn kind="ghost" onClick={() => act({ type: 'masqueVerify', target: null })}>
              不验证
            </Btn>
          </div>
        </>
      ) : (
        <>
          {p.verified && <p class="result">{p.verified.result}</p>}
          {p.maskOptions.length > 0 && (
            <>
              <p>② 选择赐予面具的目标（可以不给）：</p>
              <SeatPicker v={v} options={p.maskOptions} selected={mask} onChange={setMask} />
            </>
          )}
          {p.canKill && (
            <>
              <p>选择击杀目标（可以不刀）：</p>
              <SeatPicker v={v} options={p.killOptions} selected={kill} onChange={setKill} />
            </>
          )}
          <Btn kind="primary" onClick={() => act({ type: 'masqueAct', mask: mask[0] ?? null, kill: kill[0] ?? null })}>
            确认
          </Btn>
        </>
      )}
    </div>
  );
}

function PrincePanel({ v }: { v: RoomView }) {
  const g = v.game!;
  if (g.phase.kind !== 'princeWindow') return null;
  const p = g.you?.prompt?.kind === 'prince' ? g.you.prompt : null;
  return (
    <div class="panel action">
      <p class="announce">{g.phase.target}号玩家得票最多。</p>
      {p?.decided ? (
        <p class="muted">你选择不发动技能，等待放逐结果…</p>
      ) : p ? (
        <>
          <p>你是定序王子：可以翻牌发动技能，本次放逐作废，你发言后重新投票（整局一次）。</p>
          <div class="btn-row">
            <Btn kind="gold" onClick={() => confirm('确定翻牌发动定序王子技能吗？') && act({ type: 'prince', use: true })}>
              发动技能
            </Btn>
            <Btn kind="ghost" onClick={() => act({ type: 'prince', use: false })}>
              不发动
            </Btn>
          </div>
        </>
      ) : (
        <p class="muted">等待定序王子确认是否发动技能…</p>
      )}
    </div>
  );
}

function StatusPanel({ p }: { p: StatusPrompt }) {
  return (
    <div class="panel action night-act">
      <h3>{p.title}</h3>
      {p.lines.map((l) => (
        <p class="result" key={l}>
          {l}
        </p>
      ))}
      {!p.acked ? (
        <Btn kind="primary" onClick={() => act({ type: 'ack', step: p.step })}>
          知道了
        </Btn>
      ) : (
        <p class="muted">请闭眼</p>
      )}
    </div>
  );
}

// ── day ──

function SignupPanel({ v }: { v: RoomView }) {
  const g = v.game!;
  const p = g.you?.prompt;
  const ph = g.phase.kind === 'signup' ? g.phase : null;
  return (
    <div class="panel action">
      {p?.kind === 'signup' ? (
        <>
          <p class="big-q">你要参加警长竞选（上警）吗？</p>
          <div class="btn-row">
            <Btn kind={p.joined === true ? 'gold' : 'plain'} onClick={() => act({ type: 'signup', join: true })}>
              {p.joined === true ? '✓ 上警' : '上警'}
            </Btn>
            <Btn kind={p.joined === false ? 'gold' : 'plain'} onClick={() => act({ type: 'signup', join: false })}>
              {p.joined === false ? '✓ 不上警' : '不上警'}
            </Btn>
          </div>
          <p class="hint">倒计时结束前可以修改选择。</p>
        </>
      ) : (
        <p class="muted">玩家正在选择是否上警…</p>
      )}
      <p class="muted">已选择：{ph?.responded ?? 0}/{ph?.total ?? 0}</p>
    </div>
  );
}

function SpeechPanel({ v }: { v: RoomView }) {
  const g = v.game!;
  if (g.phase.kind !== 'speech') return null;
  const ph = g.phase;
  const cur = ph.order[ph.idx];
  const me = v.you.seat;
  const isCandidate =
    !!me && (ph.context === 'sheriff' || ph.context === 'sheriffPk') && ph.candidates.includes(me);
  const label = {
    sheriff: '警上发言',
    sheriffPk: '警长PK发言',
    discussion: '发言',
    exilePk: '放逐PK发言',
    lastWords: '遗言',
    prince: '定序王子发言',
  }[ph.context];
  const lastAnn = g.announcements[g.announcements.length - 1];
  return (
    <div class="panel action">
      {lastAnn && <p class="ann-line">📢 {lastAnn.text}</p>}
      <div class="row between">
        <span class="speaker">
          {label}：<b class="hl">{cur}号</b> {nameOf(v, cur)}
        </span>
        <Elapsed since={ph.startedAt} />
      </div>
      <div class="order">
        {ph.order.map((s, i) => (
          <span
            key={`${s}-${i}`}
            class={`ord${i === ph.idx ? ' cur' : ''}${i < ph.idx ? ' past' : ''}${
              (ph.context === 'sheriff' || ph.context === 'sheriffPk') && !ph.candidates.includes(s) ? ' gone' : ''
            }`}
          >
            {s}
          </span>
        ))}
      </div>
      <div class="btn-row">
        {cur === me && (
          <Btn kind="primary" onClick={() => act({ type: 'endSpeech' })}>
            {ph.context === 'lastWords' ? '遗言结束' : '结束发言'}
          </Btn>
        )}
        {isCandidate && (
          <Btn
            kind="ghost"
            onClick={() => {
              if (confirm('确定退水吗？退水后不能再参加竞选，也不能投票。')) act({ type: 'withdraw' });
            }}
          >
            退水
          </Btn>
        )}
      </div>
    </div>
  );
}

function WithdrawPanel({ v }: { v: RoomView }) {
  const g = v.game!;
  if (g.phase.kind !== 'withdraw') return null;
  const ph = g.phase;
  const me = v.you.seat;
  return (
    <div class="panel action">
      <p>警上玩家：{seatList(ph.candidates)}</p>
      {ph.withdrawn.length > 0 && <p class="muted">已退水：{seatList(ph.withdrawn)}</p>}
      {me && ph.candidates.includes(me) && (
        <Btn
          kind="ghost"
          onClick={() => {
            if (confirm('确定退水吗？')) act({ type: 'withdraw' });
          }}
        >
          退水
        </Btn>
      )}
      <p class="hint">退水环节结束后由警下玩家投票。{v.you.owner ? '房主可以点击「下一步」开始投票。' : ''}</p>
    </div>
  );
}

function VotePanel({ v }: { v: RoomView }) {
  const [sel, setSel] = useState<number[]>([]);
  const g = v.game!;
  if (g.phase.kind !== 'vote') return null;
  const ph = g.phase;
  const p = g.you?.prompt?.kind === 'vote' ? (g.you.prompt as VotePrompt) : null;
  const title = {
    sheriff: '投票选出警长',
    sheriffPk: '警长PK投票',
    exile: '放逐投票',
    exilePk: '放逐PK投票',
  }[ph.context];
  return (
    <div class="panel action">
      <h3>{title}</h3>
      {p ? (
        <>
          {p.myVote !== undefined && (
            <p class="result">
              你已{p.myVote === null ? '弃票' : `投给${p.myVote}号`}（截止前可以修改）
            </p>
          )}
          <SeatPicker v={v} options={p.candidates} selected={sel} onChange={setSel} />
          <div class="btn-row">
            <Btn kind="primary" disabled={!sel.length} onClick={() => act({ type: 'vote', target: sel[0] })}>
              投给{sel.length ? `${sel[0]}号` : '…'}
            </Btn>
            <Btn kind="ghost" onClick={() => act({ type: 'vote', target: null })}>
              弃票
            </Btn>
          </div>
        </>
      ) : (
        <p class="muted">
          {ph.context === 'sheriff' || ph.context === 'sheriffPk'
            ? '你在警上或已退水，没有投票权。'
            : ph.context === 'exilePk' && v.you.seat && ph.candidates.includes(v.you.seat)
              ? '你在PK台上，不能投票。'
              : '你没有投票权。'}
        </p>
      )}
      <p class="muted">
        已投票：{ph.voted.length}/{ph.voters.length}
      </p>
    </div>
  );
}

function DeathSkillsPanel({ v }: { v: RoomView }) {
  const g = v.game!;
  if (g.phase.kind !== 'deathSkills') return null;
  const ph = g.phase;
  const p = g.you?.prompt?.kind === 'deathSkill' ? (g.you.prompt as DeathSkillPrompt) : null;
  const last = g.announcements.slice(-3).map((a) => a.text);
  return (
    <div class="panel action">
      {last.length > 0 && (
        <div class="announce-list">
          {last.map((t, i) => (
            <p key={i}>{t}</p>
          ))}
        </div>
      )}
      {p ? <MyDeathSkill v={v} p={p} /> : null}
      <p class="muted">
        等待确认：{seatList(ph.entries.filter((e) => !e.done).map((e) => e.seat))}
      </p>
    </div>
  );
}

function MyDeathSkill({ v, p }: { v: RoomView; p: DeathSkillPrompt }) {
  const [mode, setMode] = useState<'ask' | 'shoot' | 'none'>('ask');
  const [sel, setSel] = useState<number[]>([]);
  const [badgeSel, setBadgeSel] = useState<number[]>([]);
  const shootPending = p.canShoot && p.shot === undefined;
  return (
    <div class="death-skill">
      <h3>你已出局</h3>
      {!p.mask && p.badge && !p.badgeDone && (
        <div class="badge-box">
          <p>你是警长：请移交警徽或撕毁警徽</p>
          <SeatPicker v={v} options={p.badgeOptions} selected={badgeSel} onChange={setBadgeSel} />
          <div class="btn-row">
            <Btn kind="gold" disabled={!badgeSel.length} onClick={() => act({ type: 'badge', target: badgeSel[0] })}>
              移交给{badgeSel.length ? `${badgeSel[0]}号` : '…'}
            </Btn>
            <Btn kind="ghost" onClick={() => confirm('确定撕毁警徽吗？') && act({ type: 'badge', target: null })}>
              撕毁警徽
            </Btn>
          </div>
        </div>
      )}
      {p.mask && !p.done && (
        <div class="badge-box">
          <p>你可以发动主动蒙面技能：被推不死，今晚多一刀（整局一次）。</p>
          <div class="btn-row">
            <Btn kind="danger" onClick={() => act({ type: 'mask', use: true })}>
              发动蒙面技能
            </Btn>
            <Btn kind="ghost" onClick={() => act({ type: 'mask', use: false })}>
              不发动
            </Btn>
          </div>
        </div>
      )}
      {!p.mask && !p.done && (!p.badge || p.badgeDone) && (
        <>
          {mode === 'ask' && (
            <div class="btn-row">
              <Btn kind="danger" onClick={() => setMode(p.canShoot && shootPending ? 'shoot' : 'none')}>
                发动技能
              </Btn>
              <Btn kind="ghost" onClick={() => act(p.canShoot && shootPending ? { type: 'shoot', target: null } : { type: 'skillDone' })}>
                不发动
              </Btn>
            </div>
          )}
          {mode === 'none' && (
            <>
              <p class="muted">你没有可以发动的技能。</p>
              <Btn kind="primary" onClick={() => act({ type: 'skillDone' })}>
                确认
              </Btn>
            </>
          )}
          {mode === 'shoot' && (
            <>
              <p>选择开枪带走的玩家：</p>
              <SeatPicker v={v} options={p.shootOptions} selected={sel} onChange={setSel} />
              <div class="btn-row">
                <Btn kind="danger" disabled={!sel.length} onClick={() => act({ type: 'shoot', target: sel[0] })}>
                  开枪带走{sel.length ? `${sel[0]}号` : '…'}
                </Btn>
                <Btn kind="ghost" onClick={() => setMode('ask')}>
                  返回
                </Btn>
              </div>
            </>
          )}
        </>
      )}
      {p.done && <p class="muted">已确认。</p>}
    </div>
  );
}

function OrderPanel({ v }: { v: RoomView }) {
  const g = v.game!;
  const p = g.you?.prompt?.kind === 'orderChoice' ? g.you.prompt : null;
  const sheriff = g.sheriff;
  if (p) {
    return (
      <div class="panel action">
        <h3>请选择发言顺序</h3>
        <p class="muted">你是警长，你将最后发言。</p>
        <div class="btn-col">
          <Btn kind="primary" onClick={() => act({ type: 'order', dir: 'cw' })}>
            从{p.cwFirst}号开始（顺序）
          </Btn>
          <Btn kind="primary" onClick={() => act({ type: 'order', dir: 'ccw' })}>
            从{p.ccwFirst}号开始（逆序）
          </Btn>
        </div>
      </div>
    );
  }
  return (
    <div class="panel action">
      <p>等待{sheriff}号警长选择发言顺序…</p>
      {v.you.owner && (
        <div class="btn-row">
          <Btn small onClick={() => ownerCmd({ type: 'order', dir: 'cw' })}>
            代选：顺序
          </Btn>
          <Btn small onClick={() => ownerCmd({ type: 'order', dir: 'ccw' })}>
            代选：逆序
          </Btn>
        </div>
      )}
    </div>
  );
}

function InterludePanel({ v }: { v: RoomView }) {
  const g = v.game!;
  const last = g.announcements.slice(-2);
  return (
    <div class="panel action">
      {last.map((a) => (
        <p class="announce" key={a.id}>
          {a.text}
        </p>
      ))}
    </div>
  );
}

function ResultPanel({ v }: { v: RoomView }) {
  const g = v.game!;
  const r = g.result;
  if (!r) return null;
  const me = v.you.seat;
  const mine = me ? r.players.find((p) => p.seat === me) : null;
  return (
    <div class="panel action result-panel">
      <h3 class={`winner ${r.winner}`}>
        {r.winner === 'good' ? '好人阵营胜利' : r.winner === 'wolf' ? '狼人阵营胜利' : '平局'}
      </h3>
      <p class="muted">{r.reason}</p>
      {mine && <p class={`you-won ${mine.won ? 'won' : 'lost'}`}>{mine.won ? '你赢了！' : '你输了'}</p>}
      <div class="result-table">
        {r.players.map((p) => (
          <div class={`rrow ${factionClass(p.role)}${p.alive ? '' : ' dead'}${p.won ? ' won' : ''}`} key={p.seat}>
            <b>{p.seat}</b>
            <span class="rname">{p.name ?? ''}</span>
            <span class="rrole">
              <RoleIcon role={p.role} size={14} /> {ROLES[p.role].name}
            </span>
            <span class="rnote">{p.note ?? (p.alive ? '存活' : '')}</span>
          </div>
        ))}
      </div>
      {r.buried && <p class="muted">底牌：{r.buried.map((x) => ROLES[x].name).join('、')}</p>}
      <details class="nightlog">
        <summary>夜间行动复盘（上帝视角）</summary>
        {r.nights.map((n) => (
          <div key={n.night} class="nl">
            <b>第{n.night}夜</b>
            {n.lines.map((l, i) => (
              <p key={i}>{l}</p>
            ))}
          </div>
        ))}
      </details>
      {v.you.owner && (
        <div class="btn-row">
          <Btn kind="primary" onClick={() => ownerCmd({ type: 'restart' })}>
            再来一局（同配置重新发牌）
          </Btn>
        </div>
      )}
    </div>
  );
}

function OwnerBar({ v }: { v: RoomView }) {
  const g = v.game;
  if (!g || g.time === 'dealt' || g.time === 'ended') return null;
  const ph = g.phase;
  const nextLabel =
    ph.kind === 'speech'
      ? ph.context === 'lastWords'
        ? '下一位（遗言）'
        : '下一位发言'
      : ph.kind === 'vote'
        ? '结束投票'
        : ph.kind === 'signup'
          ? '结束报名'
          : ph.kind === 'withdraw'
            ? '开始投票'
            : ph.kind === 'deathSkills'
              ? '跳过技能确认'
              : ph.kind === 'orderChoice'
                ? '随机发言顺序'
                : ph.kind === 'princeWindow'
                  ? '结束等待'
                : ph.kind === 'interlude'
                  ? '下一步'
                  : null;
  return (
    <div class="owner-bar">
      <span class="owner-tag">房主</span>
      {nextLabel && (
        <Btn small onClick={() => ownerCmd({ type: 'next' })}>
          {nextLabel}
        </Btn>
      )}
      <Btn small kind="ghost" onClick={() => ownerCmd({ type: g.paused ? 'resume' : 'pause' })}>
        {g.paused ? '继续' : '暂停'}
      </Btn>
    </div>
  );
}
