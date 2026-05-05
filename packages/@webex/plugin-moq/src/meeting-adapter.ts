import {EventEmitter} from 'events';
import type MoqPlugin from './moq';
import type {MoqPublishConfig} from './types';
import type {LocalStream, LocalStreams, LocalVideoStream, LocalAudioStream} from './local-stream';

export interface MeetingAdapterConfig {
  namespace: string[];
  participantId: string;
  mediaConfig?: Partial<MoqPublishConfig>;
}

interface PublishedTrack {
  publicationId: string;
  kind: 'video' | 'audio';
  localStream: LocalStream;
  cleanups: Array<() => void>;
}

type MeetingAdapterState = 'idle' | 'active' | 'closed';

export class MoqMeetingAdapter extends EventEmitter {
  private _moq: MoqPlugin;
  private _config: MeetingAdapterConfig;
  private _published = new Map<string, PublishedTrack>();
  private _state: MeetingAdapterState = 'idle';

  constructor(moq: MoqPlugin, config: MeetingAdapterConfig) {
    super();
    this._moq = moq;
    this._config = config;
  }

  get state(): MeetingAdapterState {
    return this._state;
  }

  async publishStreams(streams: LocalStreams): Promise<void> {
    this._state = 'active';

    const tasks: Promise<void>[] = [];

    if (streams.camera) {
      tasks.push(this.publishLocalStream(streams.camera, 'video', 'camera'));
    }
    if (streams.microphone) {
      tasks.push(this.publishLocalStream(streams.microphone, 'audio', 'microphone'));
    }
    if (streams.screenShare?.video) {
      tasks.push(this.publishLocalStream(streams.screenShare.video, 'video', 'screenshare-video'));
    }
    if (streams.screenShare?.audio) {
      tasks.push(this.publishLocalStream(streams.screenShare.audio, 'audio', 'screenshare-audio'));
    }

    await Promise.all(tasks);
  }

  async unpublishStreams(streams: LocalStream[]): Promise<void> {
    const tasks: Promise<void>[] = [];

    for (const stream of streams) {
      const entry = this.findPublishedByStream(stream);
      if (entry) {
        tasks.push(this.unpublishTrack(entry[0]));
      }
    }

    await Promise.all(tasks);
  }

  async unpublishAll(): Promise<void> {
    const keys = [...this._published.keys()];
    await Promise.all(keys.map((key) => this.unpublishTrack(key)));
    this._state = 'idle';
  }

  async close(): Promise<void> {
    await this.unpublishAll();
    this._state = 'closed';
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async publishLocalStream(
    localStream: LocalStream,
    kind: 'video' | 'audio',
    slot: string
  ): Promise<void> {
    const trackName = `${this._config.participantId}/${slot}`;
    const existing = this._published.get(trackName);

    if (existing) {
      if (existing.localStream === localStream) return;
      await this.unpublishTrack(trackName);
    }

    const mediaConfig = this.buildMediaConfigForKind(kind);

    const result = await this._moq.publish({
      namespace: this._config.namespace,
      trackName,
      stream: localStream.outputStream,
      mediaConfig,
    });

    const cleanups: Array<() => void> = [];
    this.wireLocalStreamEvents(localStream, trackName, kind, cleanups);

    this._published.set(trackName, {
      publicationId: result.id,
      kind,
      localStream,
      cleanups,
    });

    this.emit('published', {trackName, kind, publicationId: result.id});
  }

  private async unpublishTrack(trackName: string): Promise<void> {
    const entry = this._published.get(trackName);
    if (!entry) return;

    for (const cleanup of entry.cleanups) {
      cleanup();
    }

    await this._moq.unpublish(entry.publicationId);
    this._published.delete(trackName);

    this.emit('unpublished', {trackName, kind: entry.kind});
  }

  private wireLocalStreamEvents(
    localStream: LocalStream,
    trackName: string,
    kind: 'video' | 'audio',
    cleanups: Array<() => void>
  ): void {
    const onEnded = () => {
      this.unpublishTrack(trackName);
    };
    localStream.on('stream-ended', onEnded);
    cleanups.push(() => localStream.off('stream-ended', onEnded));

    const onTrackChange = (_track: MediaStreamTrack) => {
      this.emit('track-replaced', {trackName, kind});
    };
    localStream.on('output-track-change', onTrackChange);
    cleanups.push(() => localStream.off('output-track-change', onTrackChange));
  }

  private buildMediaConfigForKind(kind: 'video' | 'audio'): Partial<MoqPublishConfig> {
    const base = this._config.mediaConfig ?? {};

    if (kind === 'video') {
      return {
        ...base,
        videoEnabled: true,
        audioEnabled: false,
      };
    }

    return {
      ...base,
      videoEnabled: false,
      audioEnabled: true,
      audioDeliveryMode: 'datagram',
    };
  }

  private findPublishedByStream(stream: LocalStream): [string, PublishedTrack] | undefined {
    for (const [key, entry] of this._published) {
      if (entry.localStream === stream) {
        return [key, entry];
      }
    }

    return undefined;
  }
}
