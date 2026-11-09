import { useEffect, useReducer, useState } from 'preact/hooks';
import type { GameConfig } from '../../shared/config.ts';
import { ROLE_IDS, ROLES, type RoleId } from '../../shared/roles.ts';
import { generalRules, NIGHT_ORDER_TEXT } from '../../shared/rules.ts';
import type { RoomView } from '../../shared/types.ts';
import { audio } from './audio/engine.ts';
import { ConfigEditor } from './Config.tsx';
import { act, ownerCmd, SeatPicker } from './panels.tsx';
import type { ModalKind } from './Room.tsx';
import { toast } from './lib/store.ts';
import { send } from './lib/ws.ts';
import { Btn, Modal, RoleIcon, copyText, factionClass, seatList } from './ui.tsx';

export function roomLink(v: RoomView): string {
  return `${location.origin}/r/${v.roomId}`;
}

// ── 身份 ──
export function RoleCardModal({ v, onClose }: { v: RoomView; onClose: () => void }) {
  const you = v.game?.you;
  const [flipped, setFlipped] = useState(false);
  if (!you) return null;
  const d = ROLES[you.role];
  const flip = () => {
    setFlipped(true);
    act({ type: 'viewRole' });
  };
  return (
    <Modal title={`${you.seat}号 · 我的身份`} onClose={onClose} variant="center">
      <div class={`role-card-wrap${flipped ? ' flipped' : ''}`}>
        {!flipped ? (
          <button type="button" class="role-card back" onClick={flip}>
            <span class="card-moon" />
            <span>点击翻开身份牌</span>
            <small>请确认周围的人看不到你的屏幕</small>
          </button>
        ) : (
          <div class={`role-card front ${factionClass(you.role)}`}>
            <div class="rc-icon">
              <RoleIcon role={you.role} size={56} />
            </div>
            <div class="rc-name">{d.name}</div>
            <div class="rc-faction">
              {you.faction === 'wolf' ? '狼人阵营' : '好人阵营'}
              {you.role !== 'treasure' ? ` · ${{ god: '神职', villager: '平民', wolf: '狼人' }[you.countsAs]}` : ''}
            </div>
            <div class="rc-info">
              {you.info.map((l) => (
                <p key={l}>{l}</p>
              ))}
              {you.treasureCards && (
                <p>
                  底牌：
                  {you.treasureCards.map((c) => (
                    <span class={`mini-role ${factionClass(c)}`} key={c}>
                      {ROLES[c].name}
                    </span>
                  ))}
                </p>
              )}
              {you.checks.length > 0 && (
                <div class="checks">
                  <b>查验记录</b>
                  {you.checks.map((c) => (
                    <p key={`${c.night}-${c.seat}`}>
                      第{c.night}夜：{c.seat}号 → <span class={c.result === '狼人' ? 'bad' : 'good'}>{c.result}</span>
                    </p>
                  ))}
                </div>
              )}
              {you.skills.notes.length > 0 && (
                <div class="checks">
                  {you.skills.notes.map((n) => (
                    <p key={n}>{n}</p>
                  ))}
                </div>
              )}
            </div>
            <ul class="rc-rules">
              {d.rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div class="btn-row center">
        {flipped && (
          <Btn kind="ghost" onClick={() => setFlipped(false)}>
            盖上
          </Btn>
        )}
        <Btn onClick={onClose}>关闭</Btn>
      </div>
    </Modal>
  );
}

// ── 技能 ──
export function SkillModal({ v, onClose }: { v: RoomView; onClose: () => void }) {
  const you = v.game?.you;
  const [take, setTake] = useState<number[]>([]);
  if (!you) return null;
  const sd = you.skills.selfDestruct;
  return (
    <Modal title="技能" onClose={onClose}>
      {sd && (
        <div class="skill-box">
          <h4>自爆</h4>
          {sd.available ? (
            <>
              <p class="muted">自爆后你立即出局且没有遗言，当天直接进入黑夜。</p>
              {sd.revenge != null && <p>你的表白对象{sd.revenge}号会随你一起出局（没有遗言）。</p>}
              {sd.canTake && (
                <>
                  <p>白狼王可以带走一名玩家（可以不带）：</p>
                  <SeatPicker v={v} options={sd.targets} selected={take} onChange={setTake} />
                </>
              )}
              {sd.reason && <p class="muted">{sd.reason}</p>}
              <Btn
                kind="danger"
                block
                onClick={() => {
                  const t = take[0] ?? null;
                  if (confirm(t ? `确定自爆并带走${t}号吗？` : '确定自爆吗？')) {
                    act({ type: 'selfDestruct', target: t });
                    onClose();
                  }
                }}
              >
                {take.length ? `自爆并带走${take[0]}号` : '自爆'}
              </Btn>
            </>
          ) : (
            <p class="muted">{sd.reason ?? '现在不能自爆'}</p>
          )}
        </div>
      )}
      {you.skills.duel && (
        <div class="skill-box">
          <h4>决斗</h4>
          {you.skills.duel.available ? (
            <>
              <p class="muted">翻牌与一名玩家决斗：对方是狼人则对方出局并直接进入黑夜；对方是好人则你出局。整局一次。</p>
              <SeatPicker v={v} options={you.skills.duel.targets} selected={take} onChange={setTake} />
              <Btn
                kind="danger"
                block
                disabled={!take.length}
                onClick={() => {
                  if (confirm(`确定翻牌决斗${take[0]}号吗？`)) {
                    act({ type: 'duel', target: take[0] });
                    onClose();
                  }
                }}
              >
                {take.length ? `决斗${take[0]}号` : '请选择决斗对象'}
              </Btn>
            </>
          ) : (
            <p class="muted">{you.skills.duel.reason ?? '现在不能决斗'}</p>
          )}
        </div>
      )}
      {you.skills.notes.length > 0 && (
        <div class="skill-box">
          <h4>状态</h4>
          {you.skills.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      )}
      {!sd && !you.skills.duel && you.skills.notes.length === 0 && <p class="muted">你现在没有可以主动发动的技能。</p>}
      <p class="hint">夜间行动、开枪和移交警徽会在对应的时间自动弹出。</p>
    </Modal>
  );
}

// ── 记录 ──
export function HistoryModal({ v, onClose }: { v: RoomView; onClose: () => void }) {
  const g = v.game;
  return (
    <Modal title="对局记录" onClose={onClose}>
      {!g || g.history.length === 0 ? (
        <p class="muted">还没有记录。</p>
      ) : (
        <div class="history">
          {g.history
            .slice()
            .reverse()
            .map((d) => ({ day: d.day, events: d.events.filter((e) => !/^第\d+[天夜]$/.test(e.text)) }))
            .filter((d) => d.events.length > 0)
            .map((d) => (
              <div class="hday" key={d.day}>
                <div class="hday-title">第{d.day}天</div>
                {d.events
                  .map((e, i) => (
                    <div class={`hev ${e.kind}`} key={i}>
                      <p>{e.text}</p>
                      {e.votes && (
                        <div class="vote-table">
                          {e.votes.rows.map((r) => (
                            <div class="vrow" key={r.target}>
                              <b>{r.target}号</b>
                              <span class="vscore">{r.score}票</span>
                              <span class="vfrom">
                                ← {seatList(r.voters)}
                                {r.curse ? ' + 乌鸦诅咒' : ''}
                              </span>
                            </div>
                          ))}
                          {e.votes.abstain.length > 0 && (
                            <div class="vrow abstain">
                              <b>弃票</b>
                              <span class="vfrom">{seatList(e.votes.abstain)}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            ))}
        </div>
      )}
    </Modal>
  );
}

// ── 规则 ──
export function RulesModal({ v, onClose }: { v: RoomView; onClose: () => void }) {
  const roles = ROLE_IDS.filter((r) => (v.config.roles[r] ?? 0) > 0);
  return (
    <Modal title={`规则 · ${v.config.boardName}`} onClose={onClose}>
      <div class="rules">
        <h4>本局身份</h4>
        {roles.map((r: RoleId) => (
          <div class={`rule-role ${factionClass(r)}`} key={r}>
            <div class="rr-head">
              <RoleIcon role={r} size={20} />
              <b>{ROLES[r].name}</b>
              {(v.config.roles[r] ?? 0) > 1 && <span>×{v.config.roles[r]}</span>}
              <em>{ROLES[r].faction === 'wolf' ? '狼人阵营' : ROLES[r].category === 'treasure' ? '阵营由底牌决定' : ROLES[r].category === 'god' ? '神职' : '平民'}</em>
            </div>
            <ul>
              {ROLES[r].rules.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        ))}
        {generalRules(v.config.rules, v.config.roles).map((s) => (
          <div key={s.title}>
            <h4>{s.title}</h4>
            <ul>
              {s.items.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        ))}
        <h4>夜间行动顺序</h4>
        <p class="muted">{v.game?.nightSteps.join(' → ') ?? NIGHT_ORDER_TEXT}</p>
      </div>
    </Modal>
  );
}

// ── 邀请 ──
export function InviteModal({ v, onClose }: { v: RoomView; onClose: () => void }) {
  const link = roomLink(v);
  const share = async () => {
    const nav = navigator as Navigator & { share?: (d: { title: string; text: string; url: string }) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: '狼人杀房间', text: `${v.config.boardName} · ${v.playerCount}人，点击入座`, url: link });
        return;
      } catch {
        /* cancelled */
      }
    }
    if (await copyText(link)) toast('链接已复制', 'info');
  };
  return (
    <Modal title="邀请玩家" onClose={onClose} variant="center">
      <p>把下面的链接发到群里，大家点开即可选座：</p>
      <div class="link-box">{link}</div>
      <div class="btn-row center">
        <Btn
          kind="primary"
          onClick={async () => {
            if (await copyText(link)) toast('链接已复制', 'info');
            else toast('复制失败，请长按链接手动复制');
          }}
        >
          复制链接
        </Btn>
        <Btn onClick={share}>分享</Btn>
      </div>
      <p class="hint">房间号：{v.roomId}</p>
    </Modal>
  );
}

// ── 昵称 ──
export function NameModal({
  initial,
  required,
  onDone,
  onClose,
}: {
  initial: string;
  required: boolean;
  onDone: (n: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const ok = name.trim().length > 0;
  return (
    <Modal title={required ? '欢迎入局' : '修改昵称'} onClose={() => !required && onClose()} variant="center">
      <p>请输入你的昵称（其他玩家可见）：</p>
      <input
        class="text-input"
        maxLength={12}
        value={name}
        autoFocus
        onInput={(e) => setName((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => e.key === 'Enter' && ok && onDone(name.trim())}
      />
      <div class="btn-row center">
        <Btn kind="primary" disabled={!ok} onClick={() => onDone(name.trim())}>
          确定
        </Btn>
      </div>
    </Modal>
  );
}

// ── 菜单 ──
function useAudioSettings() {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => audio.subscribe(() => force(0)), []);
  return audio.settings;
}

export function OwnerMenu({
  v,
  onClose,
  openModal,
}: {
  v: RoomView;
  onClose: () => void;
  openModal: (m: ModalKind) => void;
}) {
  const g = v.game;
  const owner = v.you.owner;
  const s = useAudioSettings();
  const ownerLink = v.ownerKey ? `${location.origin}/r/${v.roomId}#k=${v.ownerKey}` : null;
  const doCmd = (msg: string | null, run: () => void) => {
    if (msg && !confirm(msg)) return;
    run();
    onClose();
  };
  return (
    <Modal title={owner ? '房主菜单' : '菜单'} onClose={onClose}>
      <div class="menu">
        <div class="menu-sec">
          <div class="menu-title">房间</div>
          <button type="button" class="menu-item" onClick={() => openModal('invite')}>
            邀请玩家（复制房间链接）
          </button>
          <button type="button" class="menu-item" onClick={() => openModal('name')}>
            修改昵称（{v.you.name || '未设置'}）
          </button>
          {!g && v.you.seat && (
            <button type="button" class="menu-item" onClick={() => doCmd(null, () => send({ t: 'stand' }))}>
              离开座位
            </button>
          )}
          {ownerLink && (
            <button
              type="button"
              class="menu-item"
              onClick={async () => {
                if (await copyText(ownerLink)) toast('房主链接已复制：在其他设备打开即可获得房主权限，请勿分享', 'info');
              }}
            >
              复制房主链接（换设备时使用）
            </button>
          )}
        </div>
        {owner && (
          <div class="menu-sec">
            <div class="menu-title">本机声音</div>
            <label class="field">
              <span>本机播放声音</span>
              <button
                type="button"
                class={`switch${s.enabled ? ' on' : ''}`}
                role="switch"
                aria-checked={s.enabled}
                onClick={() => {
                  audio.update({ enabled: !s.enabled });
                  audio.unlock();
                }}
              >
                <i />
              </button>
            </label>
            <label class="field">
              <span>法官语音</span>
              <button type="button" class={`switch${s.voice ? ' on' : ''}`} role="switch" aria-checked={s.voice} onClick={() => audio.update({ voice: !s.voice })}>
                <i />
              </button>
            </label>
            <label class="field">
              <span>夜间背景音乐</span>
              <button type="button" class={`switch${s.music ? ' on' : ''}`} role="switch" aria-checked={s.music} onClick={() => audio.update({ music: !s.music })}>
                <i />
              </button>
            </label>
            <label class="field">
              <span>语音音量</span>
              <input type="range" min={0} max={1} step={0.05} value={s.voiceVol} onInput={(e) => audio.update({ voiceVol: Number((e.target as HTMLInputElement).value) })} />
            </label>
            <label class="field">
              <span>音乐音量</span>
              <input type="range" min={0} max={1} step={0.05} value={s.musicVol} onInput={(e) => audio.update({ musicVol: Number((e.target as HTMLInputElement).value) })} />
            </label>
            <Btn small onClick={() => audio.test()}>
              测试声音
            </Btn>
            <p class="hint">声音只在房主设备上播放。iPhone 请关闭静音模式或调大媒体音量；游戏中请保持本页在前台。</p>
          </div>
        )}
        {owner && (
          <div class="menu-sec">
            <div class="menu-title">游戏</div>
            {g && g.time !== 'dealt' && g.time !== 'ended' && (
              <button type="button" class="menu-item" onClick={() => doCmd(null, () => ownerCmd({ type: g.paused ? 'resume' : 'pause' }))}>
                {g.paused ? '继续游戏' : '暂停游戏（计时停止）'}
              </button>
            )}
            {g && (
              <button
                type="button"
                class="menu-item"
                onClick={() => doCmd('确定重新开始吗？将使用相同配置和座位重新发牌。', () => ownerCmd({ type: 'restart' }))}
              >
                重新开始（同配置重新发牌）
              </button>
            )}
            <button type="button" class="menu-item" onClick={() => openModal('reconfig')}>
              {g ? '重新配置并开始' : '修改配置'}
            </button>
            {g && (
              <button
                type="button"
                class="menu-item danger"
                onClick={() => doCmd('确定结束本局并返回大厅吗？', () => ownerCmd({ type: 'abort' }))}
              >
                结束本局，返回大厅
              </button>
            )}
          </div>
        )}
        {owner && (
          <div class="menu-sec">
            <div class="menu-title">座位管理</div>
            <p class="hint">
              {g
                ? '游戏中释放座位后，该座位可以被重新认领（用于玩家换手机或换人），也可以交给机器人接管。身份保持不变。'
                : '移出座位上的玩家或机器人，或在空座位上放一个机器人。'}
            </p>
            <div class="seat-admin">
              {v.seats.map((x) => {
                if (x.occupied)
                  return (
                    <button
                      type="button"
                      key={x.seat}
                      class="menu-item small"
                      onClick={() =>
                        doCmd(
                          g
                            ? `释放${x.seat}号座位（${x.name}）？之后需要有人认领或让机器人接管。`
                            : x.bot
                              ? null
                              : `把${x.name}移出${x.seat}号座位？`,
                          () => ownerCmd({ type: 'kick', seat: x.seat }),
                        )
                      }
                    >
                      {x.seat}号 {x.name} {x.connected ? '' : '（离线）'} · {g ? '释放' : '移出'}
                    </button>
                  );
                if (g && !x.claimable) return null;
                return (
                  <button
                    type="button"
                    key={x.seat}
                    class="menu-item small"
                    onClick={() => doCmd(null, () => ownerCmd({ type: 'addBots', seats: [x.seat] }))}
                  >
                    {x.seat}号 {g ? '待认领 · 机器人接管' : '空位 · 放一个机器人'}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function ReconfigModal({ v, onClose }: { v: RoomView; onClose: () => void }) {
  const [cfg, setCfg] = useState<GameConfig>(() => structuredClone(v.config));
  return (
    <Modal title="配置" onClose={onClose} wide>
      <ConfigEditor value={cfg} onChange={setCfg} />
      <div class="btn-row">
        <Btn
          kind="primary"
          onClick={() => {
            if (v.game && v.game.time !== 'ended' && !confirm('当前游戏将结束并返回大厅，确定吗？')) return;
            ownerCmd({ type: 'reconfigure', config: cfg });
            onClose();
          }}
        >
          {v.game ? '应用配置并返回大厅' : '应用配置'}
        </Btn>
        <Btn kind="ghost" onClick={onClose}>
          取消
        </Btn>
      </div>
      <p class="hint">返回大厅后玩家保留座位，房主再次点击「发牌」即可开始。</p>
    </Modal>
  );
}
