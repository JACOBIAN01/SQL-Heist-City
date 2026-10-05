/**
 * Just enough of Web Audio for tests (jsdom has none): nodes record what they
 * are connected to and what was started, stopped and set, so a test can
 * follow a sound from its source to the speakers.
 */
class FakeParam {
  value: number;
  readonly targets: number[] = [];
  constructor(value = 0) {
    this.value = value;
  }
  setTargetAtTime(value: number): this {
    this.targets.push(value);
    this.value = value;
    return this;
  }
}

export class FakeNode {
  readonly outputs: FakeNode[] = [];
  constructor(readonly kind: string) {}
  connect(node: FakeNode): FakeNode {
    this.outputs.push(node);
    return node;
  }
  disconnect(): void {
    this.outputs.length = 0;
  }
  /** Whether this node's signal reaches `target` by any path. */
  reaches(target: FakeNode, seen = new Set<FakeNode>()): boolean {
    if (this === target) return true;
    if (seen.has(this)) return false;
    seen.add(this);
    return this.outputs.some((n) => n.reaches(target, seen));
  }
}

export class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);
  constructor() {
    super('gain');
  }
}

export class FakeSource extends FakeNode {
  buffer: AudioBuffer | null = null;
  loop = false;
  readonly playbackRate = new FakeParam(1);
  started = false;
  stoppedAt: number | undefined;
  onended: (() => void) | null = null;
  constructor() {
    super('source');
  }
  start(): void {
    this.started = true;
  }
  stop(when = 0): void {
    this.stoppedAt = when;
  }
}

export class FakePanner extends FakeNode {
  panningModel = '';
  distanceModel = '';
  refDistance = 1;
  rolloffFactor = 1;
  maxDistance = 10_000;
  readonly positionX = new FakeParam();
  readonly positionY = new FakeParam();
  readonly positionZ = new FakeParam();
  constructor() {
    super('panner');
  }
}

const param = () => new FakeParam();

export class FakeAudioContext {
  currentTime = 0;
  readonly destination = new FakeNode('destination');
  readonly sources: FakeSource[] = [];
  readonly panners: FakePanner[] = [];
  readonly listener = {
    positionX: param(),
    positionY: param(),
    positionZ: param(),
    forwardX: param(),
    forwardY: param(),
    forwardZ: param(),
    upX: param(),
    upY: param(),
    upZ: param(),
  };
  createGain(): FakeGain {
    return new FakeGain();
  }
  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  createPanner(): FakePanner {
    const panner = new FakePanner();
    this.panners.push(panner);
    return panner;
  }
  createDelay(): FakeNode & { delayTime: FakeParam } {
    return Object.assign(new FakeNode('delay'), { delayTime: param() });
  }
  createBiquadFilter(): FakeNode & { type: string; frequency: FakeParam } {
    return Object.assign(new FakeNode('filter'), { type: '', frequency: param() });
  }
  createBuffer(_channels: number, length: number, sampleRate: number): AudioBuffer {
    const data = new Float32Array(length);
    return {
      length,
      sampleRate,
      duration: length / sampleRate,
      numberOfChannels: 1,
      getChannelData: () => data,
    } as unknown as AudioBuffer;
  }
  /** The sources currently playing (started, not stopped). */
  get playing(): FakeSource[] {
    return this.sources.filter((s) => s.started && s.stoppedAt === undefined);
  }
  /** As the real AudioContext, for the engine's constructor. */
  asContext(): AudioContext {
    return this as unknown as AudioContext;
  }
}
