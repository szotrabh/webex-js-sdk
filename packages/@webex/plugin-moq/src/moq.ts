/* eslint-disable require-jsdoc */
// @ts-nocheck — WebexPlugin uses AmpersandState which lacks TS types
import {WebexPlugin} from '@webex/webex-core';
import {MOQTransport} from '@web-moq/core';
import {MediaSession} from '@web-moq/media';
import {CatalogManager} from './catalog-manager';
import {StreamBridge} from './stream-bridge';

let subscriptionCounter = 0;

function nextSubscriptionId() {
  subscriptionCounter += 1;

  return `moq-sub-${subscriptionCounter}`;
}

const MoqPlugin = WebexPlugin.extend({
  namespace: 'Moq',

  session: {
    connectionState: {
      type: 'string',
      default: 'disconnected',
      values: ['disconnected', 'connecting', 'connected', 'error'],
    },
  },

  _transport: null,
  _mediaSession: null,
  _catalogManager: null,
  _streamBridge: null,
  _eventCleanups: null,
  _activeSubscriptions: null,

  async connect(relayUrl) {
    if (this.connectionState === 'connected') {
      throw new Error('Already connected');
    }

    this.connectionState = 'connecting';
    this.trigger('state:changed', {state: 'connecting'});

    try {
      const timeout = this.config?.connection?.connectionTimeout ?? 10000;

      this._transport = new MOQTransport({connectionTimeout: timeout});
      await this._transport.connect(relayUrl);

      this._mediaSession = new MediaSession(this._transport);
      await this._mediaSession.setup();

      this._streamBridge = new StreamBridge();
      this._activeSubscriptions = new Map();
      this._eventCleanups = [];

      this.connectionState = 'connected';
      this.trigger('state:changed', {state: 'connected'});
    } catch (err) {
      this.connectionState = 'error';
      this.trigger('state:changed', {state: 'error'});
      this.trigger('error', {error: err, context: 'connect'});
      throw err;
    }
  },

  async subscribe(options) {
    if (this.connectionState !== 'connected') {
      throw new Error('Not connected. Call connect() first.');
    }

    const subId = nextSubscriptionId();
    const {namespace} = options;
    const mediaConfig = this._buildMediaConfig(options.mediaConfig);

    this._catalogManager = new CatalogManager();

    this._catalogManager.on('tracks-discovered', (tracks) => {
      const subscribeTrack = async (track) => {
        try {
          const moqSubId = await this._mediaSession.subscribe(
            track.namespace,
            track.name,
            mediaConfig,
            track.kind
          );

          const entry = this._streamBridge.addTrack(moqSubId, track.kind, track.name);

          this.trigger('track:added', {
            subscriptionId: subId,
            trackName: track.name,
            mediaStream: entry.stream,
            kind: track.kind,
          });
        } catch (err) {
          this.trigger('error', {error: err, context: `subscribe-track:${track.name}`});
        }
      };

      Promise.all(tracks.map(subscribeTrack));
    });

    const unsubVideoFrame = this._mediaSession.on('video-frame', ({subscriptionId, frame}) => {
      this._streamBridge.writeFrame(subscriptionId, frame);
    });

    this._eventCleanups.push(unsubVideoFrame);

    const unsubAudioData = this._mediaSession.on('audio-data', ({subscriptionId, audioData}) => {
      this._streamBridge.writeFrame(subscriptionId, audioData);
    });

    this._eventCleanups.push(unsubAudioData);

    const unsubError = this._mediaSession.on('error', (err) => {
      this.trigger('error', {error: err, context: 'media-session'});
    });

    this._eventCleanups.push(unsubError);

    await this._catalogManager.start(this._mediaSession, namespace);

    const result = {
      id: subId,
      streams: this._streamBridge.getAllStreams(),
    };

    this._activeSubscriptions.set(subId, {
      catalogManager: this._catalogManager,
    });

    return result;
  },

  async unsubscribe(id) {
    const sub = this._activeSubscriptions?.get(id);

    if (!sub) return;

    sub.catalogManager.stop();
    this._activeSubscriptions.delete(id);

    if (this._streamBridge) {
      await this._streamBridge.removeAll();
    }
  },

  async disconnect() {
    if (this._eventCleanups) {
      for (const cleanup of this._eventCleanups) {
        cleanup();
      }
      this._eventCleanups = [];
    }

    if (this._catalogManager) {
      this._catalogManager.stop();
      this._catalogManager = null;
    }

    if (this._streamBridge) {
      await this._streamBridge.removeAll();
      this._streamBridge = null;
    }

    if (this._mediaSession) {
      await this._mediaSession.close();
      this._mediaSession = null;
    }

    if (this._transport) {
      await this._transport.close();
      this._transport = null;
    }

    this._activeSubscriptions = null;
    this.connectionState = 'disconnected';
    this.trigger('state:changed', {state: 'disconnected'});
  },

  _buildMediaConfig(overrides) {
    const defaults = this.config?.media ?? {};

    return {
      videoBitrate: defaults.videoBitrate ?? 2000000,
      audioBitrate: defaults.audioBitrate ?? 128000,
      videoResolution: defaults.videoResolution ?? '720p',
      jitterBufferDelay: defaults.jitterBufferDelay ?? 50,
      enableStats: defaults.enableStats ?? false,
      ...overrides,
    };
  },
});

export default MoqPlugin;
