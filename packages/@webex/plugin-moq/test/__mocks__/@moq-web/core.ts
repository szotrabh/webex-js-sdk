export const MOQTransport = jest.fn().mockImplementation(() => ({
  connect: jest.fn().mockResolvedValue(undefined),
  close: jest.fn().mockResolvedValue(undefined),
}));
