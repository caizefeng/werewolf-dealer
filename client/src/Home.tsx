import { useState } from 'preact/hooks';
import { presetConfig, validateConfig, type GameConfig } from '../../shared/config.ts';
import { ConfigEditor } from './Config.tsx';
import { clientId, rememberOwnerKey, saveName, savedName } from './lib/ids.ts';
import { toast } from './lib/store.ts';
import { Btn } from './ui.tsx';

export function navigate(path: string): void {
  history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function Home() {
  const [cfg, setCfg] = useState<GameConfig>(() => presetConfig('ynlb'));
  const [name, setName] = useState(savedName());
  const [busy, setBusy] = useState(false);
  const [join, setJoin] = useState('');
  const err = validateConfig(cfg);

  const create = async () => {
    const n = name.trim();
    if (!n) {
      toast('请先填写你的昵称');
      return;
    }
    if (err) {
      toast(err);
      return;
    }
    setBusy(true);
    try {
      saveName(n);
      const r = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId: clientId(), name: n, config: cfg }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || '创建失败');
      rememberOwnerKey(body.roomId, body.ownerKey);
      navigate(`/r/${body.roomId}`);
    } catch (e) {
      toast((e as Error).message || '创建失败，请检查网络');
    } finally {
      setBusy(false);
    }
  };

  const goJoin = () => {
    const m = /([a-z0-9]{6,16})\s*$/.exec(join.trim().replace(/\/+$/, ''));
    if (!m) {
      toast('请输入房间链接或房间号');
      return;
    }
    navigate(`/r/${m[1]}`);
  };

  return (
    <div class="page home">
      <header class="hero">
        <h1 class="brand">Werewolf Dealer</h1>
        <p class="tagline">线下狼人杀 · 发牌与法官助手</p>
      </header>
      <section class="panel">
        <ConfigEditor value={cfg} onChange={setCfg} />
        <div class="section-title">你的昵称</div>
        <input
          class="text-input"
          maxLength={12}
          placeholder="其他玩家看到的名字"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
        <Btn kind="primary" block class="create-btn" disabled={busy || !!err} onClick={create}>
          {busy ? '创建中…' : '创建房间'}
        </Btn>
        <p class="hint">创建后把房间链接发到群里，大家点开即可选座。你也可以坐下一起玩。</p>
      </section>
      <section class="panel join-panel">
        <div class="section-title">加入房间</div>
        <div class="row">
          <input
            class="text-input"
            placeholder="粘贴房间链接或房间号"
            value={join}
            onInput={(e) => setJoin((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && goJoin()}
          />
          <Btn onClick={goJoin}>进入</Btn>
        </div>
      </section>
      <footer class="foot">规则以京城大师赛为准 · 夜间指令由房主手机播放</footer>
    </div>
  );
}
