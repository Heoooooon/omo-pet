// The band's song, synthesized with WebAudio — no audio files. An original
// 14-bar tune: intro, verse, chorus, build and a final hit. Notes are MIDI
// numbers; a bar is 8 eighth-note steps.
import { BARS, BEAT } from "./band-shared";

const STEP = BEAT / 2;
const H = "-"; // hold the previous note
const R = "."; // rest
type Step = number | typeof H | typeof R;

const CHORDS: Record<string, number[]> = {
  F: [53, 57, 60],
  G: [55, 59, 62],
  Em: [52, 55, 59],
  Am: [57, 60, 64],
  C: [60, 64, 67],
};
const BAR_CHORDS = ["F", "G", "F", "G", "Em", "Am", "F", "G", "C", "Am", "F", "G", "C", "C"];

const MELODY: Step[][] = [
  [R, R, R, R, R, R, R, R],
  [R, R, R, R, R, R, 67, 69],
  [69, H, 72, H, 74, 72, 69, R],
  [67, H, 71, H, 74, H, H, R],
  [76, H, 74, H, 71, H, 67, R],
  [69, H, H, 72, 71, H, 69, R],
  [72, H, 77, H, 76, H, 72, H],
  [74, H, 79, H, 77, 76, 74, R],
  [76, H, 79, H, 84, H, H, H],
  [83, 81, H, 76, H, 72, H, R],
  [69, 72, 77, H, 76, 72, 77, H],
  [79, H, 77, H, 76, H, 74, H],
  [72, H, H, H, 76, H, 79, H],
  [84, H, H, H, H, H, R, R],
];

export type SongEvent = { t: number; voice: string; notes: number[]; dur: number };

function melodyEvents(): SongEvent[] {
  const out: SongEvent[] = [];
  MELODY.forEach((bar, b) => {
    bar.forEach((n, i) => {
      if (typeof n !== "number") return;
      let len = 1;
      while (bar[i + len] === H) len++;
      out.push({ t: (b * 8 + i) * STEP, voice: "lead", notes: [n], dur: len * STEP * 0.95 });
    });
  });
  return out;
}

export function songEvents(): SongEvent[] {
  const ev: SongEvent[] = melodyEvents();
  for (let b = 0; b < BARS; b++) {
    const chord = CHORDS[BAR_CHORDS[b]];
    const root = chord[0] - 12;
    const bar = b * 8 * STEP;
    const last = b === BARS - 1;
    const chorus = b >= 6 && b <= 9;
    const hit = (t: number, voice: string, notes: number[], dur: number) =>
      ev.push({ t: bar + t * STEP, voice, notes, dur });
    if (last) {
      hit(0, "kick", [], 0.3);
      hit(0, "crash", [], 1.8);
      hit(0, "bass", [root], 1.6);
      hit(0, "keys", chord, 1.8);
      hit(0, "guitar", [root + 12, root + 19, root + 24], 1.8);
      continue;
    }
    for (let i = 0; i < 8; i++) hit(i, "hat", [], 0.05);
    hit(0, "kick", [], 0.3);
    hit(4, "kick", [], 0.3);
    if (chorus) hit(3, "kick", [], 0.3);
    hit(2, "snare", [], 0.2);
    hit(6, "snare", [], 0.2);
    if (b === 2 || b === 6 || b === 10 || b === 12) hit(0, "crash", [], 1.4);
    if (b === 11) {
      hit(6.5, "snare", [], 0.1);
      hit(7, "snare", [], 0.1);
      hit(7.5, "snare", [], 0.1);
    }
    // Bass: pumping eighths, octave jumps in the chorus
    for (let i = 0; i < 8; i++) {
      hit(i, "bass", [chorus && i % 2 ? root + 12 : root], STEP * 0.8);
    }
    // Keys: off-beat stabs, held chord on the penultimate bar
    if (b === 12) hit(0, "keys", chord, 8 * STEP * 0.95);
    else for (const i of [1, 3, 5, 7]) hit(i, "keys", chord, STEP * 0.6);
    // Guitar from the verse on: palm-muted power-chord eighths
    if (b >= 2) {
      const power = [root + 12, root + 19, root + 24];
      if (b === 12) hit(0, "guitar", power, 8 * STEP);
      else for (let i = 0; i < 8; i++) hit(i, "guitar", power, chorus ? STEP * 0.9 : STEP * 0.45);
    }
  }
  return ev.sort((a, b) => a.t - b.t);
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

export class BandSynth {
  readonly ctx: BaseAudioContext;
  private master: GainNode;
  private noise: AudioBuffer;
  private drive: WaveShaperNode;
  private scheduled = false;

  // An OfflineAudioContext renders the song without speakers (checks, export).
  constructor(ctx: BaseAudioContext = new AudioContext()) {
    this.ctx = ctx;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(comp).connect(this.ctx.destination);
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.drive = this.ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(3 * x);
    }
    this.drive.curve = curve;
    const guitarTone = this.ctx.createBiquadFilter();
    guitarTone.type = "lowpass";
    guitarTone.frequency.value = 2600;
    const guitarGain = this.ctx.createGain();
    guitarGain.gain.value = 0.16;
    this.drive.connect(guitarTone).connect(guitarGain).connect(this.master);
  }

  setVolume(volume: number) {
    this.master.gain.setTargetAtTime(volume * 0.55, this.ctx.currentTime, 0.05);
  }

  // Schedule the whole song so that its t=0 lands on epoch time `t0`;
  // notes already in the past are skipped (sound turned on mid-song).
  play(t0: number) {
    if (this.scheduled) return;
    this.scheduled = true;
    const start = this.ctx.currentTime + (t0 - Date.now()) / 1000;
    const earliest = this.ctx.currentTime + 0.03;
    for (const e of songEvents()) {
      const at = start + e.t;
      if (at < earliest) continue;
      this.voice(e, at);
    }
  }

  close() {
    if (this.ctx instanceof AudioContext) void this.ctx.close();
  }

  private env(at: number, peak: number, attack: number, dur: number, release: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.setValueAtTime(peak, at + Math.max(attack, dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur + release);
    return g;
  }

  private noiseHit(at: number, type: BiquadFilterType, freq: number, peak: number, decay: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    src.connect(f).connect(g).connect(this.master);
    src.start(at);
    src.stop(at + decay + 0.05);
  }

  private tone(at: number, type: OscillatorType, freq: number, dest: AudioNode, dur: number, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    o.connect(dest);
    o.start(at);
    o.stop(at + dur + 0.3);
    return o;
  }

  private voice(e: SongEvent, at: number) {
    const ctx = this.ctx;
    switch (e.voice) {
      case "kick": {
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(150, at);
        o.frequency.exponentialRampToValueAtTime(42, at + 0.12);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.9, at);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
        o.connect(g).connect(this.master);
        o.start(at);
        o.stop(at + 0.3);
        break;
      }
      case "snare": {
        this.noiseHit(at, "highpass", 1400, 0.45, 0.16);
        const g = this.env(at, 0.25, 0.002, 0.02, 0.06);
        this.tone(at, "triangle", 190, g, 0.1);
        g.connect(this.master);
        break;
      }
      case "hat":
        this.noiseHit(at, "highpass", 7500, 0.12, 0.045);
        break;
      case "crash":
        this.noiseHit(at, "highpass", 4200, 0.22, e.dur);
        break;
      case "bass": {
        const f = ctx.createBiquadFilter();
        f.type = "lowpass";
        f.Q.value = 5;
        f.frequency.setValueAtTime(900, at);
        f.frequency.exponentialRampToValueAtTime(220, at + e.dur);
        const g = this.env(at, 0.32, 0.005, e.dur, 0.04);
        this.tone(at, "sawtooth", hz(e.notes[0]), f, e.dur);
        f.connect(g).connect(this.master);
        break;
      }
      case "guitar": {
        const g = this.env(at, 0.5, 0.004, e.dur, 0.05);
        for (const n of e.notes) {
          this.tone(at, "sawtooth", hz(n), g, e.dur, -6);
          this.tone(at, "sawtooth", hz(n), g, e.dur, 6);
        }
        g.connect(this.drive);
        break;
      }
      case "keys": {
        const g = this.env(at, 0.07, 0.004, e.dur, 0.08);
        for (const n of e.notes) {
          this.tone(at, "triangle", hz(n + 12), g, e.dur);
          this.tone(at, "sine", hz(n + 24), g, e.dur);
        }
        g.connect(this.master);
        break;
      }
      case "lead": {
        const f = ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = 2400;
        const g = this.env(at, 0.16, 0.025, e.dur, 0.08);
        const freq = hz(e.notes[0]);
        const a = this.tone(at, "triangle", freq, f, e.dur);
        const b = this.tone(at, "square", freq, f, e.dur, 4);
        const bGain = ctx.createGain();
        bGain.gain.value = 0.25;
        b.disconnect();
        b.connect(bGain).connect(f);
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 5.5;
        const depth = ctx.createGain();
        depth.gain.setValueAtTime(0, at);
        depth.gain.linearRampToValueAtTime(freq * 0.006, at + 0.18);
        lfo.connect(depth);
        depth.connect(a.frequency);
        depth.connect(b.frequency);
        lfo.start(at);
        lfo.stop(at + e.dur + 0.3);
        f.connect(g).connect(this.master);
        break;
      }
    }
  }
}
