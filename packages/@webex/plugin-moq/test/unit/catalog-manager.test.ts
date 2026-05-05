import {CatalogManager} from '../../src/catalog-manager';
import type {DiscoveredTrack} from '../../src/catalog-manager';

function makeMockMsfSession(catalogTracks: any[] = []) {
  let onCatalogCb: any;
  return {
    subscribeCatalog: jest.fn(async (onCatalog: any, _onError?: any) => {
      onCatalogCb = onCatalog;
    }),
    getTracks: jest.fn(() =>
      catalogTracks.map((t) => ({
        namespace: ['webinar', 'session-1'],
        name: t.name,
        track: t,
      }))
    ),
    findVideoTracks: jest.fn(() =>
      catalogTracks
        .filter((t) => t.width !== undefined)
        .map((t) => ({
          namespace: ['webinar', 'session-1'],
          name: t.name,
          track: t,
        }))
    ),
    findAudioTracks: jest.fn(() =>
      catalogTracks
        .filter((t) => t.samplerate !== undefined)
        .map((t) => ({
          namespace: ['webinar', 'session-1'],
          name: t.name,
          track: t,
        }))
    ),
    _fireCatalog(catalog: any, isIndependent: boolean) {
      onCatalogCb(catalog, isIndependent);
    },
  };
}

const videoTrack = {
  name: 'speaker/video',
  packaging: 'loc',
  isLive: true,
  codec: 'avc1.4D401E',
  width: 1280,
  height: 720,
  framerate: 30,
  bitrate: 2_000_000,
};

const audioTrack = {
  name: 'speaker/audio',
  packaging: 'loc',
  isLive: true,
  codec: 'opus',
  samplerate: 48000,
  channelConfig: 'stereo',
  bitrate: 128_000,
};

describe('CatalogManager', () => {
  let manager: CatalogManager;
  let mockMsfSession: ReturnType<typeof makeMockMsfSession>;

  beforeEach(() => {
    mockMsfSession = makeMockMsfSession([videoTrack, audioTrack]);
    manager = new CatalogManager(() => mockMsfSession as any);
  });

  describe('start', () => {
    it('subscribes to the catalog', async () => {
      const onTracks = jest.fn();
      manager.on('tracks-discovered', onTracks);

      await manager.start({} as any, ['webinar', 'session-1']);

      expect(mockMsfSession.subscribeCatalog).toHaveBeenCalledTimes(1);
    });

    it('emits tracks-discovered when catalog arrives', async () => {
      const onTracks = jest.fn();
      manager.on('tracks-discovered', onTracks);

      await manager.start({} as any, ['webinar', 'session-1']);

      mockMsfSession._fireCatalog(
        {version: 1, tracks: [videoTrack, audioTrack]},
        true
      );

      expect(onTracks).toHaveBeenCalledTimes(1);
      const tracks: DiscoveredTrack[] = onTracks.mock.calls[0][0];
      expect(tracks).toHaveLength(2);
      expect(tracks[0].name).toBe('speaker/video');
      expect(tracks[0].kind).toBe('video');
      expect(tracks[1].name).toBe('speaker/audio');
      expect(tracks[1].kind).toBe('audio');
    });
  });

  describe('track classification', () => {
    it('identifies video tracks by width/height', async () => {
      const onTracks = jest.fn();
      manager.on('tracks-discovered', onTracks);

      await manager.start({} as any, ['webinar', 'session-1']);
      mockMsfSession._fireCatalog({version: 1, tracks: [videoTrack]}, true);

      const tracks: DiscoveredTrack[] = onTracks.mock.calls[0][0];
      expect(tracks[0].kind).toBe('video');
      expect(tracks[0].codec).toBe('avc1.4D401E');
    });

    it('identifies audio tracks by samplerate', async () => {
      const audioOnlyMock = makeMockMsfSession([audioTrack]);
      const audioManager = new CatalogManager(() => audioOnlyMock as any);

      const onTracks = jest.fn();
      audioManager.on('tracks-discovered', onTracks);

      await audioManager.start({} as any, ['webinar', 'session-1']);
      audioOnlyMock._fireCatalog({version: 1, tracks: [audioTrack]}, true);

      const tracks: DiscoveredTrack[] = onTracks.mock.calls[0][0];
      expect(tracks[0].kind).toBe('audio');
      expect(tracks[0].codec).toBe('opus');
    });
  });

  describe('stop', () => {
    it('clears internal state', async () => {
      await manager.start({} as any, ['webinar', 'session-1']);
      manager.stop();
      expect(manager.getTracks()).toHaveLength(0);
    });
  });
});
