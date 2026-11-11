// Owner-device audio: judge voice clips (queued, music ducked underneath) and
// the night soundtrack. Only devices with "本机播放声音" enabled play anything.
import type { Announcement } from '../../../shared/types.ts';
import { getItem, setItem } from '../lib/ids.ts';
import { NightMusic, NightTrack, type NightSound } from './music.ts';

/** optional recorded night music (git-ignored; scripts/prep_music.ts); the synth plays without it */
const NIGHT_TRACK_URL = '/music/night.mp3';

/** iPhones and iPads (iPadOS reports a Mac user agent, but with touch points) */
const IS_IOS = (() => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent.toLowerCase();
  return (/iphone|ipod|ipad/.test(ua) && !ua.includes('like iphone')) || (ua.includes('mac os x') && navigator.maxTouchPoints > 0);
})();
/** one second of high-quality silence (48 kHz stereo, 256 kbps): iOS mixes Web Audio to match this element's format */
const SILENCE_URL = '/silence.mp3';

export interface AudioSettings {
  enabled: boolean;
  voice: boolean;
  music: boolean;
  voiceVol: number;
  musicVol: number;
}

const DEFAULTS: AudioSettings = { enabled: true, voice: true, music: true, voiceVol: 1, musicVol: 0.7 };
// music level while the judge speaks: effectively silent, so directives are never covered
const DUCK = 0.03;

type AudioCtor = typeof AudioContext;

class AudioEngine {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voiceBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private duck: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer | null>>();
  private queue: Announcement[] = [];
  private playing = false;
  private music: NightSound | null = null;
  /** the decoded night track: undefined = not tried yet, null = none (the synth plays) */
  private track: AudioBuffer | null | undefined = undefined;
  private trackLoad: Promise<AudioBuffer | null> | null = null;
  /** bumped whenever the music starts or stops, so a late track download cannot start a stale night */
  private musicToken = 0;
  private nightOn = false;
  /** iOS: a looping silent <audio> element that keeps the page on the media channel (see openMediaChannel) */
  private channel: HTMLAudioElement | null = null;
  /** the last thing that went wrong, for the 声音诊断 lines in the owner menu */
  private lastProblem: string | null = null;
  private played = 0;
  /**
   * The system interrupted, suspended or froze the audio engine (a call, Siri, another app's or a notification's
   * sound, the screen locking, switching apps, headphones…). iOS can hand such a page back an engine that stays
   * silent although it claims to run, which only a reload used to fix. Now the next tap builds a fresh engine
   * (dropContext + unlock), and the owner's banner asks for that tap.
   */
  private stale = false;
  private wasRunning = false;
  private rebuilds = 0;
  private clock: { ctx: number; wall: number } | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  /** the latest judge line, replayed after a rebuild if it is still fresh */
  private latest: { a: Announcement; at: number } | null = null;
  private replayDue = false;
  private lastId = -1;
  private subs = new Set<() => void>();
  settings: AudioSettings;

  constructor() {
    let s = DEFAULTS;
    try {
      s = { ...DEFAULTS, ...JSON.parse(getItem('wwd.audio') ?? '{}') };
    } catch {
      /* defaults */
    }
    this.settings = s;
    if (IS_IOS && typeof document !== 'undefined') {
      // in the background the silent element would only show media controls on the lock screen
      const hidden = () => {
        if (document.visibilityState === 'visible') return;
        this.closeMediaChannel();
        // the engine iOS hands back after the background is often silent: rebuild it on the next tap
        if (this.ctx && this.wasRunning) this.markStale('页面进入后台');
      };
      document.addEventListener('visibilitychange', hidden);
      window.addEventListener('pagehide', () => this.closeMediaChannel());
    }
    if (typeof window !== 'undefined') {
      // restored from the back-forward cache: the old engine is not to be trusted
      window.addEventListener('pageshow', (e) => {
        if ((e as PageTransitionEvent).persisted && this.ctx) this.markStale('页面从缓存恢复');
      });
    }
  }

  private markStale(why: string): void {
    if (this.stale) return;
    this.stale = true;
    this.note(`声音被打断（${why}），点一下页面即可恢复`);
  }

  /** true when sound was working and then got cut off by the system (the banner offers to restore it) */
  get interrupted(): boolean {
    return this.stale || (this.wasRunning && !!this.ctx && this.ctx.state !== 'running');
  }

  /** a context can claim to run while its clock stands still (no sound): check while something should be heard */
  private checkClock(): void {
    const ctx = this.ctx;
    const audible = this.playing || !!this.music;
    if (!ctx || ctx.state !== 'running' || this.stale || !audible || document.visibilityState !== 'visible') {
      this.clock = null;
      return;
    }
    const wall = performance.now();
    const before = this.clock;
    this.clock = { ctx: ctx.currentTime, wall };
    if (before && wall - before.wall >= 900 && ctx.currentTime - before.ctx < 0.05) this.markStale('声音时钟停止');
  }

  /** throws away an interrupted engine; unlock() builds a fresh one (decoded clips and the night track are kept) */
  private dropContext(): void {
    const old = this.ctx;
    this.stopMusic();
    this.ctx = null;
    this.master = this.voiceBus = this.musicBus = this.duck = null;
    this.stale = false;
    this.wasRunning = false;
    this.clock = null;
    if (old) {
      old.onstatechange = null;
      void old.close().catch(() => {});
    }
    this.rebuilds++;
    this.note(`已重建声音引擎（第 ${this.rebuilds} 次）`);
  }

  /**
   * iOS treats Web Audio as "ambient" sound, which the ring/silent switch mutes. While an <audio> element
   * plays, the page is on the media channel instead, which the switch does not mute, so the owner's phone
   * keeps a looping silent element playing (the technique of the "unmute" library). navigator.audioSession
   * 'playback' is meant to do the same on iOS 17+, but it does not work everywhere (WebKit bug reports,
   * in-app browsers). play() needs a tap; a refused attempt is retried on the next one.
   */
  private openMediaChannel(): void {
    if (!IS_IOS || !this.settings.enabled || document.visibilityState !== 'visible') return;
    if (!this.channel) {
      const tag = document.createElement('audio');
      tag.setAttribute('x-webkit-airplay', 'deny');
      tag.controls = false;
      tag.disableRemotePlayback = true;
      tag.preload = 'auto';
      tag.loop = true;
      tag.src = SILENCE_URL;
      // whether the channel is open (read by the e2e tests)
      tag.addEventListener('playing', () => {
        if (this.channel === tag) document.documentElement.dataset.mediaChannel = 'on';
      });
      tag.load();
      this.channel = tag;
    }
    if (this.channel.paused)
      void this.channel.play().catch((e: unknown) => {
        this.note(`静音通道未能播放（${(e as Error)?.name ?? e}），下次点击会重试`);
      });
  }

  private closeMediaChannel(): void {
    const tag = this.channel;
    if (!tag) return;
    this.channel = null;
    delete document.documentElement.dataset.mediaChannel;
    tag.pause();
    // unloading the source is what clears the lock-screen media controls
    tag.removeAttribute('src');
    tag.load();
  }

  private note(problem: string): void {
    this.lastProblem = `${new Date().toLocaleTimeString()} ${problem}`;
    this.emit();
  }

  /** a few lines that tell what the sound on this phone is doing (owner menu → 声音诊断) */
  diagnostics(): string[] {
    const nav = navigator as Navigator & { audioSession?: { type: string }; standalone?: boolean };
    const ua = navigator.userAgent;
    const ios = /OS (\d+)[._](\d+)/.exec(ua);
    const browser = /MicroMessenger/i.test(ua)
      ? '微信内置浏览器'
      : /\bQQ\//.test(ua)
        ? 'QQ 内置浏览器'
        : /CriOS/.test(ua)
          ? 'Chrome'
          : /FxiOS/.test(ua)
            ? 'Firefox'
            : /EdgiOS|Edg\//.test(ua)
              ? 'Edge'
              : /Android/.test(ua)
                ? 'Android 浏览器'
                : /Safari/.test(ua)
                  ? 'Safari'
                  : '其他浏览器';
    const home = matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
    const ctx = this.ctx;
    const s = this.settings;
    const settings = !s.enabled ? '本机声音已关闭' : `语音${s.voice ? Math.round(s.voiceVol * 100) + '%' : '关'} · 音乐${s.music ? Math.round(s.musicVol * 100) + '%' : '关'}`;
    return [
      `设备：${IS_IOS ? `iOS ${ios ? `${ios[1]}.${ios[2]}` : '?'}` : /Android/.test(ua) ? 'Android' : '电脑'} · ${browser}${home ? ' · 主屏幕应用' : ''}`,
      `设置：${settings}`,
      `声音引擎：${ctx ? `${ctx.state === 'running' ? '运行中' : ctx.state} · ${ctx.sampleRate} Hz${this.stale ? ' · 被打断，点一下页面恢复' : ''}` : '未启动（点一下页面）'}${this.rebuilds ? ` · 已重建 ${this.rebuilds} 次` : ''}`,
      `声音会话：${nav.audioSession ? nav.audioSession.type : '浏览器不支持'}${IS_IOS ? ` · 静音通道：${this.channel && !this.channel.paused ? '开' : '关'}` : ''}`,
      `语音：已加载 ${this.buffers.size} 段 · 已播放 ${this.played} 句`,
      `夜间音乐：${this.track ? `录制曲目 ${Math.round(this.track.duration)} 秒` : this.track === null ? '合成音乐' : this.trackLoad ? '下载中' : '未加载'}`,
      `最近问题：${this.lastProblem ?? '无'}`,
    ];
  }

  subscribe(f: () => void): () => void {
    this.subs.add(f);
    return () => this.subs.delete(f);
  }

  private emit(): void {
    for (const f of this.subs) f();
  }

  get unlocked(): boolean {
    return !!this.ctx && this.ctx.state === 'running' && !this.stale;
  }

  update(p: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...p };
    setItem('wwd.audio', JSON.stringify(this.settings));
    this.applyVolumes();
    if (!this.settings.enabled || !this.settings.music) this.stopMusic();
    else if (this.nightOn) this.startMusic();
    if (!this.settings.enabled) {
      this.queue = [];
      this.closeMediaChannel();
    }
    this.emit();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.voiceBus?.gain.setTargetAtTime(this.settings.voiceVol, t, 0.05);
    this.musicBus?.gain.setTargetAtTime(this.settings.music ? this.settings.musicVol : 0, t, 0.2);
  }

  /** must run inside a user gesture (iOS) */
  unlock(): void {
    if (!this.settings.enabled) return;
    try {
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      // iOS 16.4+: play even with the silent switch on
      if (nav.audioSession) nav.audioSession.type = 'playback';
    } catch {
      /* not supported */
    }
    const rebuilt = !!this.ctx && (this.stale || this.ctx.state === 'closed');
    if (rebuilt) this.dropContext();
    if (!this.ctx) {
      const Ctor: AudioCtor | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      this.master = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 3;
      this.master.connect(comp).connect(ctx.destination);
      this.voiceBus = ctx.createGain();
      this.voiceBus.connect(this.master);
      this.musicBus = ctx.createGain();
      this.duck = ctx.createGain();
      this.musicBus.connect(this.duck).connect(this.master);
      this.applyVolumes();
      ctx.onstatechange = () => {
        if (ctx !== this.ctx) return;
        const st = ctx.state as string;
        if (st === 'running') {
          this.wasRunning = true;
          // iOS starts a new engine suspended and runs it a moment after the tap: start the night music then
          if (this.nightOn && this.settings.enabled && this.settings.music) this.startMusic();
          this.replayLatest();
        }
        // iOS: 'interrupted' (a call, Siri, another sound) or 'suspended' (screen lock, background)
        else if (this.wasRunning && st !== 'closed') this.markStale(`系统把声音引擎切到了 ${st}`);
        this.emit();
      };
      if (!this.watchdog) this.watchdog = setInterval(() => this.checkClock(), 1000);
    }
    if (this.ctx.state !== 'running')
      void this.ctx
        .resume()
        .then(() => this.emit())
        .catch(() => {});
    this.openMediaChannel();
    // start fetching the night track at the very first tap: it is the one big download
    void this.loadTrack();
    // a silent buffer fully unlocks older iOS
    const b = this.ctx.createBuffer(1, 1, 22050);
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    src.connect(this.ctx.destination);
    src.start(0);
    if (this.nightOn && this.settings.music) this.startMusic();
    // after a rebuild, say the current instruction again (it was likely lost) once the new engine runs
    if (rebuilt) this.replayDue = true;
    if (this.ctx.state === 'running') {
      this.wasRunning = true;
      this.replayLatest();
    }
    this.emit();
  }

  private replayLatest(): void {
    if (!this.replayDue) return;
    this.replayDue = false;
    const l = this.latest;
    if (l && Date.now() - l.at < 12_000 && !this.queue.includes(l.a)) this.enqueue(l.a);
  }

  private load(id: string): Promise<AudioBuffer | null> {
    const have = this.buffers.get(id);
    if (have) return Promise.resolve(have);
    const pending = this.loading.get(id);
    if (pending) return pending;
    const ctx = this.ctx;
    if (!ctx) return Promise.resolve(null);
    const p = fetch(`/audio/${id}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then(
        (ab) =>
          new Promise<AudioBuffer>((resolve, reject) => {
            // callback form for old Safari
            ctx.decodeAudioData(ab, resolve, reject);
          }),
      )
      .then((buf) => {
        this.buffers.set(id, buf);
        return buf;
      })
      .catch((e: unknown) => {
        this.note(`语音片段 ${id} 加载失败（${(e as Error)?.message || (e as Error)?.name || e}）`);
        return null;
      })
      .finally(() => this.loading.delete(id));
    this.loading.set(id, p);
    return p;
  }

  /** downloads and decodes the night track once (about 3 MB; only owner phones play audio) */
  private loadTrack(): Promise<AudioBuffer | null> {
    if (this.track !== undefined) return Promise.resolve(this.track);
    if (this.trackLoad) return this.trackLoad;
    const ctx = this.ctx;
    if (!ctx) return Promise.resolve(null);
    this.trackLoad = fetch(NIGHT_TRACK_URL)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((ab) => new Promise<AudioBuffer>((resolve, reject) => ctx.decodeAudioData(ab, resolve, reject)))
      .then((b) => (this.track = b))
      .catch(() => (this.track = null))
      .finally(() => {
        this.trackLoad = null;
      });
    return this.trackLoad;
  }

  preload(ids: string[]): void {
    if (!this.ctx) return;
    void this.loadTrack();
    let i = 0;
    const worker = async () => {
      while (i < ids.length) await this.load(ids[i++]);
    };
    for (let k = 0; k < 4; k++) void worker();
  }

  /** feed every view's announcements; plays the new ones */
  handle(anns: Announcement[], serverNow: number): void {
    if (!anns.length) return;
    const maxId = anns[anns.length - 1].id;
    if (this.lastId < 0) {
      // first view after (re)loading: only very fresh lines are played
      for (const a of anns) if (serverNow - a.at < 2500) this.enqueue(a);
      this.lastId = maxId;
      return;
    }
    if (maxId < this.lastId) this.lastId = -1; // a new game restarted the ids
    for (const a of anns) {
      if (a.id <= this.lastId) continue;
      this.lastId = a.id;
      if (serverNow - a.at < 15000) this.enqueue(a);
    }
  }

  resetAnnouncements(): void {
    this.lastId = -1;
    this.queue = [];
  }

  private enqueue(a: Announcement): void {
    if (!this.settings.enabled || !this.settings.voice) return;
    if (a.id >= 0) this.latest = { a, at: Date.now() };
    this.queue.push(a);
    if (!this.playing) void this.drain();
  }

  private async drain(): Promise<void> {
    this.playing = true;
    try {
      while (this.queue.length) {
        const a = this.queue.shift()!;
        await this.play(a);
      }
    } finally {
      this.playing = false;
      this.unduck();
    }
  }

  private async play(a: Announcement): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') {
      this.note(`声音引擎${ctx ? `处于 ${ctx.state} 状态` : '未启动'}，改用系统朗读`);
      return this.speak(a.text);
    }
    const bufs = await Promise.race([
      Promise.all(a.clips.map((c) => this.load(c))),
      new Promise<null>((r) => setTimeout(() => r(null), 4000)),
    ]);
    if (!bufs || bufs.some((b) => !b)) {
      this.note(bufs ? '语音片段加载失败，改用系统朗读' : '语音片段 4 秒内没有加载完，改用系统朗读');
      return this.speak(a.text);
    }
    this.played++;
    this.duckNow();
    let t = ctx.currentTime + 0.12;
    for (const b of bufs as AudioBuffer[]) {
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.connect(this.voiceBus!);
      src.start(t);
      t += b.duration + 0.06;
    }
    const ms = (t - ctx.currentTime) * 1000 + 150;
    await new Promise((r) => setTimeout(r, ms));
  }

  /** fallback when clips cannot be loaded: the browser's own TTS */
  private speak(text: string): Promise<void> {
    return new Promise((resolve) => {
      const synth = window.speechSynthesis;
      if (!synth || !text) return resolve();
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'zh-CN';
        u.volume = this.settings.voiceVol;
        const done = () => resolve();
        u.onend = done;
        u.onerror = done;
        this.duckNow();
        synth.speak(u);
        setTimeout(done, 12000);
      } catch {
        resolve();
      }
    });
  }

  private duckNow(): void {
    if (!this.ctx || !this.duck) return;
    this.duck.gain.setTargetAtTime(DUCK, this.ctx.currentTime, 0.08);
  }

  private unduck(): void {
    if (!this.ctx || !this.duck) return;
    this.duck.gain.setTargetAtTime(1, this.ctx.currentTime + 0.3, 0.5);
  }

  setNight(on: boolean): void {
    if (on === this.nightOn) return;
    this.nightOn = on;
    if (on && this.settings.enabled && this.settings.music) this.startMusic();
    if (!on) this.stopMusic();
  }

  private startMusic(): void {
    if (this.music || !this.ctx || this.ctx.state !== 'running' || !this.musicBus) return;
    const token = ++this.musicToken;
    const current = () => token === this.musicToken && this.nightOn && this.settings.enabled && this.settings.music;
    const play = (buf: AudioBuffer | null) => {
      if (!this.ctx || !this.musicBus) return;
      this.music = buf ? new NightTrack(this.ctx, this.musicBus, buf) : new NightMusic(this.ctx, this.musicBus);
      this.music.start();
      // which music plays (read by the e2e tests)
      document.documentElement.dataset.nightMusic = buf ? 'track' : 'synth';
    };
    if (this.track !== undefined) return play(this.track);
    // the track usually finished loading in the lobby; if not, give it a moment, then let the synth play
    // and crossfade to the track as soon as it is ready
    const loading = this.loadTrack();
    const moment = new Promise<undefined>((r) => setTimeout(() => r(undefined), 1500));
    void Promise.race([loading, moment]).then((buf) => {
      if (!current() || this.music) return;
      if (buf !== undefined) return play(buf);
      play(null);
      void loading.then((late) => {
        if (!late || !current() || !(this.music instanceof NightMusic)) return;
        this.music.stop(4);
        play(late);
      });
    });
  }

  private stopMusic(): void {
    this.musicToken++;
    this.music?.stop();
    this.music = null;
    delete document.documentElement.dataset.nightMusic;
  }

  /** test button in the settings */
  test(): void {
    this.unlock();
    this.enqueue({ id: -1, at: Date.now(), text: '天黑请闭眼。', clips: ['night_start'] });
  }
}

export const audio = new AudioEngine();
