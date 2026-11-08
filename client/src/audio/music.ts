// Generative night ambience (original, synthesized live with Web Audio):
// a low drone, wind, slow minor pads, sparse bells and a soft heartbeat.
// Broadband enough to mask taps and whispers around the table.

function impulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function brownNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    d[i] = last * 3.5;
  }
  return buf;
}

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

// A minor: Am(add9) → Fmaj7 → Dm9 → Esus4
const CHORDS = [
  [57, 60, 64, 71],
  [53, 57, 60, 64],
  [50, 53, 57, 64],
  [52, 57, 59, 64],
];
const BELLS = [69, 72, 74, 76, 79, 81, 84];

export class NightMusic {
  private ctx: AudioContext;
  private out: GainNode;
  private dry: GainNode;
  private verb: ConvolverNode;
  private echo: DelayNode;
  private sources: (AudioScheduledSourceNode | null)[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private next = 0;
  private beat = 0;
  private readonly beatLen = 1.25;
  private stopped = false;

  constructor(ctx: AudioContext, dest: AudioNode) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
    this.dry = ctx.createGain();
    this.dry.gain.value = 0.75;
    this.dry.connect(this.out);
    this.verb = ctx.createConvolver();
    this.verb.buffer = impulse(ctx, 4, 2.4);
    const wet = ctx.createGain();
    wet.gain.value = 0.6;
    this.verb.connect(wet).connect(this.out);
    this.echo = ctx.createDelay(1.5);
    this.echo.delayTime.value = 0.47;
    const fb = ctx.createGain();
    fb.gain.value = 0.33;
    this.echo.connect(fb).connect(this.echo);
    this.echo.connect(this.verb);
  }

  start(): void {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    // drone
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 240;
    droneFilter.Q.value = 0.8;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.11;
    droneFilter.connect(droneGain);
    droneGain.connect(this.dry);
    droneGain.connect(this.verb);
    for (const [f, type, det] of [
      [hz(33), 'sawtooth', 0],
      [hz(40), 'sawtooth', 6],
      [hz(45), 'triangle', -4],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(droneFilter);
      o.start(t);
      this.sources.push(o);
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain).connect(droneFilter.frequency);
    lfo.start(t);
    this.sources.push(lfo);
    // wind
    const noise = ctx.createBufferSource();
    noise.buffer = brownNoise(ctx, 6);
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 600;
    band.Q.value = 0.5;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.16;
    noise.connect(band).connect(windGain);
    windGain.connect(this.out);
    windGain.connect(this.verb);
    const wlfo = ctx.createOscillator();
    wlfo.frequency.value = 0.07;
    const wlfoGain = ctx.createGain();
    wlfoGain.gain.value = 380;
    wlfo.connect(wlfoGain).connect(band.frequency);
    const glfo = ctx.createOscillator();
    glfo.frequency.value = 0.11;
    const glfoGain = ctx.createGain();
    glfoGain.gain.value = 0.06;
    glfo.connect(glfoGain).connect(windGain.gain);
    noise.start(t);
    wlfo.start(t);
    glfo.start(t);
    this.sources.push(noise, wlfo, glfo);
    // fade in
    this.out.gain.setValueAtTime(0, t);
    this.out.gain.linearRampToValueAtTime(1, t + 4);
    this.next = t + 0.2;
    this.timer = setInterval(() => this.schedule(), 120);
    this.schedule();
  }

  private schedule(): void {
    if (this.stopped) return;
    const ctx = this.ctx;
    while (this.next < ctx.currentTime + 0.6) {
      const t = this.next;
      const b = this.beat;
      if (b % 8 === 0) this.pad(CHORDS[Math.floor(b / 8) % CHORDS.length], t, this.beatLen * 8 + 1.5);
      if (b % 2 === 0) this.heartbeat(t, b % 16 === 0 ? 1 : 0.7);
      if (Math.random() < 0.3) this.bell(BELLS[Math.floor(Math.random() * BELLS.length)], t + Math.random() * 0.3);
      this.next += this.beatLen;
      this.beat++;
    }
  }

  private pad(notes: number[], t: number, dur: number): void {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    lp.connect(g);
    g.connect(this.dry);
    g.connect(this.verb);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 2.8);
    g.gain.setValueAtTime(0.05, t + dur - 3);
    g.gain.linearRampToValueAtTime(0, t + dur);
    for (const n of notes) {
      for (const [type, det] of [
        ['triangle', -7],
        ['sawtooth', 7],
      ] as const) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = hz(n);
        o.detune.value = det;
        const og = ctx.createGain();
        og.gain.value = type === 'sawtooth' ? 0.35 : 1;
        o.connect(og).connect(lp);
        o.start(t);
        o.stop(t + dur + 0.1);
      }
    }
  }

  private bell(n: number, t: number): void {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.connect(this.echo);
    g.connect(this.verb);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.045, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
    for (const [mult, amp] of [
      [1, 1],
      [2.76, 0.3],
      [5.4, 0.1],
    ]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = hz(n) * mult;
      const og = ctx.createGain();
      og.gain.value = amp;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + 3.1);
    }
  }

  private heartbeat(t: number, amp: number): void {
    const ctx = this.ctx;
    for (const [dt, a] of [
      [0, 1],
      [0.28, 0.6],
    ]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(70, t + dt);
      o.frequency.exponentialRampToValueAtTime(38, t + dt + 0.25);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + dt);
      g.gain.linearRampToValueAtTime(0.22 * amp * a, t + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.35);
      o.connect(g).connect(this.dry);
      o.start(t + dt);
      o.stop(t + dt + 0.4);
    }
  }

  stop(fade = 2.5): void {
    if (this.stopped) return;
    this.stopped = true;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0, t + fade);
    if (this.timer) clearInterval(this.timer);
    setTimeout(
      () => {
        for (const s of this.sources) {
          try {
            s?.stop();
          } catch {
            /* already stopped */
          }
        }
        this.out.disconnect();
      },
      fade * 1000 + 200,
    );
  }
}
