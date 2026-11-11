// Owner-device audio: judge voice clips (queued, music ducked underneath) and
// the night soundtrack. Only devices with "本机播放声音" enabled play anything.
import type { Announcement } from '../../../shared/types.ts';
import { getItem, setItem } from '../lib/ids.ts';
import { NightMusic, NightTrack, type NightSound } from './music.ts';

/** optional recorded night music (git-ignored; scripts/prep_music.ts); the synth plays without it */
const NIGHT_TRACK_URL = '/music/night.mp3';

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
  }

  subscribe(f: () => void): () => void {
    this.subs.add(f);
    return () => this.subs.delete(f);
  }

  private emit(): void {
    for (const f of this.subs) f();
  }

  get unlocked(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  update(p: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...p };
    setItem('wwd.audio', JSON.stringify(this.settings));
    this.applyVolumes();
    if (!this.settings.enabled || !this.settings.music) this.stopMusic();
    else if (this.nightOn) this.startMusic();
    if (!this.settings.enabled) this.queue = [];
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
      ctx.onstatechange = () => this.emit();
    }
    if (this.ctx.state !== 'running') void this.ctx.resume().then(() => this.emit());
    // start fetching the night track at the very first tap: it is the one big download
    void this.loadTrack();
    // a silent buffer fully unlocks older iOS
    const b = this.ctx.createBuffer(1, 1, 22050);
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    src.connect(this.ctx.destination);
    src.start(0);
    if (this.nightOn && this.settings.music) this.startMusic();
    this.emit();
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
      .catch(() => null)
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
    if (!ctx || ctx.state !== 'running') return this.speak(a.text);
    const bufs = await Promise.race([
      Promise.all(a.clips.map((c) => this.load(c))),
      new Promise<null>((r) => setTimeout(() => r(null), 4000)),
    ]);
    if (!bufs || bufs.some((b) => !b)) return this.speak(a.text);
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
