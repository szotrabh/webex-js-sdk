import {MoqMeetingAdapter} from '../../src/meeting-adapter';
import MoqPlugin from '../../src/moq';
import type {LocalStream, LocalStreams} from '../../src/local-stream';

function createMockLocalStream(overrides: Partial<LocalStream> = {}): LocalStream {
  const handlers = new Map<string, Set<(...args: any[]) => void>>();

  return {
    outputStream: {id: 'mock-media-stream', getTracks: () => []} as unknown as MediaStream,
    muted: false,
    userMuted: false,
    label: 'mock-track',
    readyState: 'live',
    id: `stream-${Math.random().toString(36).slice(2)}`,
    setUserMuted: jest.fn(),
    stop: jest.fn(),
    getSettings: jest.fn(() => ({})),
    on(event: string, handler: (...args: any[]) => void) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    },
    off(event: string, handler: (...args: any[]) => void) {
      handlers.get(event)?.delete(handler);
    },
    _emit(event: string, ...args: any[]) {
      handlers.get(event)?.forEach((h) => h(...args));
    },
    ...overrides,
  } as LocalStream & {_emit: (event: string, ...args: any[]) => void};
}

describe('MoqMeetingAdapter', () => {
  let moq: MoqPlugin;
  let adapter: MoqMeetingAdapter;

  beforeEach(() => {
    moq = new MoqPlugin();
  });

  async function setupConnectedAdapter() {
    await moq.connect('https://relay.example.com');
    adapter = new MoqMeetingAdapter(moq, {
      namespace: ['conference', 'room-1', 'media'],
      participantId: 'alice',
    });
    return adapter;
  }

  describe('publishStreams', () => {
    it('publishes camera as video track', async () => {
      await setupConnectedAdapter();
      const camera = createMockLocalStream();

      const publishSpy = jest.spyOn(moq, 'publish');

      await adapter.publishStreams({camera} as LocalStreams);

      expect(publishSpy).toHaveBeenCalledWith(expect.objectContaining({
        namespace: ['conference', 'room-1', 'media'],
        trackName: 'alice/camera',
        stream: camera.outputStream,
        mediaConfig: expect.objectContaining({
          videoEnabled: true,
          audioEnabled: false,
        }),
      }));
    });

    it('publishes microphone as audio track', async () => {
      await setupConnectedAdapter();
      const microphone = createMockLocalStream();

      const publishSpy = jest.spyOn(moq, 'publish');

      await adapter.publishStreams({microphone} as LocalStreams);

      expect(publishSpy).toHaveBeenCalledWith(expect.objectContaining({
        trackName: 'alice/microphone',
        stream: microphone.outputStream,
        mediaConfig: expect.objectContaining({
          videoEnabled: false,
          audioEnabled: true,
          audioDeliveryMode: 'datagram',
        }),
      }));
    });

    it('publishes both camera and microphone', async () => {
      await setupConnectedAdapter();
      const camera = createMockLocalStream();
      const microphone = createMockLocalStream();

      const publishSpy = jest.spyOn(moq, 'publish');

      await adapter.publishStreams({camera, microphone} as LocalStreams);

      expect(publishSpy).toHaveBeenCalledTimes(2);
    });

    it('publishes screen share video', async () => {
      await setupConnectedAdapter();
      const screenVideo = createMockLocalStream();

      const publishSpy = jest.spyOn(moq, 'publish');

      await adapter.publishStreams({
        screenShare: {video: screenVideo},
      } as LocalStreams);

      expect(publishSpy).toHaveBeenCalledWith(expect.objectContaining({
        trackName: 'alice/screenshare-video',
        mediaConfig: expect.objectContaining({videoEnabled: true, audioEnabled: false}),
      }));
    });

    it('sets state to active after publishing', async () => {
      await setupConnectedAdapter();
      expect(adapter.state).toBe('idle');

      await adapter.publishStreams({camera: createMockLocalStream()} as LocalStreams);

      expect(adapter.state).toBe('active');
    });

    it('replaces existing publication for same slot', async () => {
      await setupConnectedAdapter();
      const camera1 = createMockLocalStream();
      const camera2 = createMockLocalStream();

      const publishSpy = jest.spyOn(moq, 'publish');
      const unpublishSpy = jest.spyOn(moq, 'unpublish');

      await adapter.publishStreams({camera: camera1} as LocalStreams);
      await adapter.publishStreams({camera: camera2} as LocalStreams);

      expect(unpublishSpy).toHaveBeenCalledTimes(1);
      expect(publishSpy).toHaveBeenCalledTimes(2);
    });

    it('does not re-publish same stream', async () => {
      await setupConnectedAdapter();
      const camera = createMockLocalStream();

      const publishSpy = jest.spyOn(moq, 'publish');

      await adapter.publishStreams({camera} as LocalStreams);
      await adapter.publishStreams({camera} as LocalStreams);

      expect(publishSpy).toHaveBeenCalledTimes(1);
    });

    it('emits published event', async () => {
      await setupConnectedAdapter();
      const camera = createMockLocalStream();
      const handler = jest.fn();
      adapter.on('published', handler);

      await adapter.publishStreams({camera} as LocalStreams);

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        trackName: 'alice/camera',
        kind: 'video',
      }));
    });
  });

  describe('unpublishStreams', () => {
    it('unpublishes a specific stream', async () => {
      await setupConnectedAdapter();
      const camera = createMockLocalStream();
      const microphone = createMockLocalStream();

      await adapter.publishStreams({camera, microphone} as LocalStreams);

      const unpublishSpy = jest.spyOn(moq, 'unpublish');
      await adapter.unpublishStreams([camera] as LocalStream[]);

      expect(unpublishSpy).toHaveBeenCalledTimes(1);
    });

    it('emits unpublished event', async () => {
      await setupConnectedAdapter();
      const camera = createMockLocalStream();
      const handler = jest.fn();
      adapter.on('unpublished', handler);

      await adapter.publishStreams({camera} as LocalStreams);
      await adapter.unpublishStreams([camera] as LocalStream[]);

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        trackName: 'alice/camera',
        kind: 'video',
      }));
    });
  });

  describe('stream lifecycle events', () => {
    it('unpublishes when stream ends', async () => {
      await setupConnectedAdapter();
      const camera = createMockLocalStream();

      await adapter.publishStreams({camera} as LocalStreams);

      const unpublishSpy = jest.spyOn(moq, 'unpublish');
      (camera as any)._emit('stream-ended');

      await new Promise((r) => setTimeout(r, 10));
      expect(unpublishSpy).toHaveBeenCalled();
    });

    it('emits track-replaced on output track change', async () => {
      await setupConnectedAdapter();
      const camera = createMockLocalStream();
      const handler = jest.fn();
      adapter.on('track-replaced', handler);

      await adapter.publishStreams({camera} as LocalStreams);
      (camera as any)._emit('output-track-change', {} as MediaStreamTrack);

      expect(handler).toHaveBeenCalledWith({trackName: 'alice/camera', kind: 'video'});
    });

    it('removes event listeners on unpublish', async () => {
      await setupConnectedAdapter();
      const camera = createMockLocalStream();
      const offSpy = jest.spyOn(camera, 'off');

      await adapter.publishStreams({camera} as LocalStreams);
      await adapter.unpublishStreams([camera] as LocalStream[]);

      expect(offSpy).toHaveBeenCalledTimes(2); // stream-ended + output-track-change
    });
  });

  describe('unpublishAll', () => {
    it('unpublishes all tracks and resets state', async () => {
      await setupConnectedAdapter();
      const camera = createMockLocalStream();
      const microphone = createMockLocalStream();

      await adapter.publishStreams({camera, microphone} as LocalStreams);

      const unpublishSpy = jest.spyOn(moq, 'unpublish');
      await adapter.unpublishAll();

      expect(unpublishSpy).toHaveBeenCalledTimes(2);
      expect(adapter.state).toBe('idle');
    });
  });

  describe('close', () => {
    it('unpublishes all and sets state to closed', async () => {
      await setupConnectedAdapter();
      const camera = createMockLocalStream();

      await adapter.publishStreams({camera} as LocalStreams);
      await adapter.close();

      expect(adapter.state).toBe('closed');
    });
  });

  describe('mediaConfig', () => {
    it('passes custom config to publish', async () => {
      await moq.connect('https://relay.example.com');
      adapter = new MoqMeetingAdapter(moq, {
        namespace: ['conference', 'room-1', 'media'],
        participantId: 'alice',
        mediaConfig: {
          videoBitrate: 4_000_000,
          videoResolution: '1080p',
          keyframeInterval: 2,
        },
      });

      const camera = createMockLocalStream();
      const publishSpy = jest.spyOn(moq, 'publish');

      await adapter.publishStreams({camera} as LocalStreams);

      expect(publishSpy).toHaveBeenCalledWith(expect.objectContaining({
        mediaConfig: expect.objectContaining({
          videoBitrate: 4_000_000,
          videoResolution: '1080p',
          keyframeInterval: 2,
          videoEnabled: true,
          audioEnabled: false,
        }),
      }));
    });
  });
});
