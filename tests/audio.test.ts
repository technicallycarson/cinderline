import { afterEach, describe, expect, it } from "vitest";

import { AudioEngine, DEFAULT_AUDIO_MIX } from "../src/game/audio";

class FakeAudioParam {
  value = 0;
  readonly targets: Array<{ value: number; start: number; constant: number }> = [];
  readonly exponentialRamps: Array<{ value: number; end: number }> = [];

  setValueAtTime(value: number): void {
    this.value = value;
  }

  exponentialRampToValueAtTime(value: number, end: number): void {
    this.value = value;
    this.exponentialRamps.push({ value, end });
  }

  cancelScheduledValues(): void {}

  setTargetAtTime(value: number, start: number, constant: number): void {
    this.value = value;
    this.targets.push({ value, start, constant });
  }
}

class FakeAudioNode {
  readonly connections: unknown[] = [];
  disconnected = false;

  connect(destination: unknown): unknown {
    this.connections.push(destination);
    return destination;
  }

  disconnect(): void {
    this.disconnected = true;
  }
}

class FakeGainNode extends FakeAudioNode {
  readonly gain = new FakeAudioParam();
}

class FakeDynamicsCompressorNode extends FakeAudioNode {
  readonly threshold = new FakeAudioParam();
  readonly knee = new FakeAudioParam();
  readonly ratio = new FakeAudioParam();
  readonly attack = new FakeAudioParam();
  readonly release = new FakeAudioParam();
}

class FakeWaveShaperNode extends FakeAudioNode {
  curve: Float32Array<ArrayBuffer> | null = null;
  oversample: OverSampleType = "none";
}

class FakeAnalyserNode extends FakeAudioNode {
  fftSize = 2_048;
  smoothingTimeConstant = 0;

  get frequencyBinCount(): number {
    return this.fftSize / 2;
  }

  getFloatTimeDomainData(values: Float32Array): void {
    values.fill(0);
  }

  getFloatFrequencyData(values: Float32Array): void {
    values.fill(-120);
  }
}

class FakeBiquadFilterNode extends FakeAudioNode {
  type: BiquadFilterType = "lowpass";
  readonly frequency = new FakeAudioParam();
  readonly Q = new FakeAudioParam();
}

class FakeStereoPannerNode extends FakeAudioNode {
  readonly pan = new FakeAudioParam();
}

class FakeScheduledSourceNode extends FakeAudioNode {
  private ended: (() => void) | null = null;

  addEventListener(type: string, listener: () => void): void {
    if (type === "ended") this.ended = listener;
  }

  start(): void {}
  stop(): void {}
}

class FakeOscillatorNode extends FakeScheduledSourceNode {
  type: OscillatorType = "sine";
  readonly frequency = new FakeAudioParam();
  readonly detune = new FakeAudioParam();
}

class FakeAudioBuffer {
  readonly duration: number;
  private readonly samples: Float32Array<ArrayBuffer>;

  constructor(length: number, sampleRate: number) {
    this.duration = length / sampleRate;
    this.samples = new Float32Array(length);
  }

  getChannelData(): Float32Array<ArrayBuffer> {
    return this.samples;
  }
}

class FakeAudioBufferSourceNode extends FakeScheduledSourceNode {
  buffer: FakeAudioBuffer | null = null;
  loop = false;
  readonly playbackRate = new FakeAudioParam();
}

class FakeAudioContext {
  state: AudioContextState = "suspended";
  currentTime = 0;
  readonly sampleRate = 48_000;
  readonly destination = new FakeAudioNode();
  onstatechange: (() => void) | null = null;
  readonly gains: FakeGainNode[] = [];
  readonly compressors: FakeDynamicsCompressorNode[] = [];
  readonly waveShapers: FakeWaveShaperNode[] = [];
  readonly analysers: FakeAnalyserNode[] = [];
  readonly panners: FakeStereoPannerNode[] = [];
  readonly oscillators: FakeOscillatorNode[] = [];
  readonly bufferSources: FakeAudioBufferSourceNode[] = [];

  createGain(): FakeGainNode {
    const node = new FakeGainNode();
    this.gains.push(node);
    return node;
  }

  createDynamicsCompressor(): FakeDynamicsCompressorNode {
    const node = new FakeDynamicsCompressorNode();
    this.compressors.push(node);
    return node;
  }

  createWaveShaper(): FakeWaveShaperNode {
    const node = new FakeWaveShaperNode();
    this.waveShapers.push(node);
    return node;
  }

  createAnalyser(): FakeAnalyserNode {
    const node = new FakeAnalyserNode();
    this.analysers.push(node);
    return node;
  }

  createBiquadFilter(): FakeBiquadFilterNode {
    return new FakeBiquadFilterNode();
  }

  createStereoPanner(): FakeStereoPannerNode {
    const node = new FakeStereoPannerNode();
    this.panners.push(node);
    return node;
  }

  createOscillator(): FakeOscillatorNode {
    const node = new FakeOscillatorNode();
    this.oscillators.push(node);
    return node;
  }

  createBufferSource(): FakeAudioBufferSourceNode {
    const node = new FakeAudioBufferSourceNode();
    this.bufferSources.push(node);
    return node;
  }

  createBuffer(_channels: number, length: number, sampleRate: number): FakeAudioBuffer {
    return new FakeAudioBuffer(length, sampleRate);
  }

  async resume(): Promise<void> {
    this.state = "running";
    this.onstatechange?.();
  }

  async close(): Promise<void> {
    this.state = "closed";
  }
}

const originalAudioContextDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "AudioContext",
);

function installFakeAudioContext(): void {
  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    writable: true,
    value: FakeAudioContext,
  });
}

afterEach(() => {
  if (originalAudioContextDescriptor) {
    Object.defineProperty(
      globalThis,
      "AudioContext",
      originalAudioContextDescriptor,
    );
  } else {
    Reflect.deleteProperty(globalThis, "AudioContext");
  }
});

describe("AudioEngine shipping mix", () => {
  it("raises the shared SFX path while holding ambience near the old level", () => {
    const audio = new AudioEngine({ autoArm: false, ambientEnabled: false });
    const mix = audio.mixDiagnostics;

    expect(DEFAULT_AUDIO_MIX).toEqual({
      masterVolume: 0.88,
      ambientVolume: 0.22,
      effectsVolume: 0.96,
    });
    expect(mix.nominalEffectsGain).toBeCloseTo(1.14048, 6);
    expect(mix.effectsBoostDecibels).toBeGreaterThanOrEqual(8.3);
    expect(mix.effectsBoostDecibels).toBeLessThan(8.4);
    expect(Math.abs(mix.ambientChangeDecibels)).toBeLessThan(0.25);
    expect(mix.effectsSeparationGainDecibels).toBeGreaterThan(8.6);
  });

  it("keeps a deterministic -0.90 dBFS output ceiling with a linear normal range", async () => {
    installFakeAudioContext();
    const audio = new AudioEngine({ autoArm: false, ambientEnabled: false });

    await expect(audio.unlock()).resolves.toBe(true);
    const internals = audio as unknown as {
      context: FakeAudioContext;
      outputCeiling: FakeGainNode;
    };
    const context = internals.context;
    const compressor = context.compressors[0]!;
    const shaper = context.waveShapers[0]!;
    const output = internals.outputCeiling;
    const curve = shaper.curve!;

    expect(compressor.threshold.value).toBe(-8);
    expect(compressor.knee.value).toBe(4);
    expect(compressor.ratio.value).toBe(12);
    expect(compressor.attack.value).toBe(0.002);
    expect(compressor.release.value).toBe(0.11);
    expect(shaper.oversample).toBe("none");
    expect(Math.max(...curve)).toBeLessThanOrEqual(0.980001);
    expect(Math.min(...curve)).toBeGreaterThanOrEqual(-0.980001);

    const linearIndex = Math.round(((0.5 + 1) / 2) * (curve.length - 1));
    const linearInput = (linearIndex / (curve.length - 1)) * 2 - 1;
    expect(curve[linearIndex]).toBeCloseTo(linearInput, 6);
    expect(output.gain.value).toBe(0.9);
    expect(audio.mixDiagnostics.maximumOutputPeak).toBeCloseTo(0.882, 6);
    expect(audio.mixDiagnostics.maximumOutputPeakDecibels).toBeCloseTo(-1.09, 2);
    expect(audio.mixDiagnostics.maximumOutputPeak).toBeLessThan(0.89);
    expect(audio.sampleOutput()).toMatchObject({
      peak: 0,
      rms: 0,
      clippedSamples: 0,
      sampleCount: 32_768,
      usefulBandPeakDecibels: -120,
    });

    audio.dispose();
  });

  it("wires procedural cues through the boosted SFX bus and preserves mute", async () => {
    installFakeAudioContext();
    const audio = new AudioEngine({ autoArm: false, ambientEnabled: false });
    await audio.unlock();
    const internals = audio as unknown as {
      context: FakeAudioContext;
      masterBus: FakeGainNode;
      ambientBus: FakeGainNode;
      effectsBus: FakeGainNode;
      outputCeiling: FakeGainNode;
      outputAnalyser: FakeAnalyserNode;
    };
    const context = internals.context;
    const master = internals.masterBus;
    const ambient = internals.ambientBus;
    const effects = internals.effectsBus;
    const output = internals.outputCeiling;
    const analyser = internals.outputAnalyser;

    expect(master?.gain.value).toBe(0.88);
    expect(ambient?.gain.value).toBe(0);
    expect(effects?.gain.value).toBeCloseTo(1.44, 6);
    expect(output?.gain.value).toBe(0.9);
    expect(effects?.connections).toEqual([master]);
    expect(master?.connections).toEqual([context.compressors[0]]);
    expect(context.compressors[0]?.connections).toEqual([context.waveShapers[0]]);
    expect(context.waveShapers[0]?.connections).toEqual([output]);
    expect(output?.connections).toEqual([analyser]);
    expect(analyser.connections).toEqual([context.destination]);

    audio.placed(0.25, 1);
    expect(context.panners).toHaveLength(3);
    for (const panner of context.panners) {
      expect(panner.connections).toEqual([effects]);
    }
    const placementEnvelopePeaks = context.gains
      .slice(4, 7)
      .map((gain) => gain.gain.exponentialRamps[0]?.value);
    expect(placementEnvelopePeaks).toEqual([
      0.13 * 2.8,
      0.045 * 2.8,
      0.026 * 2.8,
    ]);

    audio.transfer("inserter", 0, 0.35);
    const inserterEnvelopePeaks = context.gains
      .slice(7, 9)
      .map((gain) => gain.gain.exponentialRamps[0]?.value);
    expect(inserterEnvelopePeaks[0]).toBeCloseTo(0.025 * 0.35 * 12, 6);
    expect(inserterEnvelopePeaks[1]).toBeCloseTo(0.032 * 0.35 * 12, 6);

    audio.rotate(0);
    const rotateEnvelopePeaks = context.gains
      .slice(9, 11)
      .map((gain) => gain.gain.exponentialRamps[0]?.value);
    expect(rotateEnvelopePeaks[0]).toBeCloseTo(0.042 * 10.25, 6);
    expect(rotateEnvelopePeaks[1]).toBeCloseTo(0.035 * 10.25, 6);

    expect(audio.setMuted(true)).toBe(true);
    expect(master?.gain.targets.at(-1)?.value).toBe(0);
    expect(master?.gain.targets.at(-1)?.constant).toBe(0.012);
    expect(audio.toggleMute()).toBe(false);
    expect(master?.gain.targets.at(-1)?.value).toBe(0.88);

    audio.dispose();
  });
});
