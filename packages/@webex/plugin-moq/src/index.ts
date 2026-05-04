import {registerPlugin} from '@webex/webex-core';
import MoqPlugin from './moq';
import config from './config';

registerPlugin('moq', MoqPlugin, {config});

export {default} from './moq';
export type {
  MoqSubscribeOptions,
  MoqSubscriptionResult,
  MoqConnectionState,
  MoqTrackAddedEvent,
  MoqTrackRemovedEvent,
  MoqStateChangedEvent,
  MoqErrorEvent,
} from './types';
