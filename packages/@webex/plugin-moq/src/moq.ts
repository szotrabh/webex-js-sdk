// @ts-nocheck — WebexPlugin uses AmpersandState which lacks TS types
import {WebexPlugin} from '@webex/webex-core';
import type {
  MoqConnectionState,
  MoqSubscribeOptions,
  MoqSubscriptionResult,
} from './types';

const MoqPlugin = WebexPlugin.extend({
  namespace: 'Moq',

  session: {
    connectionState: {
      type: 'string',
      default: 'disconnected',
      values: ['disconnected', 'connecting', 'connected', 'error'],
    },
  },

  connect(_relayUrl: string): Promise<void> {
    return Promise.reject(new Error('Not implemented'));
  },

  subscribe(_options: MoqSubscribeOptions): Promise<MoqSubscriptionResult> {
    return Promise.reject(new Error('Not implemented'));
  },

  unsubscribe(_id: string): Promise<void> {
    return Promise.reject(new Error('Not implemented'));
  },

  disconnect(): Promise<void> {
    return Promise.reject(new Error('Not implemented'));
  },
});

export default MoqPlugin;
