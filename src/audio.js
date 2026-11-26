// 程序化音频:原创八音盒旋律 + 铺底 + 风声 + 心跳 + 风铃 + 烟花爆裂。无需任何外部音频文件。
const BPM = 66;
const STEP = 60 / BPM / 2; // 八分音符

// 8 小节循环(每小节 8 个八分音符):分解和弦 + 稀疏主旋律(MIDI 音高,null 为休止)
const BARS = [
  { arp: [48, 55, 60, 64, 67, 64, 60, 55], mel: [76, null, 79, null, 76, null, 72, null], pad: [48, 55, 64] },
  { arp: [43, 50, 55, 59, 62, 59, 55, 50], mel: [74, null, 79, null, 83, null, 79, null], pad: [43, 50, 59] },
  { arp: [45, 52, 57, 60, 64, 60, 57, 52], mel: [76, null, 72, null, 69, null, 72, null], pad: [45, 52, 60] },
  { arp: [41, 48, 53, 57, 60, 57, 53, 48], mel: [72, null, 77, null, 76, null, 72, null], pad: [41, 48, 57] },
  { arp: [48, 55, 60, 64, 67, 64, 60, 55], mel: [79, null, 76, null, 72, null, 76, null], pad: [48, 55, 64] },
  { arp: [43, 50, 55, 59, 62, 59, 55, 50], mel: [83, null, 79, null, 74, null, 79, null], pad: [43, 50, 59] },
  { arp: [41, 48, 53, 57, 60, 57, 53, 48], mel: [77, null, 76, null, 72, null, 69, null], pad: [41, 48, 57] },
  { arp: [43, 50, 55, 59, 62, 59, 55, 50], mel: [74, null, 71, null, 74, null, 67, null], pad: [43, 50, 59] },
];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.timer = null;
    this.level = 0.7; // 旋律强度 0..1
    this.running = false;
  }

  init() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    const len = Math.floor(ctx.sampleRate * 3.4);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.7);
    }
    const rev = ctx.createConvolver();
    rev.buffer = ir;
    const revGain = ctx.createGain();
    revGain.gain.value = 0.6;
    rev.connect(revGain);
    revGain.connect(this.master);
    const dry = ctx.createGain();
    dry.gain.value = 0.75;
    dry.connect(this.master);
    this.bus = ctx.createGain();
    this.bus.connect(dry);
    this.bus.connect(rev);

    // 风声
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;
    const wind = ctx.createBufferSource();
    wind.buffer = nb;
    wind.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 0.5;
    const wg = ctx.createGain();
    wg.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.12;
    const lg = ctx.createGain();
    lg.gain.value = 0.025;
    lfo.connect(lg);
    lg.connect(wg.gain);
    wind.connect(bp);
    bp.connect(wg);
    wg.connect(this.master);
    wind.start();
    lfo.start();
    return true;
  }

  restartMusic() {
    if (!this.ctx) return;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.15;
  }

  start() {
    if (!this.init()) return;
    this.running = true;
    this.ctx.resume();
    if (this.nextTime === undefined) this.restartMusic();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.schedule(), 50);
  }

  pause() { this.ctx && this.ctx.suspend(); }
  resume() { this.ctx && this.running && this.ctx.resume(); }

  setMuted(m) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  fadeOut(sec = 4) {
    if (!this.ctx) return;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, sec / 3);
  }
  fadeIn() {
    if (!this.ctx) return;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.2);
  }

  schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    while (this.nextTime < ctx.currentTime + 0.3) {
      const i = this.step % 8, bar = BARS[Math.floor(this.step / 8) % BARS.length];
      const t = this.nextTime;
      this.bell(bar.arp[i], t, 1.5, 0.05 + (i % 2 === 0 ? 0.012 : 0));
      if (bar.mel[i] != null) this.bell(bar.mel[i], t, 2.6, 0.075 * (0.6 + this.level * 0.8));
      if (i === 0) for (const p of bar.pad) this.pad(p, t, STEP * 8);
      this.nextTime += STEP;
      this.step++;
    }
  }

  // 八音盒音色:基频 + 倍频 + 快衰减的非谐泛音
  bell(m, when, dur, vel) {
    const ctx = this.ctx, f = mtof(m);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vel, when + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0006, when + dur);
    g.connect(this.bus);
    for (const [mul, amp, d] of [[1, 1, dur], [2, 0.28, dur * 0.6], [4.17, 0.1, dur * 0.18]]) {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f * mul;
      og.gain.setValueAtTime(amp, when);
      og.gain.exponentialRampToValueAtTime(0.001, when + d);
      o.connect(og);
      og.connect(g);
      o.start(when);
      o.stop(when + dur + 0.05);
    }
  }

  pad(m, when, dur) {
    const ctx = this.ctx, f = mtof(m);
    const g = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.016 * (0.5 + this.level), when + 0.9);
    g.gain.setValueAtTime(0.016 * (0.5 + this.level), when + dur - 0.2);
    g.gain.linearRampToValueAtTime(0, when + dur + 1.1);
    lp.connect(g);
    g.connect(this.bus);
    for (const det of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(lp);
      o.start(when);
      o.stop(when + dur + 1.2);
    }
  }

  // 心跳:bpm 速度,beats 次,vol 音量
  heartbeat(bpm = 96, beats = 6, vol = 0.5) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime + 0.05, gap = 60 / bpm;
    for (let i = 0; i < beats; i++) {
      for (const [dt, f0, f1, v] of [[0, 78, 42, 1], [gap * 0.3, 92, 50, 0.65]]) {
        const when = t0 + i * gap + dt, o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(f0, when);
        o.frequency.exponentialRampToValueAtTime(f1, when + 0.13);
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(vol * v, when + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, when + 0.2);
        o.connect(g);
        g.connect(this.master);
        o.start(when);
        o.stop(when + 0.25);
      }
    }
  }

  chime(notes = [84, 88, 91, 96], gap = 0.09, vol = 0.08) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + 0.03;
    notes.forEach((n, i) => this.bell(n, t0 + i * gap, 2.8, vol));
  }

  // 烟花爆裂:低频冲击 + 噪声噼啪
  pop(vol = 0.22) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.02;
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(34, t + 0.35);
    og.gain.setValueAtTime(vol, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(og);
    og.connect(this.master);
    o.start(t);
    o.stop(t + 0.55);
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const hp = ctx.createBiquadFilter(), ng = ctx.createGain();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    ng.gain.setValueAtTime(vol * 0.9, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    n.connect(hp);
    hp.connect(ng);
    ng.connect(this.bus);
    n.start(t, Math.random());
    n.stop(t + 1);
  }
}
