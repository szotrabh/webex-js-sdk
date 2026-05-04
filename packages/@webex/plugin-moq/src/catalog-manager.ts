/* eslint-disable require-jsdoc */
import {EventEmitter} from 'events';

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
  raw: any;
}

type MsfSessionFactory = (session: any, namespace: string[], config?: any) => any;

function defaultMsfSessionFactory(session: any, namespace: string[], config?: any): any {
  // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
  const {createMSFSession} = require('@web-moq/msf');

  return createMSFSession(session, namespace, config);
}

export class CatalogManager extends EventEmitter {
  private msfSession: any = null;
  private discoveredTracks: DiscoveredTrack[] = [];
  private createMsfSession: MsfSessionFactory;

  constructor(msfSessionFactory?: MsfSessionFactory) {
    super();
    this.createMsfSession = msfSessionFactory ?? defaultMsfSessionFactory;
  }

  async start(moqtSession: any, namespace: string[]): Promise<void> {
    this.msfSession = this.createMsfSession(moqtSession, namespace);

    await this.msfSession.subscribeCatalog(
      (catalog: any) => {
        this.handleCatalog(catalog);
      },
      (error: Error) => {
        this.emit('error', error);
      }
    );
  }

  private handleCatalog(_catalog: any): void {
    const videoTracks = this.msfSession.findVideoTracks();
    const audioTracks = this.msfSession.findAudioTracks();

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
