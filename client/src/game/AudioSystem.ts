/**
 * Procedural audio system using Web Audio API.
 * All sounds are generated in real-time — zero file dependencies.
 */

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  private ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  private noise(duration: number, decay: number): AudioBuffer {
    const ctx = this.ensure();
    const len = Math.floor(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * decay));
    }
    return buf;
  }

  // ── RIFLE: Sharp crack with metallic ring ──
  playRifle(): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;

    // Noise crack
    const src = ctx.createBufferSource();
    src.buffer = this.noise(0.1, 0.15);

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200;
    bp.Q.value = 2;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

    src.connect(bp).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + 0.1);

    // Metallic ping
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(4200, t);
    osc.frequency.exponentialRampToValueAtTime(2800, t + 0.06);

    const og = ctx.createGain();
    og.gain.setValueAtTime(0.08, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.06);

    osc.connect(og).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  // ── SHOTGUN: Low boom with wide spread noise ──
  playShotgun(): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;

    // Heavy noise burst
    const src = ctx.createBufferSource();
    src.buffer = this.noise(0.25, 0.12);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.Q.value = 1.5;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

    src.connect(lp).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + 0.25);

    // Sub thump
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(90, t);
    sub.frequency.exponentialRampToValueAtTime(25, t + 0.18);

    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.6, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

    sub.connect(sg).connect(this.master!);
    sub.start(t);
    sub.stop(t + 0.18);

    // High snap (mechanical)
    const snap = ctx.createOscillator();
    snap.type = 'square';
    snap.frequency.value = 3500;
    const snapG = ctx.createGain();
    snapG.gain.setValueAtTime(0.1, t);
    snapG.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
    snap.connect(snapG).connect(this.master!);
    snap.start(t);
    snap.stop(t + 0.02);
  }

  // ── RPG: Whoosh launch + delayed boom ──
  playRPGLaunch(): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;

    // Whoosh
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.35);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;

    osc.connect(lp).connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.35);

    // Hiss
    const src = ctx.createBufferSource();
    src.buffer = this.noise(0.3, 0.25);
    const hg = ctx.createGain();
    hg.gain.setValueAtTime(0.15, t);
    hg.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    src.connect(hg).connect(this.master!);
    src.start(t);
    src.stop(t + 0.3);
  }

  // ── EXPLOSION: Massive boom ──
  playExplosion(): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;

    // Explosion noise
    const src = ctx.createBufferSource();
    src.buffer = this.noise(0.6, 0.18);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1200, t);
    lp.frequency.exponentialRampToValueAtTime(80, t + 0.6);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);

    src.connect(lp).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + 0.6);

    // Deep sub
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(65, t);
    sub.frequency.exponentialRampToValueAtTime(18, t + 0.5);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.8, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    sub.connect(sg).connect(this.master!);
    sub.start(t);
    sub.stop(t + 0.5);

    // Crackle overtone
    const src2 = ctx.createBufferSource();
    src2.buffer = this.noise(0.3, 0.1);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 4000;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.25, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    src2.connect(hp).connect(g2).connect(this.master!);
    src2.start(t);
    src2.stop(t + 0.3);
  }

  // ── BLOCK BREAK: Short crumble ──
  playBlockBreak(): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.noise(0.07, 0.25);

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);

    src.connect(hp).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + 0.07);
  }

  // ── RELOAD: Mechanical click sequence ──
  playReload(): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;

    this.click(t, 1100, 0.035);       // mag release
    this.click(t + 0.25, 800, 0.04);  // mag out
    this.click(t + 0.45, 1400, 0.05); // mag in
    this.click(t + 0.6, 2200, 0.03);  // chamber rack
  }

  private click(time: number, freq: number, dur: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    osc.connect(g).connect(this.master!);
    osc.start(time);
    osc.stop(time + dur);
  }

  // ── EMPTY CLICK ──
  playEmpty(): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 350;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.04);
  }

  // ── HIT MARKER: Satisfying ding ──
  playHitMarker(): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;

    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.setValueAtTime(1100, t);
    o1.frequency.setValueAtTime(1500, t + 0.025);

    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = 1800;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

    o1.connect(g).connect(this.master!);
    o2.connect(g);
    o1.start(t);
    o1.stop(t + 0.1);
    o2.start(t);
    o2.stop(t + 0.1);
  }

  // ── WEAPON SWITCH: Quick slide sound ──
  playSwitch(): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(600, t);
    osc.frequency.exponentialRampToValueAtTime(1200, t + 0.06);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2000;

    osc.connect(lp).connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  // ── DAMAGE TAKEN: Low impact thud ──
  playDamage(): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.noise(0.15, 0.2);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    src.connect(lp).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + 0.15);

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 50;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.4, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    sub.connect(sg).connect(this.master!);
    sub.start(t);
    sub.stop(t + 0.12);
  }

  // ── CRUMBLE: Blocks becoming unstable ──
  playCrumble(): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.noise(0.25, 0.15);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 600;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    src.connect(bp).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + 0.25);
  }

  // ── BLOCK LAND: Falling blocks hit ground ──
  playBlockLand(intensity: number = 0.5): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const vol = 0.15 + intensity * 0.35;

    const src = ctx.createBufferSource();
    src.buffer = this.noise(0.1, 0.2);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    src.connect(lp).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + 0.1);

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 40;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(vol * 0.8, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    sub.connect(sg).connect(this.master!);
    sub.start(t);
    sub.stop(t + 0.08);
  }

  setMasterVolume(volume: number): void {
    if (this.master) {
      this.master.gain.value = Math.max(0, Math.min(1, volume));
    }
  }

  dispose(): void {
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
      this.master = null;
    }
  }
}
