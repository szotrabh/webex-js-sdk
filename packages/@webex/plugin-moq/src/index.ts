/* eslint-disable require-jsdoc */
import {registerPlugin} from '@webex/webex-core';
import MoqPlugin from './moq';
import config from './config';

registerPlugin('moq', MoqPlugin, {config});

export {default as MoqPlugin} from './moq';
export {StreamBridge} from './stream-bridge';
export {CatalogManager} from './catalog-manager';
export type {DiscoveredTrack} from './catalog-manager';
export type {TrackEntry} from './stream-bridge';
export type {
  MoqSubscribeOptions,
  MoqSubscriptionResult,
  MoqConnectionState,
  MoqTrackAddedEvent,
  MoqTrackRemovedEvent,
  MoqStateChangedEvent,
  MoqErrorEvent,
} from './types';
