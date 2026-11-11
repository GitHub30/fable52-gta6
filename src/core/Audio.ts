export type SirenKind = 'police' | 'ambulance' | 'firetruck' | 'mcv';
const SIREN_FILES: Record<SirenKind, string> = { police: 'police.m4a', ambulance: 'ambulance.m4a', firetruck: 'fire-engine.m4a', mcv: 'mcv.m4a' };
const SIREN_KINDS = Object.keys(SIREN_FILES) as SirenKind[];
interface Siren {
  buf: AudioBuffer | null;
  gain: GainNode;
  src: AudioBufferSourceNode | null;
}

/** WebAudio: procedural engine, rain, SFX and synth radio, plus recorded siren loops from public/sirens. */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineOsc!: OscillatorNode;
  private engineOsc2!: OscillatorNode;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private sirens = {} as Record<SirenKind, Siren>;
  private rainGain!: GainNode;
  private noiseBuf!: AudioBuffer;
  private radioGain!: GainNode;
  radioOn = false;
  private radioNext = 0;
  private radioStep = 0;
  muted = false;
  private music: HTMLAudioElement | null = null;
  private musicGain!: GainNode;
  private musicOn = false;

  /** Must be called from a user gesture. Safe to call repeatedly. */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const ctx = (this.ctx = new AudioContext());
      this.master = ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(ctx.destination);

      this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

      this.engineFilter = ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 400;
      this.engineGain = ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineOsc = ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc2 = ctx.createOscillator();
      this.engineOsc2.type = 'square';
      this.engineOsc.connect(this.engineFilter);
      this.engineOsc2.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain).connect(this.master);
      this.engineOsc.start();
      this.engineOsc2.start();

      for (const kind of SIREN_KINDS) {
        const gain = ctx.createGain();
        gain.gain.value = 0;
        gain.connect(this.master);
        const siren: Siren = (this.sirens[kind] = { buf: null, gain, src: null });
        // a missing or undecodable file just leaves that siren silent
        fetch(new URL('sirens/' + SIREN_FILES[kind], document.baseURI).href)
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText))))
          .then((data) => ctx.decodeAudioData(data))
          .then((buf) => (siren.buf = buf))
          .catch(() => {});
      }

      const rain = ctx.createBufferSource();
      rain.buffer = this.noiseBuf;
      rain.loop = true;
      const rf = ctx.createBiquadFilter();
      rf.type = 'highpass';
      rf.frequency.value = 1800;
      this.rainGain = ctx.createGain();
      this.rainGain.gain.value = 0;
      rain.connect(rf).connect(this.rainGain).connect(this.master);
      rain.start();

      this.radioGain = ctx.createGain();
      this.radioGain.gain.value = 0;
      this.radioGain.connect(this.master);
      this.musicGain = ctx.createGain();
      this.musicGain.gain.value = 0;
      this.musicGain.connect(this.master);
    } catch {
      this.ctx = null; // audio unavailable: the game stays silent but playable
    }
  }

  setPaused(paused: boolean) {
    if (!this.ctx) return;
    if (paused) this.ctx.suspend().catch(() => {});
    else this.ctx.resume().catch(() => {});
    if (this.music && this.musicOn) {
      if (paused) this.music.pause();
      else this.music.play().catch(() => {});
    }
  }

  /** Cabin music of the airliner (public/music/vietjet.m4a): starts from the top on boarding, fades out on leaving. */
  setCabinMusic(on: boolean) {
    const ctx = this.ctx;
    if (!ctx || on === this.musicOn) return;
    this.musicOn = on;
    this.musicGain.gain.setTargetAtTime(on ? 1.6 : 0, ctx.currentTime, on ? 0.05 : 0.25);
    if (on) {
      if (!this.music) {
        // streamed rather than decoded: the track is several minutes long
        this.music = new Audio(new URL('music/vietjet.m4a', document.baseURI).href);
        this.music.loop = true;
        ctx.createMediaElementSource(this.music).connect(this.musicGain);
      }
      this.music.currentTime = 0;
      this.music.play().catch(() => {}); // a missing file just leaves the cabin silent
    } else {
      const el = this.music;
      setTimeout(() => !this.musicOn && el?.pause(), 900);
    }
  }

  /** Per-frame continuous sounds. */
  update(inCar: boolean, speed: number, throttle: number, sirenLevel: Record<SirenKind, number>, rain: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const f = 48 + Math.abs(speed) * 3.2 + Math.abs(throttle) * 14;
    this.engineOsc.frequency.setTargetAtTime(f, t, 0.06);
    this.engineOsc2.frequency.setTargetAtTime(f * 0.5, t, 0.06);
    this.engineFilter.frequency.setTargetAtTime(300 + Math.abs(speed) * 22, t, 0.1);
    this.engineGain.gain.setTargetAtTime(inCar ? (0.1 + Math.abs(throttle) * 0.05) * (this.musicOn ? 0.45 : 1) : 0, t, 0.1);

    // sirens: each loop starts from its beginning when it becomes audible and stops once faded out
    for (const kind of SIREN_KINDS) {
      const sn = this.sirens[kind], level = sirenLevel[kind];
      sn.gain.gain.setTargetAtTime(level * 0.6, t, 0.15);
      if (level > 0 && !sn.src && sn.buf) {
        sn.src = ctx.createBufferSource();
        sn.src.buffer = sn.buf;
        sn.src.loop = true;
        sn.src.connect(sn.gain);
        sn.src.start();
      } else if (level <= 0 && sn.src && sn.gain.gain.value < 0.004) {
        sn.src.stop();
        sn.src.disconnect();
        sn.src = null;
      }
    }
    this.rainGain.gain.setTargetAtTime(rain * 0.11, t, 0.5);

    // radio: only audible while driving
    this.radioGain.gain.setTargetAtTime(this.radioOn && inCar ? 0.5 : 0, t, 0.2);
    if (this.radioOn && inCar) this.scheduleRadio(t);
  }

  // A minor / F / C / G synth loop, scheduled slightly ahead of the audio clock.
  private scheduleRadio(now: number) {
    const ctx = this.ctx!;
    const step = 0.14;
    if (this.radioNext < now) this.radioNext = now + 0.05;
    const roots = [220, 174.61, 130.81, 196];
    const arp = [1, 1.5, 2, 1.5, 2.4, 2, 1.5, 2];
    while (this.radioNext < now + 0.3) {
      const bar = Math.floor(this.radioStep / 16) % 4, s = this.radioStep % 16;
      const root = roots[bar];
      this.tone(root * arp[s % 8] * (bar === 2 ? 2 : 1), this.radioNext, 0.12, 'triangle', 0.09, this.radioGain);
      if (s % 4 === 0) this.tone(root / 2, this.radioNext, 0.3, 'sawtooth', 0.11, this.radioGain);
      if (s % 8 === 4) this.noise(this.radioNext, 0.07, 0.08, 3000, 'highpass', this.radioGain);
      if (s % 8 === 0) this.tone(70, this.radioNext, 0.12, 'sine', 0.3, this.radioGain, 35);
      this.radioNext += step;
      this.radioStep++;
    }
  }

  private tone(freq: number, at: number, dur: number, type: OscillatorType, vol: number, dest?: AudioNode, endFreq?: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, at + dur);
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    o.connect(g).connect(dest ?? this.master);
    o.start(at);
    o.stop(at + dur + 0.02);
  }
  private noise(at: number, dur: number, vol: number, freq: number, type: BiquadFilterType, dest?: AudioNode) {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    src.connect(f).connect(g).connect(dest ?? this.master);
    src.start(at, Math.random());
    src.stop(at + dur + 0.02);
  }
  private get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  blip(freq: number, dur = 0.12, type: OscillatorType = 'sine') {
    this.tone(freq, this.now, dur, type, 0.12);
  }
  step() {
    this.noise(this.now, 0.05, 0.05, 900, 'lowpass');
  }
  jump() {
    this.tone(180, this.now, 0.12, 'sine', 0.06, undefined, 320);
  }
  punch() {
    this.noise(this.now, 0.09, 0.25, 500, 'lowpass');
    this.tone(120, this.now, 0.08, 'sine', 0.2, undefined, 50);
  }
  crash(impact: number, dist = 0) {
    const v = Math.min(0.5, impact * 0.03) * Math.max(0, 1 - dist / 90);
    if (v < 0.01) return;
    this.noise(this.now, 0.3, v, 700 + impact * 30, 'lowpass');
    this.tone(90, this.now, 0.2, 'sine', v, undefined, 40);
  }
  horn(dist = 0) {
    const v = 0.1 * Math.max(0, 1 - dist / 70);
    if (v < 0.005) return;
    this.tone(415, this.now, 0.32, 'square', v * 0.6);
    this.tone(523, this.now, 0.32, 'square', v * 0.6);
  }
  shot(dist = 0) {
    const v = 0.3 * Math.max(0, 1 - dist / 120);
    if (v < 0.01) return;
    this.noise(this.now, 0.14, v, 1400, 'bandpass');
    this.tone(160, this.now, 0.1, 'square', v * 0.5, undefined, 45);
  }
  boom(dist = 0) {
    const v = 0.7 * Math.max(0, 1 - dist / 260);
    if (v < 0.01) return;
    this.noise(this.now, 1.0, v, 420, 'lowpass');
    this.tone(70, this.now, 0.7, 'sine', v, undefined, 24);
  }
  /** Main gun of the 16式: sharp crack over a long low thump. */
  cannon(dist = 0) {
    const v = 0.8 * Math.max(0, 1 - dist / 320);
    if (v < 0.01) return;
    this.noise(this.now, 0.25, v, 2200, 'bandpass');
    this.noise(this.now, 0.9, v, 500, 'lowpass');
    this.tone(110, this.now, 0.6, 'sine', v, undefined, 28);
  }
  rocket() {
    this.noise(this.now, 0.55, 0.22, 1800, 'highpass');
    this.tone(220, this.now, 0.4, 'sawtooth', 0.08, undefined, 90);
  }
  door() {
    this.noise(this.now, 0.08, 0.14, 300, 'lowpass');
  }
  cash() {
    this.tone(988, this.now, 0.09, 'square', 0.07);
    this.tone(1319, this.now + 0.08, 0.2, 'square', 0.07);
  }
  checkpoint() {
    this.tone(660, this.now, 0.1, 'triangle', 0.14);
    this.tone(880, this.now + 0.09, 0.16, 'triangle', 0.14);
  }
  success() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, this.now + i * 0.13, 0.3, 'triangle', 0.16));
  }
  fail() {
    [392, 330, 262, 196].forEach((f, i) => this.tone(f, this.now + i * 0.17, 0.35, 'sawtooth', 0.1));
  }
}
