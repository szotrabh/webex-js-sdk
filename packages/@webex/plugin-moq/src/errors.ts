export enum MoqErrorType {
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  ALREADY_CONNECTED = 'ALREADY_CONNECTED',
  NOT_CONNECTED = 'NOT_CONNECTED',
  PUBLISH_FAILED = 'PUBLISH_FAILED',
  SUBSCRIBE_FAILED = 'SUBSCRIBE_FAILED',
  UNSUBSCRIBE_FAILED = 'UNSUBSCRIBE_FAILED',
  UNPUBLISH_FAILED = 'UNPUBLISH_FAILED',
  TRANSPORT_CLOSED = 'TRANSPORT_CLOSED',
  MEDIA_SESSION_ERROR = 'MEDIA_SESSION_ERROR',
  CATALOG_ERROR = 'CATALOG_ERROR',
}

export class MoqError extends Error {
  constructor(
    public readonly type: MoqErrorType,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'MoqError';
  }
}
