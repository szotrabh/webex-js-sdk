import {EventEmitter} from 'events';
import {MOQTransport} from '@web-moq/core';
import {MediaSession} from '@web-moq/media';
import {CatalogManager, DiscoveredTrack} from './catalog-manager';
import {StreamBridge} from './stream-bridge';
import {MoqError, MoqErrorType} from './errors';
import {AsyncQueue} from './async-queue';
import type {
  IMoqPlugin,
  MoqConnectionState,
  MoqEventMap,
  MoqEventName,
  MoqSubscribeOptions,
  MoqSubscriptionResult,
  MoqPublishOptions,
  MoqPublishResult,
  MoqPublishConfig,
  MoqMediaConfig,
  MoqPluginConfig,
} from './types';

// ---------------------------------------------------------------------------
// Discriminated union for internal connection state
// ---------------------------------------------------------------------------

interface DisconnectedState {
  status: 'disconnected';
}

interface ConnectingState {
  status: 'connecting';
}

interface ConnectedState {
  status: 'connected';
  transport: MOQTransport;
  session: MediaSession;
  bridge: StreamBridge;
}

interface ErrorState {
  status: 'error';
  lastError: MoqError;
}

type PluginState = DisconnectedState | ConnectingState | ConnectedState | ErrorState;

// ---------------------------------------------------------------------------
// Internal tracking
// ---------------------------------------------------------------------------

interface ActiveSubscription {
  catalogManager: CatalogManager | null;
  trackSubscriptionIds: number[];
}

interface ActivePublication {
  trackAlias: bigint;
  trackName: string;
  namespace: string[];
  stream: MediaStream;
}

// ---------------------------------------------------------------------------
// Typed emitter setup
// ---------------------------------------------------------------------------

type TypedEmitter = {
  on<E extends MoqEventName>(event: E, handler: MoqEventMap[E]): void;
  off<E extends MoqEventName>(event: E, handler: MoqEventMap[E]): void;
  emit<E extends MoqEventName>(event: E, ...args: Parameters<MoqEventMap[E]>): boolean;
  removeAllListeners(event?: MoqEventName): void;
};

const TypedEventEmitter = EventEmitter as unknown as new () => TypedEmitter;

// ---------------------------------------------------------------------------
// MoqPlugin
// ---------------------------------------------------------------------------

class MoqPlugin extends TypedEventEmitter implements IMoqPlugin {
  private _state: PluginState = {status: 'disconnected'};
  private _eventCleanups: Array<() => void> = [];
  private _subscriptions = new Map<string, ActiveSubscription>();
  private _publications = new Map<string, ActivePublication>();
  private _pluginConfig: MoqPluginConfig | null = null;
  private _queue = new AsyncQueue();
  private _subCounter = 0;
  private _pubCounter = 0;

  get connectionState(): MoqConnectionState {
    return this._state.status;
  }

  configure(config: Partial<MoqPluginConfig>): void {
    this._pluginConfig = config as MoqPluginConfig;
  }

  async connect(relayUrl: string): Promise<void> {
    return this._queue.push(() => this._connect(relayUrl));
  }

  async subscribe(options: MoqSubscribeOptions): Promise<MoqSubscriptionResult> {
    return this._queue.push(() => this._subscribe(options));
  }

  async unsubscribe(id: string): Promise<void> {
    return this._queue.push(() => this._unsubscribe(id));
  }

  async publish(options: MoqPublishOptions): Promise<MoqPublishResult> {
    return this._queue.push(() => this._publish(options));
  }

  async unpublish(id: string): Promise<void> {
    return this._queue.push(() => this._unpublish(id));
  }

  async disconnect(): Promise<void> {
    return this._queue.push(() => this._disconnect());
  }

  // ---------------------------------------------------------------------------
  // Queued operation implementations
  // ---------------------------------------------------------------------------

  private async _connect(relayUrl: string): Promise<void> {
    if (this._state.status === 'connected') {
      throw new MoqError(MoqErrorType.ALREADY_CONNECTED, 'Already connected');
    }

    this.transition({status: 'connecting'});

    try {
      const timeout = this._pluginConfig?.connection?.connectionTimeout ?? 10_000;

      const transport = new MOQTransport({connectionTimeout: timeout});
      await transport.connect(relayUrl);

      const session = new MediaSession(transport);
      await session.setup();

      const bridge = new StreamBridge();

      const connected: ConnectedState = {status: 'connected', transport, session, bridge};
      this.transition(connected);
      this.wireMediaEvents(connected);
    } catch (err) {
      const moqErr = new MoqError(MoqErrorType.CONNECTION_FAILED, 'Connection failed', err);
      this.transition({status: 'error', lastError: moqErr});
      this.emitError(MoqErrorType.CONNECTION_FAILED, 'Connection failed', err);
      throw err;
    }
  }

  private async _subscribe(options: MoqSubscribeOptions): Promise<MoqSubscriptionResult> {
    const connected = this.requireConnected();

    const subId = this.nextSubscriptionId();
    const {namespace, tracks} = options;
    const mediaConfig = this.buildMediaConfig(options.mediaConfig);
    const trackSubscriptionIds: number[] = [];

    let catalogManager: CatalogManager | null = null;

    if (tracks) {
      const discovered: DiscoveredTrack[] = tracks.map((t) => ({
        name: t.name,
        namespace,
        kind: t.kind,
        raw: null,
      }));
      await this.subscribeToTracks(connected, subId, discovered, mediaConfig, trackSubscriptionIds);
    } else {
      catalogManager = new CatalogManager();
      catalogManager.on('tracks-discovered', (discovered: DiscoveredTrack[]) => {
        this.subscribeToTracks(connected, subId, discovered, mediaConfig, trackSubscriptionIds);
      });
      await catalogManager.start(connected.session, namespace);
    }

    this._subscriptions.set(subId, {catalogManager, trackSubscriptionIds});

    return {
      id: subId,
      streams: connected.bridge.getAllStreams(),
    };
  }

  private async _unsubscribe(id: string): Promise<void> {
    const sub = this._subscriptions.get(id);
    if (!sub) return;

    sub.catalogManager?.stop();
    this._subscriptions.delete(id);

    if (this._state.status === 'connected') {
      await this._state.bridge.removeAll();
    }
  }

  private async _publish(options: MoqPublishOptions): Promise<MoqPublishResult> {
    const connected = this.requireConnected();

    const pubId = this.nextPublicationId();
    const {namespace, trackName, stream} = options;
    const publishConfig = this.buildPublishConfig(options.mediaConfig);

    const trackAlias = await connected.session.publish(namespace, trackName, stream, publishConfig);

    this._publications.set(pubId, {trackAlias, trackName, namespace, stream});

    this.emit('publishing', {id: pubId, trackName, trackAlias});

    return {id: pubId, trackAlias};
  }

  private async _unpublish(id: string): Promise<void> {
    const pub = this._publications.get(id);
    if (!pub) return;

    if (this._state.status === 'connected') {
      await this._state.session.unpublish(pub.trackAlias);
    }
    this._publications.delete(id);
  }

  private async _disconnect(): Promise<void> {
    for (const cleanup of this._eventCleanups) {
      cleanup();
    }
    this._eventCleanups = [];

    for (const [, sub] of this._subscriptions) {
      sub.catalogManager?.stop();
    }
    this._subscriptions.clear();

    await Promise.all(
      [...this._publications.keys()].map((id) => this._unpublish(id).catch(() => {}))
    );
    this._publications.clear();

    if (this._state.status === 'connected') {
      const {bridge, session, transport} = this._state;
      await bridge.removeAll();
      await session.close();
      await transport.close();
    }

    this.transition({status: 'disconnected'});
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private requireConnected(): ConnectedState {
    if (this._state.status !== 'connected') {
      throw new MoqError(MoqErrorType.NOT_CONNECTED, 'Not connected. Call connect() first.');
    }

    return this._state;
  }

  private async subscribeToTracks(
    connected: ConnectedState,
    subId: string,
    tracks: DiscoveredTrack[],
    mediaConfig: MoqMediaConfig,
    trackSubscriptionIds: number[]
  ): Promise<void> {
    const results = await Promise.allSettled(
      tracks.map((track) => this.subscribeToSingleTrack(connected, subId, track, mediaConfig))
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value !== undefined) {
        trackSubscriptionIds.push(result.value);
      }
    }
  }

  private async subscribeToSingleTrack(
    connected: ConnectedState,
    subId: string,
    track: DiscoveredTrack,
    mediaConfig: MoqMediaConfig
  ): Promise<number> {
    const moqSubId = await connected.session.subscribe(
      track.namespace,
      track.name,
      mediaConfig,
      track.kind
    );

    const entry = connected.bridge.addTrack(moqSubId, track.kind, track.name);

    this.emit('track:added', {
      subscriptionId: subId,
      trackName: track.name,
      mediaStream: entry.stream,
      kind: track.kind,
    });

    return moqSubId;
  }

  private wireMediaEvents(connected: ConnectedState): void {
    const unsubVideoFrame = connected.session.on(
      'video-frame',
      ({subscriptionId, frame}: {subscriptionId: number; frame: VideoFrame}) => {
        connected.bridge.writeFrame(subscriptionId, frame);
      }
    );
    this._eventCleanups.push(unsubVideoFrame);

    const unsubAudioData = connected.session.on(
      'audio-data',
      ({subscriptionId, audioData}: {subscriptionId: number; audioData: AudioData}) => {
        connected.bridge.writeFrame(subscriptionId, audioData);
      }
    );
    this._eventCleanups.push(unsubAudioData);

    const unsubError = connected.session.on('error', (err: Error) => {
      this.emitError(MoqErrorType.MEDIA_SESSION_ERROR, 'Media session error', err);
    });
    this._eventCleanups.push(unsubError);
  }

  private buildPublishConfig(overrides?: Partial<MoqPublishConfig>): MoqPublishConfig {
    const defaults = this._pluginConfig?.media;

    return {
      videoBitrate: defaults?.videoBitrate ?? 2_000_000,
      audioBitrate: defaults?.audioBitrate ?? 128_000,
      videoResolution: defaults?.videoResolution ?? '720p',
      jitterBufferDelay: defaults?.jitterBufferDelay ?? 50,
      enableStats: defaults?.enableStats ?? false,
      keyframeInterval: 1,
      deliveryTimeout: 5000,
      priority: 128,
      deliveryMode: 'stream',
      audioDeliveryMode: 'datagram',
      videoEnabled: true,
      audioEnabled: true,
      ...overrides,
    };
  }

  private buildMediaConfig(overrides?: Partial<MoqMediaConfig>): MoqMediaConfig {
    const defaults = this._pluginConfig?.media;

    return {
      videoBitrate: defaults?.videoBitrate ?? 2_000_000,
      audioBitrate: defaults?.audioBitrate ?? 128_000,
      videoResolution: defaults?.videoResolution ?? '720p',
      jitterBufferDelay: defaults?.jitterBufferDelay ?? 50,
      enableStats: defaults?.enableStats ?? false,
      ...overrides,
    };
  }

  private transition(next: PluginState): void {
    this._state = next;
    this.emit('state:changed', {state: next.status});
  }

  private emitError(type: MoqErrorType, message: string, cause?: unknown): void {
    const error = new MoqError(type, message, cause);
    this.emit('error', {error, context: type});
  }

  private nextSubscriptionId(): string {
    this._subCounter += 1;

    return `moq-sub-${this._subCounter}`;
  }

  private nextPublicationId(): string {
    this._pubCounter += 1;

    return `moq-pub-${this._pubCounter}`;
  }
}

export default MoqPlugin;
