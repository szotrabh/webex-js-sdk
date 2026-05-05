import type {MoqError, MoqErrorType} from './errors';

// ---------------------------------------------------------------------------
// Public API — consumed by webex-web-client
// ---------------------------------------------------------------------------

export type MoqConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export type DeliveryMode = 'stream' | 'datagram';

// ---------------------------------------------------------------------------
// Typed Event Map
// ---------------------------------------------------------------------------

export interface MoqEventMap {
  'state:changed': (payload: MoqStateChangedEvent) => void;
  'track:added': (payload: MoqTrackAddedEvent) => void;
  'track:removed': (payload: MoqTrackRemovedEvent) => void;
  publishing: (payload: MoqPublishingEvent) => void;
  error: (payload: MoqErrorEvent) => void;
}

export type MoqEventName = keyof MoqEventMap;

// ---------------------------------------------------------------------------
// Plugin interface
// ---------------------------------------------------------------------------

export interface IMoqPlugin {
  readonly connectionState: MoqConnectionState;

  connect(relayUrl: string): Promise<void>;
  subscribe(options: MoqSubscribeOptions): Promise<MoqSubscriptionResult>;
  unsubscribe(id: string): Promise<void>;
  publish(options: MoqPublishOptions): Promise<MoqPublishResult>;
  unpublish(id: string): Promise<void>;
  disconnect(): Promise<void>;

  on<E extends MoqEventName>(event: E, handler: MoqEventMap[E]): void;
  off<E extends MoqEventName>(event: E, handler: MoqEventMap[E]): void;
}

// ---------------------------------------------------------------------------
// Subscribe options and results
// ---------------------------------------------------------------------------

export interface MoqTrackDescriptor {
  name: string;
  kind: 'video' | 'audio';
}

export interface MoqSubscribeOptions {
  namespace: string[];
  tracks?: MoqTrackDescriptor[];
  mediaConfig?: Partial<MoqMediaConfig>;
}

export interface MoqMediaConfig {
  videoBitrate: number;
  audioBitrate: number;
  videoResolution: '480p' | '720p' | '1080p';
  jitterBufferDelay: number;
  enableStats: boolean;
}

export interface MoqSubscriptionResult {
  id: string;
  streams: Map<string, MediaStream>;
}

// ---------------------------------------------------------------------------
// Publish options and results
// ---------------------------------------------------------------------------

export interface MoqPublishOptions {
  namespace: string[];
  trackName: string;
  stream: MediaStream;
  mediaConfig?: Partial<MoqPublishConfig>;
}

export interface MoqPublishConfig extends MoqMediaConfig {
  keyframeInterval: number;
  deliveryTimeout: number;
  priority: number;
  deliveryMode: DeliveryMode;
  audioDeliveryMode: DeliveryMode;
  videoEnabled: boolean;
  audioEnabled: boolean;
}

export interface MoqPublishResult {
  id: string;
  trackAlias: bigint;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface MoqTrackAddedEvent {
  subscriptionId: string;
  trackName: string;
  mediaStream: MediaStream;
  kind: 'video' | 'audio';
}

export interface MoqTrackRemovedEvent {
  subscriptionId: string;
  trackName: string;
}

export interface MoqStateChangedEvent {
  state: MoqConnectionState;
}

export interface MoqPublishingEvent {
  id: string;
  trackName: string;
  trackAlias: bigint;
}

export interface MoqErrorEvent {
  error: MoqError;
  context: MoqErrorType;
}

// ---------------------------------------------------------------------------
// Plugin config shape (from webex.config.moq)
// ---------------------------------------------------------------------------

export interface MoqPluginConfig {
  media: MoqMediaConfig;
  connection: {
    connectionTimeout: number;
  };
  catalog: {
    autoSubscribe: boolean;
  };
}
