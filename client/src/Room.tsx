import { useEffect, useReducer, useState } from 'preact/hooks';
import { allClips } from '../../shared/audio.ts';
import { ROLES } from '../../shared/roles.ts';
import type { RoomView, SeatView } from '../../shared/types.ts';
import { audio } from './audio/engine.ts';
import { navigate } from './Home.tsx';
import { saveName, savedName } from './lib/ids.ts';
import { serverNow, useStore } from './lib/store.ts';
import { keepAwake } from './lib/wakelock.ts';
import { connect, conn, send } from './lib/ws.ts';
import { HistoryModal, InviteModal, NameModal, OwnerMenu, ReconfigModal, RoleCardModal, RulesModal, SkillModal } from './modals.tsx';
import { ActionArea } from './panels.tsx';
import { Btn, Countdown, RoleIcon, factionClass } from './ui.tsx';

export type ModalKind = 'role' | 'skill' | 'history' | 'rules' | 'menu' | 'reconfig' | 'invite' | 'name' | null;

function useAudioState(): void {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => audio.subscribe(() => force(0)), []);
}

export function Room({ roomId }: { roomId: string }) {
  const st = useStore();
  useEffect(() => {
    connect(roomId);
    return () => conn()?.stop();
  }, [roomId]);

  if (st.fatal) {
    return (
      <div class="page center-page">
        <div class="panel fatal">
          <h2>{st.fatal}</h2>
          <p>房间链接可能已经过期（房间在长时间无人使用后会被清理）。</p>
          <Btn kind="primary" onClick={() => navigate('/')}>
            创建新房间
          </Btn>
        </div>
      </div>
    );
  }
  if (!st.view) {
    return (
      <div class="page center-page">
        <div class="loading">
          <div class="moon-spinner" />
          <p>{st.conn === 'closed' ? '连接失败，正在重试…' : '正在进入房间…'}</p>
        </div>
      </div>
    );
  }
  return <RoomScreen v={st.view} connState={st.conn} />;
}

function RoomScreen({ v, connState }: { v: RoomView; connState: string }) {
  const [modal, setModal] = useState<ModalKind>(null);
  const g = v.game;
  const time = g ? g.time : 'lobby';
  const owner = v.you.owner;
  useAudioState();

  // name is required before sitting
  const needName = !v.you.name;

  // audio: owner devices play announcements and the night music
  useEffect(() => {
    if (!owner || !g) {
      audio.setNight(false);
      return;
    }
    audio.handle(g.announcements, serverNow());
    audio.setNight(g.time === 'night' && !g.paused);
  });
  useEffect(() => {
    if (owner) audio.resetAnnouncements();
  }, [g?.gameNo]);
  useEffect(() => {
    if (!owner) return;
    const unlock = () => {
      audio.unlock();
      if (audio.unlocked) audio.preload(Object.keys(allClips()));
    };
    document.addEventListener('pointerdown', unlock, { passive: true });
    document.addEventListener('touchend', unlock, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('touchend', unlock);
    };
  }, [owner]);

  // keep screens on while a game runs
  useEffect(() => {
    keepAwake(!!g && g.time !== 'ended');
    return () => keepAwake(false);
  }, [!!g && g.time !== 'ended']);

  // theme
  useEffect(() => {
    document.body.dataset.time = time;
    return () => {
      delete document.body.dataset.time;
    };
  }, [time]);

  // auto-close the private modals when night falls or the phase changes hands
  useEffect(() => {
    if (modal === 'skill' || modal === 'history') setModal(null);
  }, [g?.night]);

  const me = v.you.seat;
  return (
    <div class={`room time-${time}`}>
      <TopBar v={v} onMenu={() => setModal('menu')} />
      {connState !== 'open' && <div class="conn-banner">连接中断，正在重连…</div>}
      {owner && g && g.time !== 'ended' && audio.settings.enabled && !audio.unlocked && (
        <button type="button" class="audio-banner" onClick={() => audio.unlock()}>
          {audio.interrupted ? '🔈 声音被系统打断了，点此恢复' : '🔈 点击此处启用本机声音（夜间指令与背景音乐）'}
        </button>
      )}
      <Banner v={v} />
      {!(g?.time === 'night' && g.you?.prompt) && <SeatGrid v={v} />}
      <main class="action-area">
        <ActionArea v={v} openModal={setModal} />
      </main>
      {g && (
        <nav class="bottom-nav" aria-label="菜单">
          <button type="button" onClick={() => setModal('role')} disabled={!me}>
            <RoleIcon icon="blank" size={22} />
            <span>身份</span>
          </button>
          <button type="button" onClick={() => setModal('skill')} disabled={!me}>
            <RoleIcon icon="crosshair" size={22} />
            <span>技能</span>
          </button>
          <button type="button" onClick={() => setModal('history')}>
            <RoleIcon icon="feather" size={22} />
            <span>记录</span>
          </button>
          <button type="button" onClick={() => setModal('rules')}>
            <RoleIcon icon="spiral" size={22} />
            <span>规则</span>
          </button>
        </nav>
      )}
      {!g && (
        <nav class="bottom-nav" aria-label="菜单">
          <button type="button" onClick={() => setModal('invite')}>
            <RoleIcon icon="person" size={22} />
            <span>邀请</span>
          </button>
          <button type="button" onClick={() => setModal('rules')}>
            <RoleIcon icon="spiral" size={22} />
            <span>规则</span>
          </button>
          <button type="button" onClick={() => setModal('name')}>
            <RoleIcon icon="feather" size={22} />
            <span>昵称</span>
          </button>
        </nav>
      )}

      {(needName || modal === 'name') && (
        <NameModal
          initial={v.you.name || savedName()}
          required={needName}
          onDone={(n) => {
            saveName(n);
            send({ t: 'rename', name: n });
            setModal(null);
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'role' && <RoleCardModal v={v} onClose={() => setModal(null)} />}
      {modal === 'skill' && <SkillModal v={v} onClose={() => setModal(null)} />}
      {modal === 'history' && <HistoryModal v={v} onClose={() => setModal(null)} />}
      {modal === 'rules' && <RulesModal v={v} onClose={() => setModal(null)} />}
      {modal === 'invite' && <InviteModal v={v} onClose={() => setModal(null)} />}
      {modal === 'menu' && <OwnerMenu v={v} onClose={() => setModal(null)} openModal={setModal} />}
      {modal === 'reconfig' && <ReconfigModal v={v} onClose={() => setModal(null)} />}
    </div>
  );
}

function TopBar({ v, onMenu }: { v: RoomView; onMenu: () => void }) {
  const g = v.game;
  let label = '等待入座';
  if (g) {
    if (g.time === 'dealt') label = '身份已发放';
    else if (g.time === 'night') label = `第${g.night}夜`;
    else if (g.time === 'day') label = `第${g.day}天`;
    else label = '游戏结束';
  }
  return (
    <header class="topbar">
      <div class="tb-left">
        <span class={`tb-phase ${g?.time ?? 'lobby'}`}>
          {g?.time === 'night' ? '☾' : g?.time === 'day' ? '☀' : '◆'} {label}
        </span>
        {g?.paused && <span class="tb-paused">已暂停</span>}
      </div>
      <div class="tb-board" title={v.config.boardName}>
        {v.config.boardName} · {v.playerCount}人
      </div>
      <div class="tb-right">
        {v.you.owner && (
          <button
            type="button"
            class={`icon-btn${audio.settings.enabled ? '' : ' off'}`}
            aria-label={audio.settings.enabled ? '关闭本机声音' : '开启本机声音'}
            onClick={() => {
              audio.update({ enabled: !audio.settings.enabled });
              if (!audio.settings.enabled) return;
              audio.unlock();
            }}
          >
            {audio.settings.enabled ? '🔊' : '🔇'}
          </button>
        )}
        <button type="button" class="icon-btn menu-btn" aria-label="菜单" onClick={onMenu}>
          ⋮
        </button>
      </div>
    </header>
  );
}

function Banner({ v }: { v: RoomView }) {
  const g = v.game;
  if (!g) {
    const filled = v.seats.filter((s) => s.occupied).length;
    return (
      <section class="banner">
        <div class="banner-text">
          <h2>{filled < v.playerCount ? '等待玩家入座' : '玩家已到齐'}</h2>
          <p>
            {filled}/{v.playerCount} 已入座 · {v.you.owner ? '坐满后即可发牌' : '等待房主发牌'}
          </p>
        </div>
      </section>
    );
  }
  const deadline = g.time === 'night' ? (g.you?.deadline ?? null) : g.deadline;
  return (
    <section class={`banner ${g.time}`}>
      {g.time === 'night' && <div class="moon" aria-hidden="true" />}
      <div class="banner-text">
        <h2>{g.banner.title || '…'}</h2>
        {g.banner.sub && <p>{g.banner.sub}</p>}
      </div>
      <Countdown deadline={deadline} paused={g.paused} />
    </section>
  );
}

function seatStatus(v: RoomView, s: SeatView): { chips: string[]; cls: string[] } {
  const g = v.game;
  const chips: string[] = [];
  const cls: string[] = [];
  if (!g) return { chips, cls };
  const ph = g.phase;
  if (!s.alive) cls.push('dead');
  if (ph.kind === 'speech') {
    if (ph.order[ph.idx] === s.seat) cls.push('speaking');
    if ((ph.context === 'sheriff' || ph.context === 'sheriffPk') && ph.candidates.includes(s.seat)) chips.push('警上');
    if (ph.withdrawn.includes(s.seat) && (ph.context === 'sheriff' || ph.context === 'sheriffPk')) chips.push('退水');
  }
  if (ph.kind === 'withdraw') {
    if (ph.candidates.includes(s.seat)) chips.push('警上');
    if (ph.withdrawn.includes(s.seat)) chips.push('退水');
  }
  if (ph.kind === 'vote') {
    if (ph.candidates.includes(s.seat) && (ph.context === 'sheriff' || ph.context === 'sheriffPk' || ph.context === 'exilePk'))
      chips.push('候选');
    if (ph.voted.includes(s.seat)) cls.push('voted');
  }
  if (ph.kind === 'deathSkills') {
    const e = ph.entries.find((x) => x.seat === s.seat);
    if (e) chips.push(e.done ? '已确认' : '技能确认中');
  }
  if (ph.kind === 'princeWindow' && ph.target === s.seat) chips.push('得票最多');
  if (ph.kind === 'dealt' && s.viewedRole) chips.push('已看牌');
  return { chips, cls };
}

function SeatGrid({ v }: { v: RoomView }) {
  const g = v.game;
  const lobby = !g;
  const me = v.you.seat;
  const cols = v.playerCount <= 9 ? 3 : v.playerCount <= 12 ? 4 : v.playerCount <= 16 ? 4 : 5;
  const onTap = (s: SeatView) => {
    if (!v.you.name) return;
    if (lobby) {
      if (s.seat === me) return;
      // a bot gives its seat up to whoever taps it
      if (!s.occupied || s.bot) send({ t: 'sit', seat: s.seat });
      return;
    }
    if (s.claimable && !me) {
      if (confirm(`确定认领${s.seat}号座位吗？你将接手这个座位的身份继续游戏。`)) send({ t: 'sit', seat: s.seat });
    }
  };
  return (
    <section class={`seats cols-${cols}`} aria-label="座位">
      {v.seats.map((s) => {
        const st = seatStatus(v, s);
        const mine = s.seat === me;
        // bot seats can be taken too, but only empty seats are highlighted
        const clickable = (lobby && !s.occupied && !!v.you.name) || (s.claimable && !me);
        return (
          <button
            type="button"
            key={s.seat}
            class={`seat${mine ? ' me' : ''}${s.occupied ? '' : ' empty'}${s.bot ? ' bot' : ''}${clickable ? ' clickable' : ''} ${st.cls.join(' ')}${s.revealed ? ` ${factionClass(s.revealed)}` : ''}`}
            onClick={() => onTap(s)}
            aria-label={`${s.seat}号 ${s.name ?? '空位'}`}
          >
            <span class="seat-no">{s.seat}</span>
            {s.sheriff && <span class="seat-badge sheriff" title="警长">警</span>}
            {s.occupied && !s.connected && <span class="seat-offline" title="离线" />}
            <span class="seat-name">
              {s.bot && (
                <i class="bot-mark">
                  <RoleIcon icon="bot" size={12} />
                </i>
              )}
              {s.name ?? (s.claimable ? '待认领' : lobby ? '空位' : '—')}
              {s.owner && <i class="owner-mark" title="房主">主</i>}
            </span>
            {s.revealed && (
              <span class="seat-role">
                <RoleIcon role={s.revealed} size={12} /> {ROLES[s.revealed].name}
              </span>
            )}
            {!s.alive && <span class="seat-dead">{s.deadNote ?? '出局'}</span>}
            {st.chips.length > 0 && s.alive && <span class="seat-chip">{st.chips.join(' ')}</span>}
            {mine && <span class="seat-me">我</span>}
          </button>
        );
      })}
    </section>
  );
}
