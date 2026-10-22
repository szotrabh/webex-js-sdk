export const MediaSession = jest.fn().mockImplementation(() => ({
  setup: jest.fn().mockResolvedValue(undefined),
  close: jest.fn().mockResolvedValue(undefined),
  publish: jest.fn().mockResolvedValue(BigInt(1)),
  unpublish: jest.fn().mockResolvedValue(undefined),
  subscribe: jest.fn().mockResolvedValue(1),
  on: jest.fn().mockReturnValue(() => {}),
}));
