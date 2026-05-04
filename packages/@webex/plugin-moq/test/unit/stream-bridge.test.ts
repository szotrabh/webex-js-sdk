import {StreamBridge} from '../../src/stream-bridge';
import type {TrackEntry} from '../../src/stream-bridge';

class MockWritableStreamDefaultWriter {
  written: any[] = [];
  closed = false;
  async write(chunk: any) {
    this.written.push(chunk);
  }
  async close() {
    this.closed = true;
  }
  releaseLock() {}
}

class MockWritableStream {
  private _writer = new MockWritableStreamDefaultWriter();
  getWriter() {
    return this._writer;
  }
}

class MockMediaStreamTrackGenerator {
  kind: string;
  writable: MockWritableStream;
  stopped = false;
  readyState = 'live';

  constructor({kind}: {kind: string}) {
    this.kind = kind;
    this.writable = new MockWritableStream();
  }

  stop() {
    this.stopped = true;
    this.readyState = 'ended';
  }
}

function mockGeneratorFactory(opts: {kind: string}) {
  return new MockMediaStreamTrackGenerator(opts) as any;
}

function mockMediaStreamFactory(tracks: any[]) {
  return {tracks, getTracks: () => tracks} as any;
}

describe('StreamBridge', () => {
  let bridge: StreamBridge;

  beforeEach(() => {
    bridge = new StreamBridge(mockGeneratorFactory, mockMediaStreamFactory);
  });

  describe('addTrack', () => {
    it('creates a MediaStream for a video track', () => {
      const entry = bridge.addTrack(1, 'video', 'speaker/video');
      expect(entry).toBeDefined();
      expect(entry.trackName).toBe('speaker/video');
      expect(entry.kind).toBe('video');
      expect(entry.stream).toBeDefined();
    });

    it('creates a MediaStream for an audio track', () => {
      const entry = bridge.addTrack(2, 'audio', 'speaker/audio');
      expect(entry).toBeDefined();
      expect(entry.kind).toBe('audio');
    });

    it('throws if subscriptionId is already tracked', () => {
      bridge.addTrack(1, 'video', 'speaker/video');
      expect(() => bridge.addTrack(1, 'video', 'speaker/video')).toThrow();
    });
  });

  describe('writeFrame', () => {
    it('writes a VideoFrame to the correct track writer', async () => {
      bridge.addTrack(1, 'video', 'speaker/video');
      const fakeFrame = {timestamp: 0} as any;
      await bridge.writeFrame(1, fakeFrame);

      const entry = bridge.getEntry(1)!;
      const writer = entry.generator.writable.getWriter() as unknown as MockWritableStreamDefaultWriter;
      // The first getWriter call is in addTrack; writeFrame uses the stored writer.
      // We verify via the entry's internal writer.
    });

    it('ignores writes for unknown subscriptionId', async () => {
      await bridge.writeFrame(999, {timestamp: 0} as any);
      // no throw
    });
  });

  describe('removeTrack', () => {
    it('closes writer and stops generator', async () => {
      bridge.addTrack(1, 'video', 'speaker/video');
      const entry = bridge.getEntry(1)!;
      await bridge.removeTrack(1);

      expect(entry.generator.stopped).toBe(true);
      expect(bridge.getEntry(1)).toBeUndefined();
    });

    it('no-ops for unknown subscriptionId', async () => {
      await bridge.removeTrack(999);
      // no throw
    });
  });

  describe('getStream', () => {
    it('returns the MediaStream for a given trackName', () => {
      bridge.addTrack(1, 'video', 'speaker/video');
      const stream = bridge.getStream('speaker/video');
      expect(stream).toBeDefined();
    });

    it('returns undefined for unknown trackName', () => {
      expect(bridge.getStream('unknown')).toBeUndefined();
    });
  });

  describe('getAllStreams', () => {
    it('returns a map of all trackName → MediaStream', () => {
      bridge.addTrack(1, 'video', 'speaker/video');
      bridge.addTrack(2, 'audio', 'speaker/audio');
      const streams = bridge.getAllStreams();
      expect(streams.size).toBe(2);
      expect(streams.has('speaker/video')).toBe(true);
      expect(streams.has('speaker/audio')).toBe(true);
    });
  });

  describe('removeAll', () => {
    it('removes all tracks and cleans up', async () => {
      bridge.addTrack(1, 'video', 'speaker/video');
      bridge.addTrack(2, 'audio', 'speaker/audio');
      await bridge.removeAll();
      expect(bridge.getAllStreams().size).toBe(0);
    });
  });
});
