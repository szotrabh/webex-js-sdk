export interface LocalStream {
  readonly outputStream: MediaStream;
  readonly muted: boolean;
  readonly userMuted: boolean;
  readonly label: string;
  readonly readyState: string;
  readonly id: string;

  setUserMuted(isMuted: boolean): void;
  stop(): void;
  getSettings(): MediaTrackSettings;

  on(event: 'output-track-change', handler: (track: MediaStreamTrack) => void): void;
  on(event: 'user-mute-state-change', handler: (muted: boolean) => void): void;
  on(event: 'stream-ended', handler: () => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
}

export interface LocalVideoStream extends LocalStream {
  readonly contentHint: string;
}

export type LocalAudioStream = LocalStream;

export interface LocalStreams {
  microphone?: LocalAudioStream;
  camera?: LocalVideoStream;
  screenShare?: {
    video?: LocalVideoStream;
    audio?: LocalAudioStream;
  };
}
