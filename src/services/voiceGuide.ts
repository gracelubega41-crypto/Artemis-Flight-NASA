import { telemetryAudio } from './telemetryAudio';

export type VoiceSpeaker = 'maya' | 'leo' | 'sam' | 'coach';
export type CoachVoiceMode = 'maya' | 'leo' | 'sam' | 'duo';

export interface LipSyncState {
  speaker: 'maya' | 'leo' | 'sam' | null;
  openness: number;
  spread: number;
}

interface WordSpan {
  startMs: number;
  endMs: number;
  vowelWeight: number;
}

const FEMALE_HINT =
  /samantha|victoria|karen|tessa|fiona|moira|aria|jenny|zira|hazel|susan|libby|sonia|natasha|ava|emma|olivia|claire|female|woman|google us english|en-us-x-sfg|en-us-x-iom|en-gb-x-gba|en-gb-x-fis/i;
const MALE_HINT =
  /david|mark|daniel|guy|ryan|alex|fred|oliver|george|arthur|thomas|james|william|andrew|brian|christopher|eric|roger|steffan|male|man|google uk english male|en-us-x-tpd|en-us-x-iol|en-gb-x-gbd|en-gb-x-rjs/i;

// Cleanly normalize text for natural spoken cadence without markdown artifacts
function sanitizeSpeechText(raw: string): string {
  return raw
    .replace(/[*_`#>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Break longer answers into crisp <=125-char sentences so mobile & Chrome speech engines never break up or stall after 15s
function splitSpeechChunks(text: string, maxLen = 125): string[] {
  const clean = sanitizeSpeechText(text);
  if (!clean) return [];

  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= maxLen) {
      chunks.push(sentence);
      continue;
    }
    const clauses = sentence
      .split(/(?<=[,;:])\s+/)
      .map((c) => c.trim())
      .filter(Boolean);
    let current = '';
    for (const clause of clauses) {
      if (current && `${current} ${clause}`.length > maxLen) {
        chunks.push(current);
        current = clause;
      } else {
        current = current ? `${current} ${clause}` : clause;
      }
    }
    if (current) {
      if (current.length <= maxLen) {
        chunks.push(current);
      } else {
        // Word wrap very long unpunctuated clauses safely
        const words = current.split(/\s+/);
        let buf = '';
        for (const w of words) {
          if (buf && `${buf} ${w}`.length > maxLen) {
            chunks.push(buf);
            buf = w;
          } else {
            buf = buf ? `${buf} ${w}` : w;
          }
        }
        if (buf) chunks.push(buf);
      }
    }
  }
  return chunks;
}

function buildWordTimeline(text: string, rate: number): WordSpan[] {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const spans: WordSpan[] = [];
  let cursorMs = 50;
  const msPerChar = 62 / Math.max(0.65, rate);

  for (const raw of tokens) {
    const clean = raw.replace(/[^a-zA-Z0-9]/g, '');
    const durMs = Math.max(135, clean.length * msPerChar + 70);
    const vowelCount = (clean.match(/[aeiouy]/gi) || []).length;
    const vowelWeight = Math.min(1, 0.55 + (vowelCount / Math.max(1, clean.length)) * 0.75);
    spans.push({
      startMs: cursorMs,
      endMs: cursorMs + durMs,
      vowelWeight,
    });
    const pauseMs = /[.!?]$/.test(raw) ? 240 : /[,;:]$/.test(raw) ? 140 : 48;
    cursorMs += durMs + pauseMs;
  }
  return spans;
}

class VoiceGuideEngine {
  private enabled = true;
  private coachVoiceMode: CoachVoiceMode = 'duo';
  private duoToggle = false;
  private lastSpokenAt = 0;
  private lastMessage = '';
  private speaking = false;
  private activeSpeaker: 'maya' | 'leo' | 'sam' | null = null;
  private voices: SpeechSynthesisVoice[] = [];
  private watchdogTimer: number | null = null;
  private startDelayTimer: number | null = null;
  private activeToken = 0;
  private activeObjectUrl: string | null = null;
  private persistentAudio: HTMLAudioElement | null = null;
  private analyserAttached = false;
  private neuralCooldownUntil = 0;
  private clientTtsCache = new Map<string, string>();
  private speechPrimed = false;

  // Guard so background chatter never interrupts open AI Coach conversations
  private coachPanelActive = false;
  private coachReplyUntil = 0;

  // Real-time lip-sync state
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private freqBins: Uint8Array<ArrayBuffer> | null = null;
  private smoothedRms = 0;
  private speechStartedAt = 0;
  private lastBoundaryAt = 0;
  private lastBoundaryDurMs = 210;
  private boundaryObserved = false;
  private wordSpans: WordSpan[] = [];

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.refreshVoices();
      window.speechSynthesis.addEventListener?.('voiceschanged', () => {
        this.refreshVoices();
      });
    }
  }

  private refreshVoices() {
    if (!this.isSupported()) return;
    const all = window.speechSynthesis.getVoices();
    const en = all.filter((v) => /^en/i.test(v.lang));
    this.voices = en.length > 0 ? en : all;
  }

  public isSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public isSpeaking(): boolean {
    return this.speaking || (this.isSupported() && window.speechSynthesis.speaking);
  }

  public setCoachPanelActive(active: boolean) {
    this.coachPanelActive = active;
    if (!active) {
      this.coachReplyUntil = Math.min(this.coachReplyUntil, performance.now() + 1200);
    }
  }

  public isCoachBusy(): boolean {
    return this.coachPanelActive || performance.now() < this.coachReplyUntil;
  }

  public setEnabled(next: boolean) {
    this.enabled = next;
    if (!next) {
      this.stop();
    }
  }

  public getCoachVoiceMode(): CoachVoiceMode {
    return this.coachVoiceMode;
  }

  public setCoachVoiceMode(mode: CoachVoiceMode) {
    this.coachVoiceMode = mode;
  }

  public resolveCoachSpeaker(): 'maya' | 'leo' | 'sam' {
    if (this.coachVoiceMode === 'duo') {
      this.duoToggle = !this.duoToggle;
      return this.duoToggle ? 'maya' : 'leo';
    }
    return this.coachVoiceMode;
  }

  public getAvailableGenderCount(): { female: number; male: number } {
    if (this.voices.length === 0) this.refreshVoices();
    const female = this.voices.filter((v) => FEMALE_HINT.test(v.name) && !/\bmale\b/i.test(v.name)).length;
    const male = this.voices.filter((v) => MALE_HINT.test(v.name) && !/female/i.test(v.name)).length;
    return { female, male };
  }

  // Must be called synchronously inside a user tap/submit so mobile Safari & Android Chrome allow later async audio/TTS
  public primeSpeech() {
    if (typeof window === 'undefined') return;
    telemetryAudio.unlockAndStartMusic();

    if (!this.persistentAudio) {
      const el = new Audio();
      el.setAttribute('playsinline', 'true');
      el.preload = 'auto';
      this.persistentAudio = el;
    }

    if (this.isSupported()) {
      try {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
        if (!this.speechPrimed && !this.speaking && !window.speechSynthesis.speaking) {
          this.speechPrimed = true;
          const u = new SpeechSynthesisUtterance(' ');
          u.volume = 0;
          u.rate = 1.5;
          window.speechSynthesis.speak(u);
        }
      } catch {
        // Ignore gesture unlock errors
      }
    }
  }

  public getLipSyncState(): LipSyncState {
    if (!this.speaking || !this.activeSpeaker) {
      this.smoothedRms *= 0.72;
      return { speaker: null, openness: 0, spread: 0 };
    }

    const now = performance.now();

    // 1) Live audio waveform RMS for neural HTMLAudioElement
    if (this.persistentAudio && !this.persistentAudio.paused && this.analyser && this.freqBins) {
      this.analyser.getByteTimeDomainData(this.freqBins);
      let sumSq = 0;
      for (let i = 0; i < this.freqBins.length; i++) {
        const centered = (this.freqBins[i] - 128) / 128;
        sumSq += centered * centered;
      }
      const rms = Math.sqrt(sumSq / this.freqBins.length);
      const normalized = Math.min(1, rms * 5.2);
      this.smoothedRms = this.smoothedRms * 0.45 + normalized * 0.55;
      const spread = 0.25 + 0.75 * Math.abs(Math.sin(now * 0.011));
      return {
        speaker: this.activeSpeaker,
        openness: Math.min(1, Math.max(0.04, this.smoothedRms)),
        spread,
      };
    }

    // 2) Live SpeechSynthesis word-boundary pulse + syllable cadence
    const sinceStartMs = now - this.speechStartedAt;
    if (this.boundaryObserved) {
      const sinceWord = now - this.lastBoundaryAt;
      if (sinceWord <= this.lastBoundaryDurMs) {
        const phase = sinceWord / this.lastBoundaryDurMs;
        const wordOpen = Math.sin(phase * Math.PI) * (0.68 + 0.32 * Math.abs(Math.sin(phase * Math.PI * 2.4)));
        return {
          speaker: this.activeSpeaker,
          openness: Math.min(1, Math.max(0.06, wordOpen)),
          spread: 0.35 + 0.65 * Math.abs(Math.cos(phase * Math.PI)),
        };
      }
      return { speaker: this.activeSpeaker, openness: 0.05, spread: 0.2 };
    }

    // 3) Pre-computed word-span timeline envelope with natural punctuation pauses
    for (let i = 0; i < this.wordSpans.length; i++) {
      const sp = this.wordSpans[i];
      if (sinceStartMs >= sp.startMs && sinceStartMs <= sp.endMs) {
        const p = (sinceStartMs - sp.startMs) / Math.max(1, sp.endMs - sp.startMs);
        const syllableWave = 0.65 + 0.35 * Math.sin(p * Math.PI * 3);
        const openness = Math.sin(p * Math.PI) * sp.vowelWeight * syllableWave;
        return {
          speaker: this.activeSpeaker,
          openness: Math.min(1, Math.max(0.08, openness)),
          spread: 0.3 + 0.7 * Math.abs(Math.sin(p * Math.PI * 1.7)),
        };
      }
    }

    const fallbackPulse = Math.max(0, Math.sin(sinceStartMs * 0.018)) * 0.55;
    return { speaker: this.activeSpeaker, openness: fallbackPulse, spread: 0.3 };
  }

  private clearTimers() {
    if (this.watchdogTimer !== null) {
      window.clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.startDelayTimer !== null) {
      window.clearTimeout(this.startDelayTimer);
      this.startDelayTimer = null;
    }
  }

  public stop() {
    this.activeToken += 1;
    this.clearTimers();
    if (this.persistentAudio) {
      try {
        this.persistentAudio.onended = null;
        this.persistentAudio.onerror = null;
        this.persistentAudio.pause();
        this.persistentAudio.removeAttribute('src');
        this.persistentAudio.load();
      } catch {
        // Ignore reset failure
      }
    }
    if (this.activeObjectUrl) {
      URL.revokeObjectURL(this.activeObjectUrl);
      this.activeObjectUrl = null;
    }
    if (this.isSupported()) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore browser speech cancel error
      }
    }
    this.speaking = false;
    this.activeSpeaker = null;
    this.smoothedRms = 0;
    this.coachReplyUntil = 0;
    telemetryAudio.setSpeechDucking(false);
  }

  private pickVoice(gender: 'female' | 'male'): SpeechSynthesisVoice | undefined {
    if (this.voices.length === 0) this.refreshVoices();
    if (this.voices.length === 0) return undefined;

    if (gender === 'female') {
      return (
        this.voices.find((v) => FEMALE_HINT.test(v.name) && !/\bmale\b/i.test(v.name)) ||
        this.voices.find((v) => !MALE_HINT.test(v.name)) ||
        this.voices[0]
      );
    }

    return (
      this.voices.find((v) => MALE_HINT.test(v.name) && !/female/i.test(v.name)) ||
      this.voices.find((v) => !FEMALE_HINT.test(v.name)) ||
      this.voices[this.voices.length > 1 ? 1 : 0]
    );
  }

  private resolveGenderSpeaker(raw?: VoiceSpeaker): 'maya' | 'leo' | 'sam' {
    if (!raw || raw === 'coach') {
      if (this.coachVoiceMode === 'duo') return 'maya';
      return this.coachVoiceMode;
    }
    return raw;
  }

  private speakBrowserSynthesis(
    text: string,
    speaker: 'maya' | 'leo' | 'sam',
    token: number,
    onEnd?: () => void,
    hadPriorSpeech = false
  ) {
    if (!this.isSupported() || this.activeToken !== token) {
      if (this.activeToken === token) {
        this.speaking = false;
        this.activeSpeaker = null;
        this.coachReplyUntil = 0;
        telemetryAudio.setSpeechDucking(false);
        onEnd?.();
      }
      return;
    }

    const chunks = splitSpeechChunks(text, 125);
    if (chunks.length === 0) {
      this.speaking = false;
      this.activeSpeaker = null;
      this.coachReplyUntil = 0;
      telemetryAudio.setSpeechDucking(false);
      onEnd?.();
      return;
    }

    this.refreshVoices();
    const isFemale = speaker === 'maya';
    const pickedVoice = this.pickVoice(isFemale ? 'female' : 'male');

    const rate = speaker === 'maya' ? 0.93 : speaker === 'leo' ? 0.95 : 0.9;
    const pitch = speaker === 'maya' ? 1.2 : speaker === 'leo' ? 0.8 : 0.7;

    this.speaking = true;
    this.activeSpeaker = speaker;
    telemetryAudio.setSpeechDucking(true);

    const finishAll = () => {
      if (this.activeToken !== token) return;
      this.clearTimers();
      this.speaking = false;
      this.activeSpeaker = null;
      this.coachReplyUntil = 0;
      telemetryAudio.setSpeechDucking(false);
      onEnd?.();
    };

    const speakChunk = (chunkIdx: number) => {
      if (this.activeToken !== token) return;
      if (chunkIdx >= chunks.length) {
        finishAll();
        return;
      }

      const chunkText = chunks[chunkIdx];
      const utterance = new SpeechSynthesisUtterance(chunkText);
      if (pickedVoice) {
        utterance.voice = pickedVoice;
      }
      utterance.rate = rate;
      utterance.pitch = pitch;
      utterance.volume = 0.96;

      this.speechStartedAt = performance.now();
      this.boundaryObserved = false;
      this.wordSpans = buildWordTimeline(chunkText, rate);

      let chunkSettled = false;
      const advanceChunk = () => {
        if (chunkSettled || this.activeToken !== token) return;
        chunkSettled = true;
        if (this.watchdogTimer !== null) {
          window.clearTimeout(this.watchdogTimer);
          this.watchdogTimer = null;
        }
        // Small breathing gap prevents back-to-back chunk clipping on mobile Android/iOS TTS
        this.startDelayTimer = window.setTimeout(() => {
          speakChunk(chunkIdx + 1);
        }, 45);
      };

      utterance.onstart = () => {
        if (this.activeToken === token) {
          this.speaking = true;
          this.activeSpeaker = speaker;
          this.speechStartedAt = performance.now();
          telemetryAudio.setSpeechDucking(true);
        }
      };

      utterance.onboundary = (ev) => {
        if (this.activeToken !== token) return;
        if (ev.name === 'word' || ev.charLength > 0) {
          this.boundaryObserved = true;
          this.lastBoundaryAt = performance.now();
          const len = Math.max(2, ev.charLength || 4);
          this.lastBoundaryDurMs = Math.min(340, Math.max(130, len * 52));
        }
      };

      utterance.onend = advanceChunk;
      utterance.onerror = advanceChunk;

      // Generous per-sentence watchdog so longer phrases never get chopped mid-word
      const wordsInChunk = chunkText.split(/\s+/).length;
      const estimatedMs = Math.max(7000, wordsInChunk * 680 + 3500);
      this.watchdogTimer = window.setTimeout(advanceChunk, estimatedMs);

      try {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
        window.speechSynthesis.speak(utterance);
      } catch {
        advanceChunk();
      }
    };

    // Wait briefly after speechSynthesis.cancel() so Chrome/Android doesn't swallow the first chunk
    if (hadPriorSpeech) {
      this.startDelayTimer = window.setTimeout(() => speakChunk(0), 55);
    } else {
      speakChunk(0);
    }
  }

  private ensureAudioAnalyser(audio: HTMLAudioElement) {
    if (this.analyserAttached) return;
    try {
      const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      if (!this.audioCtx) {
        this.audioCtx = new AudioCtx();
        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.fftSize = 128;
        this.analyser.smoothingTimeConstant = 0.45;
        this.freqBins = new Uint8Array(this.analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      const src = this.audioCtx.createMediaElementSource(audio);
      src.connect(this.analyser!);
      this.analyser!.connect(this.audioCtx.destination);
      this.analyserAttached = true;
    } catch {
      // Fall back smoothly to timeline lip-sync if element analysis is unavailable
    }
  }

  private async playNeuralTts(
    text: string,
    speaker: 'maya' | 'leo' | 'sam',
    token: number,
    onEnd?: () => void
  ): Promise<boolean> {
    if (typeof window === 'undefined' || performance.now() < this.neuralCooldownUntil) {
      return false;
    }

    const clean = sanitizeSpeechText(text);
    const cacheKey = `${speaker}:${clean}`;
    let base64 = this.clientTtsCache.get(cacheKey);

    if (!base64) {
      try {
        const res = await fetch('/api/coach/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: clean, coachVoice: speaker }),
          signal: AbortSignal.timeout(2500),
        });

        if (this.activeToken !== token) return true;

        if (!res.ok) {
          // Avoid repeatedly delaying speech playback on environments without TTS enabled
          this.neuralCooldownUntil = performance.now() + 10 * 60_000;
          return false;
        }

        const data = (await res.json()) as { audioBase64?: string };
        if (!data.audioBase64) {
          this.neuralCooldownUntil = performance.now() + 10 * 60_000;
          return false;
        }
        base64 = data.audioBase64;
        if (this.clientTtsCache.size >= 30) {
          const first = this.clientTtsCache.keys().next().value;
          if (first) this.clientTtsCache.delete(first);
        }
        this.clientTtsCache.set(cacheKey, base64);
      } catch {
        this.neuralCooldownUntil = performance.now() + 10 * 60_000;
        return false;
      }
    }

    if (this.activeToken !== token) return true;

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'audio/wav' });
    const objectUrl = URL.createObjectURL(blob);
    this.activeObjectUrl = objectUrl;

    if (!this.persistentAudio) {
      const el = new Audio();
      el.setAttribute('playsinline', 'true');
      el.preload = 'auto';
      this.persistentAudio = el;
    }
    const audio = this.persistentAudio;
    this.ensureAudioAnalyser(audio);
    audio.src = objectUrl;
    audio.currentTime = 0;

    this.activeSpeaker = speaker;
    this.speaking = true;
    this.speechStartedAt = performance.now();
    this.boundaryObserved = false;
    this.wordSpans = buildWordTimeline(clean, 0.94);

    const cleanup = () => {
      audio.onended = null;
      audio.onerror = null;
      if (this.activeObjectUrl === objectUrl) {
        URL.revokeObjectURL(objectUrl);
        this.activeObjectUrl = null;
      }
      if (this.activeToken === token) {
        this.speaking = false;
        this.activeSpeaker = null;
        this.smoothedRms = 0;
        this.coachReplyUntil = 0;
        telemetryAudio.setSpeechDucking(false);
        onEnd?.();
      }
    };

    audio.onended = cleanup;
    audio.onerror = cleanup;

    try {
      await audio.play();
      return true;
    } catch {
      cleanup();
      return false;
    }
  }

  public speak(
    text: string,
    options?: {
      priority?: boolean;
      cooldownMs?: number;
      speaker?: VoiceSpeaker;
      useNeuralTts?: boolean;
      isCoachReply?: boolean;
      isEmergency?: boolean;
      onEnd?: () => void;
    }
  ) {
    const clean = sanitizeSpeechText(text);
    if (!clean) {
      options?.onEnd?.();
      return;
    }

    if (!this.enabled) {
      return;
    }

    const now = performance.now();
    const cooldown = options?.cooldownMs ?? 6500;
    const priority = options?.priority ?? false;
    const isCoachReply = options?.isCoachReply ?? false;
    const isEmergency = options?.isEmergency ?? false;

    // Protect AI Coach conversations from being interrupted or broken up by background flight tips
    if (!isCoachReply && !isEmergency && (this.coachPanelActive || now < this.coachReplyUntil)) {
      return;
    }

    if (!priority) {
      if (this.speaking || (this.isSupported() && window.speechSynthesis.speaking)) return;
      if (now - this.lastSpokenAt < cooldown) return;
      if (clean === this.lastMessage && now - this.lastSpokenAt < 14000) return;
    }

    const wasActivelySpeaking =
      this.speaking || (this.isSupported() && window.speechSynthesis.speaking);
    if (priority && wasActivelySpeaking) {
      this.stop();
    }

    const speaker = this.resolveGenderSpeaker(options?.speaker);
    const token = ++this.activeToken;
    this.lastSpokenAt = now;
    this.lastMessage = clean;
    if (isCoachReply) {
      // Reserve uninterrupted speaking window proportional to answer length
      this.coachReplyUntil = now + Math.min(25000, Math.max(8000, clean.length * 75));
    }
    telemetryAudio.unlockAndStartMusic();
    telemetryAudio.setSpeechDucking(true);

    const canTryNeural = Boolean(options?.useNeuralTts) && now >= this.neuralCooldownUntil;
    if (canTryNeural) {
      this.speaking = true;
      this.activeSpeaker = speaker;
      this.speechStartedAt = performance.now();
      this.wordSpans = buildWordTimeline(clean, 0.94);
      this.playNeuralTts(clean, speaker, token, options?.onEnd)
        .then((played) => {
          if (!played && this.activeToken === token) {
            this.speakBrowserSynthesis(clean, speaker, token, options?.onEnd, wasActivelySpeaking);
          }
        })
        .catch(() => {
          if (this.activeToken === token) {
            this.speakBrowserSynthesis(clean, speaker, token, options?.onEnd, wasActivelySpeaking);
          }
        });
      return;
    }

    this.speakBrowserSynthesis(clean, speaker, token, options?.onEnd, wasActivelySpeaking);
  }
}

export const voiceGuide = new VoiceGuideEngine();
