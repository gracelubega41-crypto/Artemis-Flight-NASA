function buildSpaceMusicWavUrl(): string {
  const sampleRate = 22050;
  const durationSec = 16;
  const totalSamples = sampleRate * durationSec;
  const pcm = new Float32Array(totalSamples);

  // 4 warm cosmic chords (4s each) voiced in phone-speaker-friendly range
  const chords = [
    [130.81, 261.63, 329.63, 392.0, 587.33], // Cmaj9
    [110.0, 220.0, 261.63, 329.63, 493.88], // Am9
    [174.61, 220.0, 261.63, 329.63, 523.25], // Fmaj7
    [196.0, 246.94, 293.66, 329.63, 587.33], // G6
  ];

  // Twinkling cosmic starlight chimes every 2 seconds
  const chimes = [
    { t: 0.5, f: 659.25 },
    { t: 2.5, f: 783.99 },
    { t: 4.5, f: 1046.5 },
    { t: 6.5, f: 987.77 },
    { t: 8.5, f: 880.0 },
    { t: 10.5, f: 659.25 },
    { t: 12.5, f: 783.99 },
    { t: 14.5, f: 1174.66 },
  ];

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const chordIdx = Math.min(3, Math.floor(t / 4));
    const localT = t - chordIdx * 4;
    // Smooth 0.7s fade-in and fade-out inside each 4s chord bar so transitions never click
    const chordEnv =
      Math.min(1, localT / 0.7) * Math.min(1, (4 - localT) / 0.7) * 0.85 + 0.15;
    const chord = chords[chordIdx];

    let pad = 0;
    for (let c = 0; c < chord.length; c++) {
      const freq = chord[c];
      const weight = c === 0 ? 0.24 : 0.17;
      // Gentle slow detuned shimmer
      pad += Math.sin(2 * Math.PI * freq * t) * weight;
      pad += Math.sin(2 * Math.PI * (freq * 1.003) * t) * (weight * 0.45);
    }

    let bell = 0;
    for (let m = 0; m < chimes.length; m++) {
      const dt = t - chimes[m].t;
      if (dt >= 0 && dt < 2.2) {
        const atk = Math.min(1, dt / 0.04);
        const dec = Math.exp(-dt * 2.1);
        bell += Math.sin(2 * Math.PI * chimes[m].f * dt) * atk * dec * 0.22;
      }
    }

    // Seamless 0.25s boundary envelope at 0s and 16s
    const loopEdge = Math.min(1, t / 0.25) * Math.min(1, (durationSec - t) / 0.25);
    const lfo = 0.86 + 0.14 * Math.sin(2 * Math.PI * 0.25 * t);
    pcm[i] = Math.max(-0.95, Math.min(0.95, (pad * chordEnv * lfo + bell) * loopEdge * 0.55));
  }

  // Encode 16-bit PCM WAV header + samples
  const dataSize = totalSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < totalSamples; i++) {
    view.setInt16(offset, Math.round(pcm[i] * 32767), true);
    offset += 2;
  }

  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

class TelemetryAudioEngine {
  private ctx: AudioContext | null = null;
  private muted = false;
  private musicEnabled = true;
  private musicAudio: HTMLAudioElement | null = null;
  private musicUrl: string | null = null;
  private speechDucked = false;
  private currentVol = 0.22;
  private duckTimer: number | null = null;
  private unlockBound = false;
  private lastThrusterAt = 0;
  private lastLaunchPulseAt = 0;

  constructor() {
    this.bindGestureUnlock();
  }

  private bindGestureUnlock() {
    if (this.unlockBound || typeof window === 'undefined') return;
    this.unlockBound = true;
    const onGesture = () => {
      this.unlockAndStartMusic();
    };
    window.addEventListener('pointerdown', onGesture, { passive: true, capture: true });
    window.addEventListener('touchstart', onGesture, { passive: true, capture: true });
    window.addEventListener('touchend', onGesture, { passive: true, capture: true });
    window.addEventListener('click', onGesture, { passive: true, capture: true });
    window.addEventListener('keydown', onGesture, { passive: true, capture: true });
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private ensureMusicAudio(): HTMLAudioElement | null {
    if (typeof window === 'undefined') return null;
    if (!this.musicAudio) {
      if (!this.musicUrl) {
        this.musicUrl = buildSpaceMusicWavUrl();
      }
      const audio = new Audio(this.musicUrl);
      audio.loop = true;
      audio.preload = 'auto';
      audio.volume = this.getTargetMusicVolume();
      this.musicAudio = audio;
    }
    return this.musicAudio;
  }

  private getTargetMusicVolume(): number {
    if (this.muted || !this.musicEnabled) return 0;
    // Always gentler/lower than the spoken voices, softly ducking lower when Maya/Leo/Sam speak
    return this.speechDucked ? 0.085 : 0.22;
  }

  private syncMusicVolume() {
    const audio = this.musicAudio;
    if (!audio) return;
    const target = this.getTargetMusicVolume();
    if (this.duckTimer !== null) {
      window.clearInterval(this.duckTimer);
      this.duckTimer = null;
    }
    this.duckTimer = window.setInterval(() => {
      const diff = target - this.currentVol;
      if (Math.abs(diff) < 0.008) {
        this.currentVol = target;
        audio.volume = target;
        if (target === 0 && !audio.paused) {
          audio.pause();
        }
        if (this.duckTimer !== null) {
          window.clearInterval(this.duckTimer);
          this.duckTimer = null;
        }
        return;
      }
      this.currentVol += diff * 0.28;
      audio.volume = Math.max(0, Math.min(1, this.currentVol));
    }, 40);
  }

  public unlockAndStartMusic() {
    this.ensureContext();
    if (this.musicEnabled && !this.muted) {
      this.startSpaceMusic();
    }
  }

  public setSpeechDucking(active: boolean) {
    this.speechDucked = active;
    this.syncMusicVolume();
  }

  public setMusicEnabled(enabled: boolean) {
    this.musicEnabled = enabled;
    if (enabled && !this.muted) {
      this.startSpaceMusic();
    } else {
      this.syncMusicVolume();
    }
  }

  public isMusicEnabled(): boolean {
    return this.musicEnabled;
  }

  public startSpaceMusic() {
    if (typeof window === 'undefined' || !this.musicEnabled || this.muted) return;
    const audio = this.ensureMusicAudio();
    if (!audio) return;

    this.currentVol = this.getTargetMusicVolume();
    audio.volume = this.currentVol;

    if (audio.paused) {
      audio.play().catch(() => {
        // Mobile browsers allow playback as soon as the user touches anywhere; bound gesture unlock handles it
      });
    }
  }

  public stopSpaceMusic() {
    if (this.musicAudio && !this.musicAudio.paused) {
      this.musicAudio.pause();
    }
  }

  public setMuted(m: boolean) {
    this.muted = m;
    this.syncMusicVolume();
    if (!m && this.musicEnabled) {
      this.startSpaceMusic();
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public playThrusterPulse() {
    if (this.muted) return;
    const nowMs = performance.now();
    if (nowMs - this.lastThrusterAt < 110) return;
    this.lastThrusterAt = nowMs;

    const ctx = this.ensureContext();
    if (!ctx) return;

    const bufferSize = Math.floor(ctx.sampleRate * 0.06);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.4));
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1100;
    filter.Q.value = 1.4;

    const gain = ctx.createGain();
    gain.gain.value = 0.04;

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start();
  }

  public playShuttleLaunchRumble(durationSec = 1.6) {
    if (this.muted) return;
    const nowMs = performance.now();
    if (nowMs - this.lastLaunchPulseAt < 500) return;
    this.lastLaunchPulseAt = nowMs;

    const ctx = this.ensureContext();
    if (!ctx) return;

    const bufferSize = Math.floor(ctx.sampleRate * durationSec);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const env = Math.sin((i / bufferSize) * Math.PI);
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(190, ctx.currentTime);
    filter.frequency.linearRampToValueAtTime(340, ctx.currentTime + durationSec * 0.6);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.01, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.09, ctx.currentTime + 0.25);
    gain.gain.exponentialRampToValueAtTime(0.004, ctx.currentTime + durationSec);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start();
  }

  public playAlertTone(severity: 'caution' | 'critical') {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = severity === 'critical' ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(severity === 'critical' ? 880 : 520, ctx.currentTime);
    if (severity === 'critical') {
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.12);
    }

    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.26);
  }

  public playCaptureChime() {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const start = ctx.currentTime + idx * 0.08;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.06, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    });
  }
}

export const telemetryAudio = new TelemetryAudioEngine();
