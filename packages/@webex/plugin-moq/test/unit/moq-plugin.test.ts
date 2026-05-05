import MoqPlugin from '../../src/moq';
import {MoqError, MoqErrorType} from '../../src/errors';
import type {MoqStateChangedEvent} from '../../src/types';

describe('MoqPlugin', () => {
  let plugin: MoqPlugin;

  beforeEach(() => {
    plugin = new MoqPlugin();
  });

  describe('typed events', () => {
    it('emits state:changed with typed payload', async () => {
      const handler = jest.fn<void, [MoqStateChangedEvent]>();
      plugin.on('state:changed', handler);

      await plugin.connect('https://relay.example.com');

      expect(handler).toHaveBeenCalledWith({state: 'connecting'});
      expect(handler).toHaveBeenCalledWith({state: 'connected'});
    });

    it('supports off to remove listeners', async () => {
      const handler = jest.fn();
      plugin.on('state:changed', handler);
      plugin.off('state:changed', handler);

      await plugin.connect('https://relay.example.com');
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('MoqError', () => {
    it('throws MoqError with ALREADY_CONNECTED when connecting twice', async () => {
      await plugin.connect('https://relay.example.com');

      await expect(plugin.connect('https://relay.example.com'))
        .rejects.toMatchObject({type: MoqErrorType.ALREADY_CONNECTED});
    });

    it('throws MoqError with NOT_CONNECTED when publishing without connection', async () => {
      await expect(plugin.publish({
        namespace: ['test'],
        trackName: 'video',
        stream: {} as MediaStream,
      })).rejects.toMatchObject({type: MoqErrorType.NOT_CONNECTED});
    });

    it('throws MoqError with NOT_CONNECTED when subscribing without connection', async () => {
      await expect(plugin.subscribe({
        namespace: ['test'],
        tracks: [{name: 'video', kind: 'video'}],
      })).rejects.toMatchObject({type: MoqErrorType.NOT_CONNECTED});
    });
  });

  describe('async queue serialization', () => {
    it('serializes connect then disconnect', async () => {
      const states: string[] = [];
      plugin.on('state:changed', ({state}) => states.push(state));

      const connectPromise = plugin.connect('https://relay.example.com');
      const disconnectPromise = plugin.disconnect();

      await connectPromise;
      await disconnectPromise;

      expect(states).toEqual(['connecting', 'connected', 'disconnected']);
    });
  });

  describe('configure', () => {
    it('applies custom config', async () => {
      plugin.configure({
        connection: {connectionTimeout: 5000},
        media: {
          videoBitrate: 1_000_000,
          audioBitrate: 64_000,
          videoResolution: '480p',
          jitterBufferDelay: 100,
          enableStats: true,
        },
        catalog: {autoSubscribe: false},
      });

      expect(plugin.connectionState).toBe('disconnected');
    });
  });
});
