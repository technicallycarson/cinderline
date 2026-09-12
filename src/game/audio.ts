export type AudioEffect =
  | "placed"
  | "removed"
  | "rotate"
  | "error"
  | "complete"
  | "machine";

export interface AudioEngineOptions {
  masterVolume?: number;
  ambientVolume?: number;
  effectsVolume?: number;
  ambientEnabled?: boolean;
  /** Listen for the first pointer/keyboard gesture and unlock automatically. */
  autoArm?: boolean;
}

export interface AudioMixDiagnostics {
  readonly masterGain: number;
  readonly ambientBusGain: number;
  readonly effectsBusGain: number;
  readonly effectsTrimGain: number;
  readonly outputCeilingGain: number;
  /** Linear gain through the default effects path before dynamic limiting. */
  readonly nominalEffectsGain: number;
  /** Linear gain through the ambience path before dynamic limiting. */
  readonly nominalAmbientGain: number;
  /** Change from the previous shipped M1 effects mix. */
  readonly effectsBoostDecibels: number;
  /** Change from the previous shipped M1 ambience mix. */
  readonly ambientChangeDecibels: number;
  /** Additional effects-over-ambience separation versus the previous mix. */
  readonly effectsSeparationGainDecibels: number;
  /** Provable post-safety-stage sample ceiling. */
  readonly maximumOutputPeak: number;
  readonly maximumOutputPeakDecibels: number;
  readonly peakController: {
    readonly thresholdDecibels: number;
    readonly kneeDecibels: number;
    readonly ratio: number;
    readonly attackSeconds: number;
    readonly releaseSeconds: number;
  };
}

export interface AudioOutputSample {
  readonly peak: number;
  readonly peakDecibels: number;
  readonly rms: number;
  readonly rmsDecibels: number;
  /** RMS of the newest 2,048 samples, used for mute-transition timing. */
  readonly recentRmsDecibels: number;
  readonly clippedSamples: number;
  readonly sampleCount: number;
  /** Strongest FFT bin from 250 Hz through 4 kHz. */
  readonly usefulBandPeakDecibels: number;
}

export interface SoundOptions {
  /** Stereo position from -1 (left) to 1 (right). */
  pan?: number;
  /** Loudness/timbre variation from 0 to 1. */
  intensity?: number;
  machine?: string;
}

export type TransferAccent = "belt" | "inserter";
export type SmelterAccent = "ignite" | "complete";
export type FabricatorAccent = "arc" | "complete";

type AudioContextConstructor = new (options?: AudioContextOptions) => AudioContext;

interface ToneOptions {
  frequency: number;
  endFrequency?: number;
  duration: number;
  volume: number;
  delay?: number;
  pan?: number;
  type?: OscillatorType;
  attack?: number;
}

interface NoiseOptions {
  duration: number;
  volume: number;
  filterFrequency: number;
  endFilterFrequency?: number;
  delay?: number;
  pan?: number;
  filterType?: BiquadFilterType;
  resonance?: number;
}

const MAX_TRANSIENT_SOURCES = 36;

/**
 * The former M1 shipping mix is retained only as a measurement baseline. It
 * makes the loudness increase reviewable instead of relying on subjective
 * labels such as "louder".
 */
const PREVIOUS_SHIPPING_MIX = Object.freeze({
  masterVolume: 0.64,
  ambientVolume: 0.28,
  effectsVolume: 0.68,
});

/** The single source of truth for the user-facing, unmuted mix. */
export const DEFAULT_AUDIO_MIX = Object.freeze({
  masterVolume: 0.88,
  ambientVolume: 0.22,
  effectsVolume: 0.96,
});

/**
 * Every procedural SFX uses this shared trim. Ambience bypasses it, which
 * raises event intelligibility without making the factory bed louder.
 */
const EFFECTS_TRIM_GAIN = 1.5;
const OUTPUT_CEILING_GAIN = 0.9;
const PEAK_CONTROLLER = Object.freeze({
  thresholdDecibels: -8,
  kneeDecibels: 4,
  ratio: 12,
  attackSeconds: 0.002,
  releaseSeconds: 0.11,
});

// The emergency curve is exactly linear through ordinary cue levels. Only a
// pathological transient pile-up above this knee is progressively saturated.
const SAFETY_KNEE = 0.84;
const SAFETY_MAXIMUM = 0.98;
const SAFETY_CURVE_SAMPLES = 8_192;

/**
 * Normalization is deliberately cue-specific. The tiny procedural envelopes
 * have very different durations and spectra, so one global boost left short
 * servo/arc events buried while longer placement tones were already audible.
 * These trims put routine telemetry around -13..-9 dBFS and direct feedback
 * around -8..-6 dBFS in the paused-world Chromium acceptance capture.
 */
const CUE_NORMALIZATION = Object.freeze({
  placed: 2.8,
  removed: 3,
  rotate: 10.25,
  error: 4.5,
  complete: 5,
  machine: 8,
  extraction: 8,
  beltTransfer: 26,
  inserterTransfer: 12,
  smelter: 9,
  fabricatorArc: 26,
  fabricatorComplete: 16,
  automationCore: 5,
  powerTransition: 6,
});

function gainToDecibels(gain: number): number {
  return gain > 0 ? 20 * Math.log10(gain) : Number.NEGATIVE_INFINITY;
}

function createEmergencyLimiterCurve(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(SAFETY_CURVE_SAMPLES);
  const exponent = (1 - SAFETY_KNEE) / (SAFETY_MAXIMUM - SAFETY_KNEE);
  for (let index = 0; index < curve.length; index += 1) {
    const input = (index / (curve.length - 1)) * 2 - 1;
    const magnitude = Math.abs(input);
    if (magnitude <= SAFETY_KNEE) {
      curve[index] = input;
      continue;
    }
    const progress = clamp(
      (magnitude - SAFETY_KNEE) / (1 - SAFETY_KNEE),
      0,
      1,
    );
    const shaped =
      SAFETY_MAXIMUM -
      (SAFETY_MAXIMUM - SAFETY_KNEE) *
        Math.pow(1 - progress, exponent);
    curve[index] = Math.sign(input) * shaped;
  }
  return curve;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function getAudioContextConstructor(): AudioContextConstructor | undefined {
  if (typeof AudioContext !== "undefined") return AudioContext;
  const safariGlobal = globalThis as typeof globalThis & {
    webkitAudioContext?: AudioContextConstructor;
  };
  return safariGlobal.webkitAudioContext;
}

/**
 * Procedural, dependency-free audio for the factory. The class is safe to
 * construct in browsers without Web Audio: all playback methods become no-ops.
 *
 * No AudioContext or ambient sound is started until `unlock()` is called from a
 * user gesture. With autoArm enabled (the default), the first pointer, touch,
 * or keyboard interaction performs that unlock.
 */
export class AudioEngine {
  private readonly masterVolume: number;
  private readonly ambientVolume: number;
  private readonly effectsVolume: number;
  private ambientEnabled: boolean;
  private muted = false;
  private disposed = false;
  private unsupported = false;

  private context: AudioContext | null = null;
  private masterBus: GainNode | null = null;
  private ambientBus: GainNode | null = null;
  private effectsBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private unlockPromise: Promise<boolean> | null = null;
  private ambientStarted = false;
  private ambientTimer: number | undefined;
  private gestureTarget: EventTarget | null = null;
  private gridSatisfaction = 1;
  private gridBedGain: GainNode | null = null;
  private gridBedFilter: BiquadFilterNode | null = null;
  private peakController: DynamicsCompressorNode | null = null;
  private emergencyLimiter: WaveShaperNode | null = null;
  private outputCeiling: GainNode | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  private readonly ambientSources = new Set<AudioScheduledSourceNode>();
  private readonly transientSources = new Set<AudioScheduledSourceNode>();
  private readonly cueCooldowns = new Map<string, number>();
  private activeCueNormalization = 1;

  private readonly gestureHandler = (): void => {
    void this.unlock();
  };

  constructor(options: AudioEngineOptions = {}) {
    this.masterVolume = clamp(
      options.masterVolume ?? DEFAULT_AUDIO_MIX.masterVolume,
      0,
      1,
    );
    this.ambientVolume = clamp(
      options.ambientVolume ?? DEFAULT_AUDIO_MIX.ambientVolume,
      0,
      1,
    );
    this.effectsVolume = clamp(
      options.effectsVolume ?? DEFAULT_AUDIO_MIX.effectsVolume,
      0,
      1,
    );
    this.ambientEnabled = options.ambientEnabled ?? true;

    if (options.autoArm !== false && typeof window !== "undefined") {
      this.arm();
    }
  }

  get isReady(): boolean {
    return this.context?.state === "running";
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get isSupported(): boolean {
    return !this.unsupported && getAudioContextConstructor() !== undefined;
  }

  /** Deterministic mix/headroom evidence for QA and accessibility review. */
  get mixDiagnostics(): AudioMixDiagnostics {
    const nominalEffectsGain =
      this.masterVolume *
      this.effectsVolume *
      EFFECTS_TRIM_GAIN *
      OUTPUT_CEILING_GAIN;
    const nominalAmbientGain =
      this.masterVolume * this.ambientVolume * OUTPUT_CEILING_GAIN;
    const previousEffectsGain =
      PREVIOUS_SHIPPING_MIX.masterVolume * PREVIOUS_SHIPPING_MIX.effectsVolume;
    const previousAmbientGain =
      PREVIOUS_SHIPPING_MIX.masterVolume * PREVIOUS_SHIPPING_MIX.ambientVolume;
    const maximumOutputPeak = SAFETY_MAXIMUM * OUTPUT_CEILING_GAIN;
    return {
      masterGain: this.masterVolume,
      ambientBusGain: this.ambientVolume,
      effectsBusGain: this.effectsVolume * EFFECTS_TRIM_GAIN,
      effectsTrimGain: EFFECTS_TRIM_GAIN,
      outputCeilingGain: OUTPUT_CEILING_GAIN,
      nominalEffectsGain,
      nominalAmbientGain,
      effectsBoostDecibels: gainToDecibels(
        nominalEffectsGain / previousEffectsGain,
      ),
      ambientChangeDecibels: gainToDecibels(
        nominalAmbientGain / previousAmbientGain,
      ),
      effectsSeparationGainDecibels: gainToDecibels(
        nominalEffectsGain /
          nominalAmbientGain /
          (previousEffectsGain / previousAmbientGain),
      ),
      maximumOutputPeak,
      maximumOutputPeakDecibels: gainToDecibels(maximumOutputPeak),
      peakController: { ...PEAK_CONTROLLER },
    };
  }

  /**
   * Samples the actual post-limiter/post-ceiling browser output. QA polls this
   * during a cue; it intentionally reports no synthetic or pre-fader values.
   */
  sampleOutput(): AudioOutputSample | null {
    const analyser = this.outputAnalyser;
    const context = this.context;
    if (!analyser || !context || context.state !== "running") return null;
    const waveform = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(waveform);
    let peak = 0;
    let clippedSamples = 0;
    for (const sample of waveform) {
      const magnitude = Math.abs(sample);
      peak = Math.max(peak, magnitude);
      if (magnitude >= 0.999) clippedSamples += 1;
    }
    const rmsWindowSize = 2_048;
    const rmsHopSize = 512;
    let maximumRms = 0;
    let recentRms = 0;
    for (
      let start = 0;
      start <= waveform.length - rmsWindowSize;
      start += rmsHopSize
    ) {
      let squareSum = 0;
      for (let offset = 0; offset < rmsWindowSize; offset += 1) {
        const sample = waveform[start + offset] ?? 0;
        squareSum += sample * sample;
      }
      const windowRms = Math.sqrt(squareSum / rmsWindowSize);
      maximumRms = Math.max(maximumRms, windowRms);
      if (start === waveform.length - rmsWindowSize) recentRms = windowRms;
    }
    const spectrum = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(spectrum);
    const hzPerBin = context.sampleRate / analyser.fftSize;
    const firstUsefulBin = Math.max(1, Math.ceil(250 / hzPerBin));
    const lastUsefulBin = Math.min(
      spectrum.length - 1,
      Math.floor(4_000 / hzPerBin),
    );
    let usefulBandPeakDecibels = Number.NEGATIVE_INFINITY;
    for (let index = firstUsefulBin; index <= lastUsefulBin; index += 1) {
      usefulBandPeakDecibels = Math.max(
        usefulBandPeakDecibels,
        spectrum[index] ?? Number.NEGATIVE_INFINITY,
      );
    }
    return {
      peak,
      peakDecibels: gainToDecibels(peak),
      rms: maximumRms,
      rmsDecibels: gainToDecibels(maximumRms),
      recentRmsDecibels: gainToDecibels(recentRms),
      clippedSamples,
      sampleCount: waveform.length,
      usefulBandPeakDecibels,
    };
  }

  /**
   * Installs lightweight one-time-style listeners. They remain installed only
   * while an unlock is still required.
   */
  arm(target: EventTarget = window): void {
    if (this.disposed || this.isReady || this.gestureTarget === target) return;
    this.disarm();
    this.gestureTarget = target;
    target.addEventListener("pointerdown", this.gestureHandler, { passive: true });
    target.addEventListener("touchstart", this.gestureHandler, { passive: true });
    target.addEventListener("keydown", this.gestureHandler);
  }

  /**
   * Must be reached from a user-initiated event on browsers with autoplay
   * protection. Calling it more than once is harmless.
   */
  async unlock(): Promise<boolean> {
    if (this.disposed || this.unsupported) return false;
    if (this.context?.state === "running") {
      this.startAmbient();
      this.disarm();
      return true;
    }
    if (this.unlockPromise) return this.unlockPromise;

    this.unlockPromise = this.performUnlock();
    const result = await this.unlockPromise;
    this.unlockPromise = null;
    return result;
  }

  setMuted(muted: boolean): boolean {
    this.muted = muted;
    this.applyMasterLevel();
    return this.muted;
  }

  toggleMute(): boolean {
    return this.setMuted(!this.muted);
  }

  /** Compatibility spelling for terse integrations. */
  toggleMuted(): boolean {
    return this.toggleMute();
  }

  setAmbientEnabled(enabled: boolean): void {
    this.ambientEnabled = enabled;
    if (enabled) this.startAmbient();
    this.applyAmbientLevel();
  }

  play(effect: AudioEffect, options: SoundOptions = {}): void {
    if (!this.preparePlayback(() => this.play(effect, options))) return;
    switch (effect) {
      case "placed":
        this.renderNormalizedCue(CUE_NORMALIZATION.placed, () =>
          this.playPlaced(options),
        );
        break;
      case "removed":
        this.renderNormalizedCue(CUE_NORMALIZATION.removed, () =>
          this.playRemoved(options),
        );
        break;
      case "rotate":
        this.renderNormalizedCue(CUE_NORMALIZATION.rotate, () =>
          this.playRotate(options),
        );
        break;
      case "error":
        this.renderNormalizedCue(CUE_NORMALIZATION.error, () =>
          this.playError(options),
        );
        break;
      case "complete":
        this.renderNormalizedCue(CUE_NORMALIZATION.complete, () =>
          this.playComplete(options),
        );
        break;
      case "machine":
        this.renderNormalizedCue(CUE_NORMALIZATION.machine, () =>
          this.playMachineAccent(options.machine, options.intensity, options.pan),
        );
        break;
      default:
        break;
    }
  }

  placed(pan = 0, intensity = 1): void {
    this.play("placed", { pan, intensity });
  }

  removed(pan = 0, intensity = 1): void {
    this.play("removed", { pan, intensity });
  }

  rotate(pan = 0): void {
    this.play("rotate", { pan });
  }

  error(pan = 0): void {
    this.play("error", { pan });
  }

  complete(pan = 0): void {
    this.play("complete", { pan });
  }

  machine(machine = "machine", intensity = 0.65, pan = 0): void {
    this.play("machine", { machine, intensity, pan });
  }

  placement(pan = 0, intensity = 1): void {
    this.placed(pan, intensity);
  }

  removal(pan = 0, intensity = 1): void {
    this.removed(pan, intensity);
  }

  machineAccent(machine = "machine", intensity = 0.65, pan = 0): void {
    this.machine(machine, intensity, pan);
  }

  /** A drill-head impact followed by a restrained ore ping. */
  extraction(pan = 0, intensity = 0.55): void {
    this.triggerCue(
      "extraction",
      0.12,
      3,
      () => this.extraction(pan, intensity),
      () =>
        this.renderNormalizedCue(CUE_NORMALIZATION.extraction, () =>
          this.playExtractionHit(pan, intensity),
        ),
    );
  }

  /**
   * Coalesced transfer feedback. Belt arrivals are a light indexed click;
   * inserter deliveries carry a slightly heavier servo thunk.
   */
  transfer(kind: TransferAccent = "belt", pan = 0, intensity = 0.35): void {
    this.triggerCue(
      `transfer:${kind}`,
      kind === "belt" ? 0.14 : 0.18,
      2,
      () => this.transfer(kind, pan, intensity),
      () =>
        this.renderNormalizedCue(
          kind === "belt"
            ? CUE_NORMALIZATION.beltTransfer
            : CUE_NORMALIZATION.inserterTransfer,
          () => this.playTransfer(kind, pan, intensity),
        ),
    );
  }

  smelter(phase: SmelterAccent = "complete", pan = 0, intensity = 0.5): void {
    this.triggerCue(
      `smelter:${phase}`,
      phase === "ignite" ? 0.34 : 0.2,
      phase === "ignite" ? 2 : 3,
      () => this.smelter(phase, pan, intensity),
      () =>
        this.renderNormalizedCue(CUE_NORMALIZATION.smelter, () =>
          this.playSmelter(phase, pan, intensity),
        ),
    );
  }

  fabricator(
    phase: FabricatorAccent = "complete",
    pan = 0,
    intensity = 0.45,
  ): void {
    this.triggerCue(
      `fabricator:${phase}`,
      phase === "arc" ? 0.16 : 0.13,
      phase === "arc" ? 2 : 3,
      () => this.fabricator(phase, pan, intensity),
      () =>
        this.renderNormalizedCue(
          phase === "arc"
            ? CUE_NORMALIZATION.fabricatorArc
            : CUE_NORMALIZATION.fabricatorComplete,
          () => this.playFabricator(phase, pan, intensity),
        ),
    );
  }

  automationCore(pan = 0): void {
    this.triggerCue(
      "automation-core",
      1.5,
      7,
      () => this.automationCore(pan),
      () =>
        this.renderNormalizedCue(CUE_NORMALIZATION.automationCore, () =>
          this.playAutomationCore(pan),
        ),
      true,
    );
  }

  /**
   * Updates the continuous grid bed and optionally emits a relay/sag accent.
   * The value is normalized supply satisfaction from 0 to 1.
   */
  powerGrid(satisfaction: number, accent = true): void {
    const next = clamp(
      Number.isFinite(satisfaction) ? satisfaction : this.gridSatisfaction,
      0,
      1,
    );
    const previous = this.gridSatisfaction;
    this.gridSatisfaction = next;
    this.applyGridBed();
    if (!accent || Math.abs(next - previous) < 0.025) return;
    this.triggerCue(
      "power-grid",
      0.55,
      3,
      () => this.powerGrid(next, true),
      () =>
        this.renderNormalizedCue(CUE_NORMALIZATION.powerTransition, () =>
          this.playPowerTransition(previous, next),
        ),
    );
  }

  setPowerLoad(satisfaction: number): void {
    this.powerGrid(satisfaction, false);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disarm();
    if (this.ambientTimer !== undefined) {
      window.clearInterval(this.ambientTimer);
      this.ambientTimer = undefined;
    }
    for (const source of this.ambientSources) {
      try {
        source.stop();
      } catch {
        // A source that has already ended needs no further cleanup.
      }
      source.disconnect();
    }
    this.ambientSources.clear();
    for (const source of this.transientSources) {
      try {
        source.stop();
      } catch {
        // A source that has already ended needs no further cleanup.
      }
      source.disconnect();
    }
    this.transientSources.clear();
    this.cueCooldowns.clear();
    this.masterBus?.disconnect();
    this.ambientBus?.disconnect();
    this.effectsBus?.disconnect();
    this.gridBedGain?.disconnect();
    this.gridBedFilter?.disconnect();
    this.peakController?.disconnect();
    this.emergencyLimiter?.disconnect();
    this.outputCeiling?.disconnect();
    this.outputAnalyser?.disconnect();
    const context = this.context;
    this.context = null;
    this.masterBus = null;
    this.ambientBus = null;
    this.effectsBus = null;
    this.gridBedGain = null;
    this.gridBedFilter = null;
    this.peakController = null;
    this.emergencyLimiter = null;
    this.outputCeiling = null;
    this.outputAnalyser = null;
    this.noiseBuffer = null;
    if (context && context.state !== "closed") void context.close();
  }

  private async performUnlock(): Promise<boolean> {
    try {
      if (!this.context) {
        const Constructor = getAudioContextConstructor();
        if (!Constructor) {
          this.unsupported = true;
          this.disarm();
          return false;
        }
        this.context = new Constructor({ latencyHint: "interactive" });
        this.createSignalGraph(this.context);
      }

      if (this.context.state === "suspended") {
        await this.context.resume();
      }
      const ready = this.context.state === "running";
      if (ready) {
        this.startAmbient();
        this.disarm();
      } else if (typeof window !== "undefined") {
        this.arm();
      }
      return ready;
    } catch {
      // A failed audio device or denied browser policy must never stop gameplay.
      if (!this.context) this.unsupported = true;
      return false;
    }
  }

  private createSignalGraph(context: AudioContext): void {
    const peakController = context.createDynamicsCompressor();
    peakController.threshold.value = PEAK_CONTROLLER.thresholdDecibels;
    peakController.knee.value = PEAK_CONTROLLER.kneeDecibels;
    peakController.ratio.value = PEAK_CONTROLLER.ratio;
    peakController.attack.value = PEAK_CONTROLLER.attackSeconds;
    peakController.release.value = PEAK_CONTROLLER.releaseSeconds;
    const emergencyLimiter = context.createWaveShaper();
    emergencyLimiter.curve = createEmergencyLimiterCurve();
    emergencyLimiter.oversample = "none";
    const outputCeiling = context.createGain();
    outputCeiling.gain.value = OUTPUT_CEILING_GAIN;
    const outputAnalyser = context.createAnalyser();
    // The long history makes sub-50 ms mechanical cues measurable even when a
    // throttled headless browser can only poll a few times per second. RMS is
    // still evaluated in local 2,048-sample windows by sampleOutput().
    outputAnalyser.fftSize = 32_768;
    outputAnalyser.smoothingTimeConstant = 0;

    this.masterBus = context.createGain();
    this.ambientBus = context.createGain();
    this.effectsBus = context.createGain();
    this.masterBus.gain.value = this.muted ? 0 : this.masterVolume;
    this.ambientBus.gain.value = this.ambientEnabled ? this.ambientVolume : 0;
    this.effectsBus.gain.value = this.effectsVolume * EFFECTS_TRIM_GAIN;
    this.ambientBus.connect(this.masterBus);
    this.effectsBus.connect(this.masterBus);
    this.masterBus.connect(peakController);
    peakController.connect(emergencyLimiter);
    emergencyLimiter.connect(outputCeiling);
    outputCeiling.connect(outputAnalyser);
    outputAnalyser.connect(context.destination);
    this.peakController = peakController;
    this.emergencyLimiter = emergencyLimiter;
    this.outputCeiling = outputCeiling;
    this.outputAnalyser = outputAnalyser;
    this.noiseBuffer = this.createNoiseBuffer(context);

    context.onstatechange = () => {
      if (context.state === "running") this.startAmbient();
    };
  }

  private createNoiseBuffer(context: AudioContext): AudioBuffer {
    const seconds = 2.4;
    const frameCount = Math.ceil(context.sampleRate * seconds);
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const samples = buffer.getChannelData(0);
    let slowNoise = 0;
    for (let index = 0; index < frameCount; index += 1) {
      const white = Math.random() * 2 - 1;
      slowNoise = slowNoise * 0.985 + white * 0.015;
      samples[index] = clamp(white * 0.28 + slowNoise * 2.4, -1, 1);
    }
    return buffer;
  }

  private startAmbient(): void {
    const context = this.context;
    const bus = this.ambientBus;
    if (
      this.disposed ||
      this.ambientStarted ||
      !this.ambientEnabled ||
      context?.state !== "running" ||
      !bus
    ) {
      return;
    }
    this.ambientStarted = true;

    const droneFilter = context.createBiquadFilter();
    droneFilter.type = "lowpass";
    droneFilter.frequency.value = 210;
    droneFilter.Q.value = 0.7;
    droneFilter.connect(bus);

    const foundation = context.createOscillator();
    const foundationGain = context.createGain();
    foundation.type = "sine";
    foundation.frequency.value = 43.2;
    foundationGain.gain.value = 0.036;
    foundation.connect(foundationGain).connect(droneFilter);

    const harmonic = context.createOscillator();
    const harmonicGain = context.createGain();
    harmonic.type = "triangle";
    harmonic.frequency.value = 64.8;
    harmonic.detune.value = -7;
    harmonicGain.gain.value = 0.012;
    harmonic.connect(harmonicGain).connect(droneFilter);

    const lfo = context.createOscillator();
    const lfoDepth = context.createGain();
    lfo.type = "sine";
    lfo.frequency.value = 0.075;
    lfoDepth.gain.value = 5;
    lfo.connect(lfoDepth);
    lfoDepth.connect(harmonic.detune);

    const noise = context.createBufferSource();
    const noiseFilter = context.createBiquadFilter();
    const noiseGain = context.createGain();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 155;
    noiseFilter.Q.value = 0.55;
    noiseGain.gain.value = 0.035;
    noise.connect(noiseFilter).connect(noiseGain).connect(bus);

    const air = context.createBufferSource();
    const airFilter = context.createBiquadFilter();
    const airGain = context.createGain();
    air.buffer = this.noiseBuffer;
    air.loop = true;
    air.playbackRate.value = 0.71;
    airFilter.type = "bandpass";
    airFilter.frequency.value = 1450;
    airFilter.Q.value = 0.35;
    airGain.gain.value = 0.005;
    air.connect(airFilter).connect(airGain).connect(bus);

    // A quiet, load-responsive alternator layer gives the power network a
    // physical presence without adding another timer or sampled loop.
    const gridFundamental = context.createOscillator();
    const gridHarmonic = context.createOscillator();
    const gridFilter = context.createBiquadFilter();
    const gridGain = context.createGain();
    const gridFlutter = context.createOscillator();
    const gridFlutterDepth = context.createGain();
    gridFundamental.type = "triangle";
    gridFundamental.frequency.value = 59.7;
    gridHarmonic.type = "sine";
    gridHarmonic.frequency.value = 119.4;
    gridFilter.type = "bandpass";
    gridFilter.frequency.value = 112;
    gridFilter.Q.value = 0.72;
    gridGain.gain.value = 0.0001;
    gridFlutter.type = "sine";
    gridFlutter.frequency.value = 3.15;
    gridFlutterDepth.gain.value = 0.0012;
    gridFundamental.connect(gridFilter);
    gridHarmonic.connect(gridFilter);
    gridFilter.connect(gridGain).connect(bus);
    gridFlutter.connect(gridFlutterDepth).connect(gridGain.gain);
    this.gridBedFilter = gridFilter;
    this.gridBedGain = gridGain;

    const now = context.currentTime;
    for (const source of [
      foundation,
      harmonic,
      lfo,
      noise,
      air,
      gridFundamental,
      gridHarmonic,
      gridFlutter,
    ]) {
      this.ambientSources.add(source);
      source.start(now);
    }
    this.applyGridBed();

    if (typeof window !== "undefined") {
      this.ambientTimer = window.setInterval(() => this.scheduleAmbientPulse(), 1740);
    }
  }

  private scheduleAmbientPulse(): void {
    const context = this.context;
    if (
      !context ||
      context.state !== "running" ||
      !this.ambientEnabled ||
      this.disposed
    ) {
      return;
    }
    const step = Math.floor(context.currentTime / 1.74) % 8;
    const pan = ((step * 0.37) % 1.2) - 0.6;
    const frequency = step % 4 === 3 ? 73 : 58 + (step % 3) * 4;
    this.tone({
      frequency,
      endFrequency: frequency * 0.82,
      duration: 0.24,
      volume: step % 4 === 0 ? 0.017 : 0.009,
      type: "sine",
      pan,
      attack: 0.025,
    }, this.ambientBus);
    if (step % 2 === 0) {
      this.noise({
        duration: 0.045,
        volume: 0.007,
        filterFrequency: 680 + step * 45,
        filterType: "bandpass",
        resonance: 3,
        pan: -pan,
      }, this.ambientBus);
    }
  }

  private playPlaced(options: SoundOptions): void {
    const intensity = clamp(options.intensity ?? 1, 0.1, 1);
    const pan = clamp(options.pan ?? 0, -1, 1);
    this.tone({
      frequency: 128,
      endFrequency: 72,
      duration: 0.145,
      volume: 0.13 * intensity,
      type: "triangle",
      pan,
      attack: 0.004,
    });
    this.noise({
      duration: 0.07,
      volume: 0.045 * intensity,
      filterFrequency: 620,
      filterType: "bandpass",
      resonance: 1.3,
      pan,
    });
    this.tone({
      frequency: 920,
      endFrequency: 610,
      duration: 0.055,
      volume: 0.026 * intensity,
      delay: 0.018,
      type: "sine",
      pan,
    });
  }

  private playRemoved(options: SoundOptions): void {
    const intensity = clamp(options.intensity ?? 1, 0.1, 1);
    const pan = clamp(options.pan ?? 0, -1, 1);
    this.noise({
      duration: 0.18,
      volume: 0.07 * intensity,
      filterFrequency: 310,
      filterType: "lowpass",
      pan,
    });
    this.tone({
      frequency: 104,
      endFrequency: 39,
      duration: 0.24,
      volume: 0.11 * intensity,
      type: "sine",
      pan,
    });
    this.tone({
      frequency: 510,
      endFrequency: 180,
      duration: 0.09,
      volume: 0.025 * intensity,
      type: "square",
      pan,
    });
  }

  private playRotate(options: SoundOptions): void {
    const pan = clamp(options.pan ?? 0, -1, 1);
    this.tone({
      frequency: 760,
      endFrequency: 620,
      duration: 0.034,
      volume: 0.042,
      type: "triangle",
      pan,
    });
    this.tone({
      frequency: 980,
      endFrequency: 790,
      duration: 0.031,
      volume: 0.035,
      delay: 0.052,
      type: "triangle",
      pan,
    });
  }

  private playError(options: SoundOptions): void {
    const pan = clamp(options.pan ?? 0, -1, 1);
    this.tone({
      frequency: 126,
      endFrequency: 108,
      duration: 0.12,
      volume: 0.085,
      type: "square",
      pan,
      attack: 0.008,
    });
    this.tone({
      frequency: 101,
      endFrequency: 84,
      duration: 0.17,
      volume: 0.075,
      delay: 0.14,
      type: "square",
      pan,
      attack: 0.008,
    });
  }

  private playComplete(options: SoundOptions): void {
    const pan = clamp(options.pan ?? 0, -1, 1);
    const notes = [
      { frequency: 392, delay: 0 },
      { frequency: 523.25, delay: 0.085 },
      { frequency: 659.25, delay: 0.17 },
      { frequency: 783.99, delay: 0.28 },
    ] as const;
    for (const note of notes) {
      this.tone({
        frequency: note.frequency,
        endFrequency: note.frequency * 0.998,
        duration: note.delay === 0.28 ? 0.42 : 0.22,
        volume: note.delay === 0.28 ? 0.058 : 0.045,
        delay: note.delay,
        type: "sine",
        pan,
        attack: 0.012,
      });
    }
    this.tone({
      frequency: 98,
      endFrequency: 73.5,
      duration: 0.48,
      volume: 0.055,
      type: "triangle",
      pan,
      attack: 0.02,
    });
  }

  private playMachineAccent(
    machine = "machine",
    rawIntensity = 0.65,
    rawPan = 0,
  ): void {
    const intensity = clamp(rawIntensity, 0.05, 1);
    const pan = clamp(rawPan, -1, 1);
    switch (machine.toLowerCase()) {
      case "extractor":
        this.tone({
          frequency: 76,
          endFrequency: 53,
          duration: 0.12,
          volume: 0.07 * intensity,
          type: "sawtooth",
          pan,
        });
        this.noise({
          duration: 0.09,
          volume: 0.035 * intensity,
          filterFrequency: 380,
          filterType: "bandpass",
          resonance: 1.8,
          pan,
        });
        break;
      case "smelter":
        this.noise({
          duration: 0.23,
          volume: 0.028 * intensity,
          filterFrequency: 520,
          filterType: "lowpass",
          pan,
        });
        this.tone({
          frequency: 64,
          endFrequency: 48,
          duration: 0.2,
          volume: 0.04 * intensity,
          type: "sine",
          pan,
        });
        break;
      case "generator":
        this.tone({
          frequency: 110,
          endFrequency: 109.5,
          duration: 0.24,
          volume: 0.037 * intensity,
          type: "sine",
          pan,
          attack: 0.03,
        });
        this.tone({
          frequency: 220,
          endFrequency: 219,
          duration: 0.18,
          volume: 0.014 * intensity,
          type: "sine",
          pan,
          attack: 0.03,
        });
        break;
      case "inserter":
        this.tone({
          frequency: 540,
          endFrequency: 820,
          duration: 0.055,
          volume: 0.032 * intensity,
          type: "triangle",
          pan,
        });
        this.tone({
          frequency: 240,
          endFrequency: 180,
          duration: 0.045,
          volume: 0.025 * intensity,
          delay: 0.065,
          type: "square",
          pan,
        });
        break;
      case "fabricator":
        this.tone({
          frequency: 870,
          endFrequency: 590,
          duration: 0.035,
          volume: 0.027 * intensity,
          type: "square",
          pan,
        });
        this.noise({
          duration: 0.035,
          volume: 0.018 * intensity,
          filterFrequency: 1800,
          filterType: "highpass",
          pan,
          delay: 0.075,
        });
        break;
      default:
        this.tone({
          frequency: 148,
          endFrequency: 112,
          duration: 0.09,
          volume: 0.04 * intensity,
          type: "triangle",
          pan,
        });
        break;
    }
  }

  private playExtractionHit(rawPan: number, rawIntensity: number): void {
    const pan = clamp(rawPan, -1, 1);
    const intensity = clamp(rawIntensity, 0.08, 1);
    this.tone({
      frequency: 86,
      endFrequency: 51,
      duration: 0.095,
      volume: 0.052 * intensity,
      type: "triangle",
      pan,
    });
    this.noise({
      duration: 0.062,
      volume: 0.027 * intensity,
      filterFrequency: 430,
      endFilterFrequency: 230,
      filterType: "bandpass",
      resonance: 2.1,
      pan,
    });
    this.tone({
      frequency: 1260,
      endFrequency: 710,
      duration: 0.041,
      volume: 0.016 * intensity,
      delay: 0.019,
      type: "sine",
      pan,
    });
  }

  private playTransfer(
    kind: TransferAccent,
    rawPan: number,
    rawIntensity: number,
  ): void {
    const pan = clamp(rawPan, -1, 1);
    const intensity = clamp(rawIntensity, 0.06, 1);
    const jitter = 0.96 + Math.random() * 0.08;
    if (kind === "belt") {
      this.noise({
        duration: 0.022,
        volume: 0.014 * intensity,
        filterFrequency: 1650 * jitter,
        filterType: "highpass",
        resonance: 0.65,
        pan,
      });
      this.tone({
        frequency: 390 * jitter,
        endFrequency: 285 * jitter,
        duration: 0.032,
        volume: 0.018 * intensity,
        type: "triangle",
        pan,
      });
      return;
    }

    this.tone({
      frequency: 590 * jitter,
      endFrequency: 850 * jitter,
      duration: 0.047,
      volume: 0.025 * intensity,
      type: "triangle",
      pan,
    });
    this.tone({
      frequency: 188 * jitter,
      endFrequency: 112 * jitter,
      duration: 0.063,
      volume: 0.032 * intensity,
      delay: 0.037,
      type: "square",
      pan,
    });
  }

  private playSmelter(
    phase: SmelterAccent,
    rawPan: number,
    rawIntensity: number,
  ): void {
    const pan = clamp(rawPan, -1, 1);
    const intensity = clamp(rawIntensity, 0.08, 1);
    if (phase === "ignite") {
      this.noise({
        duration: 0.24,
        volume: 0.031 * intensity,
        filterFrequency: 280,
        endFilterFrequency: 1180,
        filterType: "lowpass",
        resonance: 0.55,
        pan,
      });
      this.tone({
        frequency: 49,
        endFrequency: 67,
        duration: 0.22,
        volume: 0.035 * intensity,
        type: "sine",
        attack: 0.025,
        pan,
      });
      return;
    }

    this.tone({
      frequency: 305,
      endFrequency: 172,
      duration: 0.105,
      volume: 0.043 * intensity,
      type: "triangle",
      pan,
    });
    this.noise({
      duration: 0.085,
      volume: 0.027 * intensity,
      filterFrequency: 980,
      endFilterFrequency: 540,
      filterType: "bandpass",
      resonance: 1.4,
      pan,
      delay: 0.018,
    });
    this.tone({
      frequency: 94,
      endFrequency: 57,
      duration: 0.18,
      volume: 0.029 * intensity,
      type: "sine",
      pan,
    });
  }

  private playFabricator(
    phase: FabricatorAccent,
    rawPan: number,
    rawIntensity: number,
  ): void {
    const pan = clamp(rawPan, -1, 1);
    const intensity = clamp(rawIntensity, 0.07, 1);
    const jitter = 0.97 + Math.random() * 0.06;
    if (phase === "arc") {
      this.tone({
        frequency: 1480 * jitter,
        endFrequency: 520 * jitter,
        duration: 0.029,
        volume: 0.018 * intensity,
        type: "sawtooth",
        pan,
      });
      this.noise({
        duration: 0.031,
        volume: 0.02 * intensity,
        filterFrequency: 2250 * jitter,
        filterType: "highpass",
        resonance: 1.2,
        pan,
        delay: 0.008,
      });
      return;
    }

    this.tone({
      frequency: 235 * jitter,
      endFrequency: 318 * jitter,
      duration: 0.071,
      volume: 0.031 * intensity,
      type: "triangle",
      pan,
    });
    this.tone({
      frequency: 690 * jitter,
      endFrequency: 455 * jitter,
      duration: 0.052,
      volume: 0.021 * intensity,
      delay: 0.043,
      type: "square",
      pan,
    });
    this.noise({
      duration: 0.038,
      volume: 0.014 * intensity,
      filterFrequency: 1450,
      filterType: "bandpass",
      resonance: 2,
      delay: 0.048,
      pan,
    });
  }

  private playAutomationCore(rawPan: number): void {
    const pan = clamp(rawPan, -1, 1);
    const relays = [
      { frequency: 146.83, delay: 0, duration: 0.28, volume: 0.037 },
      { frequency: 220, delay: 0.1, duration: 0.34, volume: 0.036 },
      { frequency: 293.66, delay: 0.2, duration: 0.42, volume: 0.034 },
      { frequency: 440, delay: 0.34, duration: 0.52, volume: 0.032 },
      { frequency: 1174.66, delay: 0.42, duration: 0.38, volume: 0.016 },
    ] as const;
    for (const relay of relays) {
      this.tone({
        ...relay,
        endFrequency: relay.frequency * 0.996,
        type: "sine",
        attack: 0.018,
        pan,
      });
    }
    this.noise({
      duration: 0.12,
      volume: 0.025,
      filterFrequency: 1850,
      endFilterFrequency: 620,
      filterType: "bandpass",
      resonance: 2.4,
      delay: 0.08,
      pan,
    });
    this.tone({
      frequency: 55,
      endFrequency: 82.5,
      duration: 0.78,
      volume: 0.052,
      type: "triangle",
      attack: 0.08,
      pan,
    });
  }

  private playPowerTransition(previous: number, next: number): void {
    const recovering = next > previous;
    if (recovering) {
      this.tone({
        frequency: 73,
        endFrequency: 110,
        duration: 0.25,
        volume: 0.033,
        type: "triangle",
        attack: 0.025,
      });
      this.tone({
        frequency: 218,
        endFrequency: 327,
        duration: 0.17,
        volume: 0.018,
        delay: 0.085,
        type: "sine",
      });
      this.noise({
        duration: 0.035,
        volume: 0.013,
        filterFrequency: 1120,
        filterType: "bandpass",
        resonance: 2.5,
        delay: 0.065,
      });
      return;
    }

    this.tone({
      frequency: 62,
      endFrequency: 42,
      duration: 0.37,
      volume: 0.04,
      type: "triangle",
      attack: 0.025,
    });
    this.tone({
      frequency: 182,
      endFrequency: 88,
      duration: 0.18,
      volume: 0.019,
      type: "sawtooth",
    });
    this.noise({
      duration: 0.11,
      volume: 0.016,
      filterFrequency: 390,
      endFilterFrequency: 170,
      filterType: "lowpass",
    });
  }

  private triggerCue(
    key: string,
    cooldownSeconds: number,
    expectedSources: number,
    retry: () => void,
    render: () => void,
    priority = false,
  ): void {
    if (!this.preparePlayback(retry) || this.muted) return;
    const context = this.context;
    if (!context) return;
    const availableLimit = priority
      ? MAX_TRANSIENT_SOURCES
      : MAX_TRANSIENT_SOURCES - 7;
    if (this.transientSources.size + expectedSources > availableLimit) return;
    const now = context.currentTime;
    if ((this.cueCooldowns.get(key) ?? 0) > now) return;
    this.cueCooldowns.set(key, now + cooldownSeconds);
    render();
  }

  private preparePlayback(retry: () => void): boolean {
    if (this.disposed || this.unsupported) return false;
    if (this.context?.state === "running" && this.effectsBus) return true;
    if (
      !this.context &&
      typeof navigator !== "undefined" &&
      navigator.userActivation &&
      !navigator.userActivation.isActive &&
      !navigator.userActivation.hasBeenActive
    ) {
      return false;
    }
    void this.unlock().then((ready) => {
      if (ready && !this.disposed) retry();
    });
    return false;
  }

  private renderNormalizedCue(normalization: number, render: () => void): void {
    const previous = this.activeCueNormalization;
    this.activeCueNormalization = normalization;
    try {
      render();
    } finally {
      this.activeCueNormalization = previous;
    }
  }

  private tone(options: ToneOptions, destination = this.effectsBus): void {
    const context = this.context;
    if (
      !context ||
      context.state !== "running" ||
      !destination ||
      this.transientSources.size >= MAX_TRANSIENT_SOURCES
    ) {
      return;
    }
    const start = context.currentTime + Math.max(0, options.delay ?? 0);
    const duration = Math.max(0.012, options.duration);
    const attack = clamp(options.attack ?? 0.003, 0.001, duration * 0.45);
    const end = start + duration;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const panner = this.createPanner(context, options.pan ?? 0);

    oscillator.type = options.type ?? "sine";
    oscillator.frequency.setValueAtTime(Math.max(1, options.frequency), start);
    if (options.endFrequency !== undefined) {
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(1, options.endFrequency),
        end,
      );
    }
    gain.gain.setValueAtTime(0.0001, start);
    const normalizedVolume =
      options.volume *
      (destination === this.effectsBus ? this.activeCueNormalization : 1);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, normalizedVolume),
      start + attack,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain);
    gain.connect(panner);
    panner.connect(destination);
    this.trackTransient(oscillator, [gain, panner]);
    oscillator.start(start);
    oscillator.stop(end + 0.015);
  }

  private noise(options: NoiseOptions, destination = this.effectsBus): void {
    const context = this.context;
    if (
      !context ||
      context.state !== "running" ||
      !destination ||
      !this.noiseBuffer ||
      this.transientSources.size >= MAX_TRANSIENT_SOURCES
    ) {
      return;
    }
    const start = context.currentTime + Math.max(0, options.delay ?? 0);
    const duration = Math.max(0.012, options.duration);
    const end = start + duration;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const panner = this.createPanner(context, options.pan ?? 0);
    source.buffer = this.noiseBuffer;
    source.playbackRate.value = 0.82 + Math.random() * 0.36;
    filter.type = options.filterType ?? "bandpass";
    filter.frequency.setValueAtTime(
      Math.max(20, options.filterFrequency),
      start,
    );
    if (options.endFilterFrequency !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(20, options.endFilterFrequency),
        end,
      );
    }
    filter.Q.value = Math.max(0.0001, options.resonance ?? 0.8);
    gain.gain.setValueAtTime(0.0001, start);
    const normalizedVolume =
      options.volume *
      (destination === this.effectsBus ? this.activeCueNormalization : 1);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, normalizedVolume),
      start + 0.003,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    source.connect(filter).connect(gain).connect(panner).connect(destination);
    this.trackTransient(source, [filter, gain, panner]);
    source.start(start, Math.random() * Math.max(0.001, this.noiseBuffer.duration - duration));
    source.stop(end + 0.015);
  }

  private createPanner(context: AudioContext, pan: number): StereoPannerNode {
    const panner = context.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);
    return panner;
  }

  private trackTransient(
    source: AudioScheduledSourceNode,
    downstreamNodes: readonly AudioNode[],
  ): void {
    this.transientSources.add(source);
    source.addEventListener(
      "ended",
      () => {
        this.transientSources.delete(source);
        source.disconnect();
        for (const node of downstreamNodes) node.disconnect();
      },
      { once: true },
    );
  }

  private applyMasterLevel(): void {
    const context = this.context;
    const master = this.masterBus;
    if (!context || !master || context.state === "closed") return;
    master.gain.cancelScheduledValues(context.currentTime);
    master.gain.setTargetAtTime(
      this.muted ? 0 : this.masterVolume,
      context.currentTime,
      0.012,
    );
  }

  private applyAmbientLevel(): void {
    const context = this.context;
    const ambient = this.ambientBus;
    if (!context || !ambient || context.state === "closed") return;
    ambient.gain.cancelScheduledValues(context.currentTime);
    ambient.gain.setTargetAtTime(
      this.ambientEnabled ? this.ambientVolume : 0,
      context.currentTime,
      0.08,
    );
  }

  private applyGridBed(): void {
    const context = this.context;
    const gain = this.gridBedGain;
    const filter = this.gridBedFilter;
    if (!context || !gain || !filter || context.state === "closed") return;
    const now = context.currentTime;
    const satisfaction = clamp(this.gridSatisfaction, 0, 1);
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(
      0.0035 + satisfaction * 0.0105,
      now,
      0.32,
    );
    filter.frequency.cancelScheduledValues(now);
    filter.frequency.setTargetAtTime(78 + satisfaction * 42, now, 0.42);
  }

  private disarm(): void {
    const target = this.gestureTarget;
    if (!target) return;
    target.removeEventListener("pointerdown", this.gestureHandler);
    target.removeEventListener("touchstart", this.gestureHandler);
    target.removeEventListener("keydown", this.gestureHandler);
    this.gestureTarget = null;
  }
}

export { AudioEngine as FactoryAudio };
export default AudioEngine;
