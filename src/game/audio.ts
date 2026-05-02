export class GameAudio {
  private context: AudioContext | null = null;
  private enabled = true;
  private lastMovePulse = 0;

  get muted(): boolean {
    return !this.enabled;
  }

  setMuted(muted: boolean): void {
    this.enabled = !muted;
  }

  dispose(): void {
    void this.context?.close();
    this.context = null;
  }

  unlock(): void {
    void this.ensureContext()?.resume();
  }

  ui(): void {
    this.tone({ frequency: 560, endFrequency: 760, duration: 0.045, type: "triangle", gain: 0.022 });
  }

  move(now: number): void {
    if (now - this.lastMovePulse < 180) return;
    this.lastMovePulse = now;
    this.tone({ frequency: 58, endFrequency: 46, duration: 0.075, type: "sawtooth", gain: 0.018 });
    this.noise({ duration: 0.045, gain: 0.012, filter: 220 });
  }

  shoot(): void {
    this.tone({ frequency: 190, endFrequency: 42, duration: 0.11, type: "square", gain: 0.052 });
    this.noise({ duration: 0.075, gain: 0.044, filter: 1100 });
  }

  steel(): void {
    this.tone({ frequency: 920, endFrequency: 1380, duration: 0.055, type: "triangle", gain: 0.038 });
    this.tone({ frequency: 1640, endFrequency: 1040, duration: 0.07, type: "sine", gain: 0.02, delay: 0.018 });
    this.noise({ duration: 0.035, gain: 0.014, filter: 2600 });
  }

  brick(): void {
    this.noise({ duration: 0.2, gain: 0.065, filter: 700 });
    this.tone({ frequency: 112, endFrequency: 38, duration: 0.14, type: "sawtooth", gain: 0.04 });
  }

  hit(): void {
    this.noise({ duration: 0.34, gain: 0.095, filter: 470 });
    this.tone({ frequency: 86, endFrequency: 28, duration: 0.26, type: "triangle", gain: 0.068 });
    this.tone({ frequency: 43, endFrequency: 24, duration: 0.32, type: "sawtooth", gain: 0.036, delay: 0.025 });
  }

  respawn(): void {
    this.tone({ frequency: 280, endFrequency: 480, duration: 0.08, type: "triangle", gain: 0.03 });
    this.tone({ frequency: 480, endFrequency: 820, duration: 0.1, type: "triangle", gain: 0.026, delay: 0.07 });
    this.tone({ frequency: 820, endFrequency: 1180, duration: 0.12, type: "sine", gain: 0.022, delay: 0.15 });
  }

  private ensureContext(): AudioContext | null {
    if (!this.enabled) return null;
    this.context ??= new AudioContext();
    return this.context;
  }

  private tone({
    frequency,
    endFrequency,
    duration,
    type,
    gain,
    delay = 0,
  }: {
    frequency: number;
    endFrequency: number;
    duration: number;
    type: OscillatorType;
    gain: number;
    delay?: number;
  }): void {
    const context = this.ensureContext();
    if (!context) return;

    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const volume = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), start + duration);
    volume.gain.setValueAtTime(gain, start);
    volume.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(volume).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration);
  }

  private noise({ duration, gain, filter }: { duration: number; gain: number; filter: number }): void {
    const context = this.ensureContext();
    if (!context) return;

    const sampleCount = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, sampleCount, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < sampleCount; index += 1) {
      const envelope = 1 - index / sampleCount;
      data[index] = (Math.random() * 2 - 1) * envelope * envelope;
    }

    const source = context.createBufferSource();
    const volume = context.createGain();
    const lowpass = context.createBiquadFilter();
    source.buffer = buffer;
    lowpass.type = "lowpass";
    lowpass.frequency.value = filter;
    volume.gain.setValueAtTime(gain, context.currentTime);
    volume.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    source.connect(lowpass).connect(volume).connect(context.destination);
    source.start();
  }
}
