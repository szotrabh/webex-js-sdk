export interface TrackEntry {
  subscriptionId: number;
  trackName: string;
  kind: 'video' | 'audio';
  generator: any;
  writer: any;
  stream: MediaStream;
}

type GeneratorFactory = (opts: {kind: string}) => any;
type MediaStreamFactory = (tracks: any[]) => MediaStream;

function defaultGeneratorFactory(opts: {kind: string}): any {
  return new (globalThis as any).MediaStreamTrackGenerator(opts);
}

function defaultMediaStreamFactory(tracks: any[]): MediaStream {
  return new MediaStream(tracks);
}

export class StreamBridge {
  private bySubscriptionId = new Map<number, TrackEntry>();
  private byTrackName = new Map<string, TrackEntry>();
  private createGenerator: GeneratorFactory;
  private createMediaStream: MediaStreamFactory;

  constructor(generatorFactory?: GeneratorFactory, mediaStreamFactory?: MediaStreamFactory) {
    this.createGenerator = generatorFactory ?? defaultGeneratorFactory;
    this.createMediaStream = mediaStreamFactory ?? defaultMediaStreamFactory;
  }

  addTrack(subscriptionId: number, kind: 'video' | 'audio', trackName: string): TrackEntry {
    if (this.bySubscriptionId.has(subscriptionId)) {
      throw new Error(`Track already exists for subscriptionId ${subscriptionId}`);
    }

    const generator = this.createGenerator({kind});
    const writer = generator.writable.getWriter();
    const stream = this.createMediaStream([generator]);

    const entry: TrackEntry = {
      subscriptionId,
      trackName,
      kind,
      generator,
      writer,
      stream,
    };

    this.bySubscriptionId.set(subscriptionId, entry);
    this.byTrackName.set(trackName, entry);

    return entry;
  }

  async writeFrame(subscriptionId: number, frame: VideoFrame | AudioData): Promise<void> {
    const entry = this.bySubscriptionId.get(subscriptionId);
    if (!entry) return;
    await entry.writer.write(frame);
  }

  async removeTrack(subscriptionId: number): Promise<void> {
    const entry = this.bySubscriptionId.get(subscriptionId);
    if (!entry) return;

    try {
      await entry.writer.close();
    } catch {
      // writer may already be closed
    }
    entry.generator.stop();

    this.bySubscriptionId.delete(subscriptionId);
    this.byTrackName.delete(entry.trackName);
  }

  getEntry(subscriptionId: number): TrackEntry | undefined {
    return this.bySubscriptionId.get(subscriptionId);
  }

  getStream(trackName: string): MediaStream | undefined {
    return this.byTrackName.get(trackName)?.stream;
  }

  getAllStreams(): Map<string, MediaStream> {
    const result = new Map<string, MediaStream>();
    for (const [name, entry] of this.byTrackName) {
      result.set(name, entry.stream);
    }

    return result;
  }

  async removeAll(): Promise<void> {
    const ids = [...this.bySubscriptionId.keys()];
    await Promise.all(ids.map((id) => this.removeTrack(id)));
  }
}
