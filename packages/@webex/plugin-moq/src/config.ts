export default {
  moq: {
    media: {
      videoBitrate: 2_000_000,
      audioBitrate: 128_000,
      videoResolution: '720p' as const,
      jitterBufferDelay: 50,
      enableStats: false,
    },
    connection: {
      connectionTimeout: 10_000,
    },
    catalog: {
      autoSubscribe: true,
    },
  },
};
