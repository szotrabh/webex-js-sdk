import {MoqError, MoqErrorType} from '../../src/errors';

describe('MoqError', () => {
  it('creates an error with type, message, and cause', () => {
    const cause = new Error('underlying');
    const err = new MoqError(MoqErrorType.CONNECTION_FAILED, 'Connection failed', cause);

    expect(err.type).toBe(MoqErrorType.CONNECTION_FAILED);
    expect(err.message).toBe('Connection failed');
    expect(err.cause).toBe(cause);
    expect(err.name).toBe('MoqError');
    expect(err).toBeInstanceOf(Error);
  });

  it('works without a cause', () => {
    const err = new MoqError(MoqErrorType.NOT_CONNECTED, 'Not connected');

    expect(err.type).toBe(MoqErrorType.NOT_CONNECTED);
    expect(err.cause).toBeUndefined();
  });

  it('has all expected error types', () => {
    expect(MoqErrorType.CONNECTION_FAILED).toBe('CONNECTION_FAILED');
    expect(MoqErrorType.ALREADY_CONNECTED).toBe('ALREADY_CONNECTED');
    expect(MoqErrorType.NOT_CONNECTED).toBe('NOT_CONNECTED');
    expect(MoqErrorType.PUBLISH_FAILED).toBe('PUBLISH_FAILED');
    expect(MoqErrorType.SUBSCRIBE_FAILED).toBe('SUBSCRIBE_FAILED');
    expect(MoqErrorType.TRANSPORT_CLOSED).toBe('TRANSPORT_CLOSED');
    expect(MoqErrorType.MEDIA_SESSION_ERROR).toBe('MEDIA_SESSION_ERROR');
    expect(MoqErrorType.CATALOG_ERROR).toBe('CATALOG_ERROR');
  });
});
