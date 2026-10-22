import {EventEmitter} from 'events';
import {createMSFSession, type MSFSessionConfig} from '@moq-web/msf';
import type {MOQTSession} from '@moq-web/session';

export interface DiscoveredTrack {
  name: string;
  namespace: string[];
  kind: 'video' | 'audio';
  codec?: string;
  width?: number;
  height?: number;
  framerate?: number;
  samplerate?: number;
  channelConfig?: string;
  bitrate?: number;
  renderGroup?: number;
  raw: MsfRawTrack | null;
}

export interface MsfRawTrack {
  codec?: string;
  width?: number;
  height?: number;
  framerate?: number;
  samplerate?: number;
  channelConfig?: string;
  bitrate?: number;
  renderGroup?: number;
  [key: string]: unknown;
}

interface MsfTrackInfo {
  name: string;
  namespace: string[];
  track: MsfRawTrack;
}

interface MsfSession {
  subscribeCatalog(
    onCatalog: (catalog: unknown) => void,
    onError: (error: Error) => void
  ): Promise<void>;
  findVideoTracks(): MsfTrackInfo[];
  findAudioTracks(): MsfTrackInfo[];
}

export type MsfSessionFactory = (
  session: MOQTSession,
  namespace: string[],
  config?: MSFSessionConfig
) => MsfSession;

function defaultMsfSessionFactory(
  session: MOQTSession,
  namespace: string[],
  config?: MSFSessionConfig
): MsfSession {
  return createMSFSession(session, namespace, config) as MsfSession;
}

export class CatalogManager extends EventEmitter {
  private msfSession: MsfSession | null = null;
  private discoveredTracks: DiscoveredTrack[] = [];
  private createMsfSession: MsfSessionFactory;

  constructor(msfSessionFactory?: MsfSessionFactory) {
    super();
    this.createMsfSession = msfSessionFactory ?? defaultMsfSessionFactory;
  }

  async start(moqtSession: MOQTSession, namespace: string[]): Promise<void> {
    this.msfSession = this.createMsfSession(moqtSession, namespace);

    await this.msfSession.subscribeCatalog(
      (catalog: unknown) => {
        this.handleCatalog(catalog);
      },
      (error: Error) => {
        this.emit('error', error);
      }
    );
  }

  private handleCatalog(_catalog: unknown): void {
    const videoTracks = this.msfSession!.findVideoTracks();
    const audioTracks = this.msfSession!.findAudioTracks();

    const discovered: DiscoveredTrack[] = [];

    for (const trackInfo of videoTracks) {
      discovered.push({
        name: trackInfo.name,
        namespace: trackInfo.namespace,
        kind: 'video',
        codec: trackInfo.track.codec,
        width: trackInfo.track.width,
        height: trackInfo.track.height,
        framerate: trackInfo.track.framerate,
        bitrate: trackInfo.track.bitrate,
        renderGroup: trackInfo.track.renderGroup,
        raw: trackInfo.track,
      });
    }

    for (const trackInfo of audioTracks) {
      discovered.push({
        name: trackInfo.name,
        namespace: trackInfo.namespace,
        kind: 'audio',
        codec: trackInfo.track.codec,
        samplerate: trackInfo.track.samplerate,
        channelConfig: trackInfo.track.channelConfig,
        bitrate: trackInfo.track.bitrate,
        renderGroup: trackInfo.track.renderGroup,
        raw: trackInfo.track,
      });
    }

    this.discoveredTracks = discovered;
    this.emit('tracks-discovered', discovered);
  }

  getTracks(): DiscoveredTrack[] {
    return [...this.discoveredTracks];
  }

  stop(): void {
    this.discoveredTracks = [];
    this.msfSession = null;
    this.removeAllListeners();
  }
}
