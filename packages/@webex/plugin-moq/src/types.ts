export interface MoqSubscribeOptions {
  namespace: string[];
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

export type MoqConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

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

export interface MoqErrorEvent {
  error: Error;
  context: string;
}
