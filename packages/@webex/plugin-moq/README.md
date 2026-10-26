# @webex/plugin-moq

Webex JS SDK plugin for **Media over QUIC (MoQ)**. It lets a client connect to a MoQ relay, discover and
subscribe to media tracks (for example, a webinar stream), render them as standard `MediaStream`s, and
publish local camera, microphone and screen-share streams.

The plugin does not implement the MoQ protocol itself. It is an integration layer on top of the
[`@moq-web/*`](#integration-with-moq-web) packages, which provide transport, session, codec and catalog
handling. This plugin adds:

- a connection lifecycle with a typed state machine,
- serialized (queued) operations so concurrent calls cannot corrupt state,
- catalog-driven track discovery (MSF),
- a bridge from WebCodecs output (`VideoFrame` / `AudioData`) to `MediaStream`,
- a typed event API for UI consumers,
- an adapter that maps meeting local streams to MoQ publications.

> **Status:** proof of concept (branch `moq-poc`). Depends on `@moq-web/*@0.2.0-alpha.0`. See
> [Known limitations](#known-limitations).

---

## Table of contents

- [Architecture](#architecture)
- [Integration with moq-web](#integration-with-moq-web)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [API reference](#api-reference)
- [Data flow](#data-flow)
- [Components](#components)
- [Error handling](#error-handling)
- [Browser requirements](#browser-requirements)
- [Testing](#testing)
- [Project layout](#project-layout)
- [Known limitations](#known-limitations)

---

## Architecture

```
                         Application (e.g. webex-web-client)
                                       |
                 MoqPlugin  <----  MoqMeetingAdapter (optional, publish side)
                     |
   +-----------------+------------------------------+
   |                 |                              |
CatalogManager    StreamBridge                 AsyncQueue
(MSF catalog)     (frames -> MediaStream)      (serializes operations)
   |                 ^
   |                 | video-frame / audio-data events
   v                 |
+----------------------------------------------------------+
| @moq-web/msf   @moq-web/media (MediaSession)             |
|                @moq-web/session (MOQTSession)            |
|                @moq-web/core    (MOQTransport)           |
+----------------------------------------------------------+
                      |  WebTransport (QUIC)
                      v
                  MoQ relay
```

## Integration with moq-web

`moq-web` is the MoQ client library that this plugin wraps. `plugin-moq` consumes six packages, all pinned
to `0.2.0-alpha.0` in `package.json`:

| Package | Role in moq-web | How `plugin-moq` uses it |
| --- | --- | --- |
| `@moq-web/core` | MOQT protocol types, encoding, state management and the transport layer | `MOQTransport` is created and connected to the relay in `MoqPlugin._connect` |
| `@moq-web/session` | Generic MOQT session management (protocol layer, no codecs) | `MOQTSession` is obtained from `MediaSession.getMOQTSession()` and handed to the MSF catalog layer |
| `@moq-web/media` | WebCodecs encode/decode with the LOC container format | `MediaSession` does the subscribe, publish and decode work, and emits decoded frames |
| `@moq-web/msf` | MOQT Streaming Format: JSON catalogs for LOC-compliant delivery | `createMSFSession` subscribes to the catalog and finds video/audio tracks (`CatalogManager`) |
| `@moq-web/cat` | Common Access Token (CBOR/COSE/CWT) library | Declared dependency, not yet used directly by plugin code |
| `@moq-web/secure-objects` | WebCrypto-based E2E encryption for MoQ objects | Declared dependency, not yet used directly by plugin code |

`msf` and `media` also depend on `cat`, `secure-objects`, `core` and `session` themselves, so these six
packages must resolve to the same version (the lockfile does this today).

### Layering: what the plugin touches in each package

**1. Connect (`@moq-web/core` + `@moq-web/media`)**

```ts
const transport = new MOQTransport({connectionTimeout});   // core
await transport.connect(relayUrl);                         // WebTransport session to the relay

const session = new MediaSession(transport);               // media
await session.setup();                                     // MOQT SETUP handshake
```

`connectionTimeout` comes from `config.connection.connectionTimeout` (default 10 s). The resulting
`{transport, session, bridge}` triple is stored as the `connected` state.

**2. Receive media (`@moq-web/media` events -> `StreamBridge`)**

`MediaSession` emits decoded frames. The plugin wires them once per connection (in `wireMediaEvents`) and
stores the unsubscribe functions so `disconnect()` removes them:

| `MediaSession` event | Payload | Plugin action |
| --- | --- | --- |
| `video-frame` | `{subscriptionId, frame: VideoFrame}` | `bridge.writeFrame(subscriptionId, frame)` |
| `audio-data` | `{subscriptionId, audioData: AudioData}` | `bridge.writeFrame(subscriptionId, audioData)` |
| `error` | `Error` | Re-emitted as plugin `error` event (`MEDIA_SESSION_ERROR`) |

**3. Subscribe to a track (`@moq-web/media`)**

```ts
const moqSubId = await session.subscribe(namespace, trackName, mediaConfig, kind);
const entry = bridge.addTrack(moqSubId, kind, trackName);   // creates the MediaStream
```

`moqSubId` is the numeric id moq-web assigns. The `StreamBridge` keys tracks by it, which is how incoming
`video-frame` and `audio-data` events find the right stream.

**4. Discover tracks (`@moq-web/msf`)**

When `subscribe()` is called without an explicit `tracks` list, `CatalogManager` calls
`createMSFSession(moqtSession, namespace)` and `subscribeCatalog(...)`. On every catalog update it calls
`findVideoTracks()` and `findAudioTracks()` and emits `tracks-discovered` with `DiscoveredTrack[]`
(name, namespace, kind, codec, width, height, framerate, samplerate, channelConfig, bitrate, renderGroup,
plus the raw MSF track). `MoqPlugin` then subscribes to each discovered track.

**5. Publish (`@moq-web/media`)**

```ts
const trackAlias = await session.publish(namespace, trackName, mediaStream, publishConfig);
await session.unpublish(trackAlias);
```

`publishConfig` carries bitrate, resolution, keyframe interval, delivery timeout, priority and the
delivery mode (`stream` or `datagram`).

**6. Disconnect**

`session.close()` then `transport.close()`, after removing event listeners, stopping catalog managers,
unpublishing everything and closing all bridge tracks.

### Testing seam

Because `@moq-web/*` needs WebTransport and WebCodecs, unit tests run against mocks in
`test/__mocks__/@moq-web/{core,media,msf}.ts`. `CatalogManager` and `StreamBridge` also accept factory
functions in their constructors (`MsfSessionFactory`, `GeneratorFactory`, `MediaStreamFactory`) so they can
be tested without a browser.

---

## Installation

The plugin is part of the SDK monorepo. Build and test it with the workspace scripts (Node 22.14):

```bash
nvm use 22.14
yarn workspace @webex/plugin-moq build:src
yarn workspace @webex/plugin-moq test:unit
```

The `@moq-web/*` packages come from npm; no local checkout of moq-web is needed.

## Quick start

```ts
import {MoqPlugin} from '@webex/plugin-moq';

const moq = new MoqPlugin();
moq.configure({connection: {connectionTimeout: 15_000}});

moq.on('state:changed', ({state}) => console.log('moq state', state));
moq.on('error', ({error, context}) => console.error(context, error));

// Receive: every track discovered in the catalog arrives as a MediaStream
moq.on('track:added', ({trackName, kind, mediaStream}) => {
  const el = document.createElement(kind === 'video' ? 'video' : 'audio');
  el.srcObject = mediaStream;
  el.autoplay = true;
  document.body.appendChild(el);
});

await moq.connect('https://relay.example.com/moq');

// Catalog-driven subscription
const {id} = await moq.subscribe({namespace: ['webinar', 'room-1']});

// ...or explicit tracks, skipping the catalog
await moq.subscribe({
  namespace: ['webinar', 'room-1'],
  tracks: [{name: 'video-720p', kind: 'video'}, {name: 'audio', kind: 'audio'}],
});

// Publish a local stream
const pub = await moq.publish({
  namespace: ['webinar', 'room-1'],
  trackName: 'user-1/camera',
  stream: localMediaStream,
});

await moq.unpublish(pub.id);
await moq.unsubscribe(id);
await moq.disconnect();
```

### Publishing from a meeting with `MoqMeetingAdapter`

```ts
import {MoqMeetingAdapter} from '@webex/plugin-moq';

const adapter = new MoqMeetingAdapter(moq, {
  namespace: ['meeting', meetingId],
  participantId: 'user-1',
});

adapter.on('published', ({trackName, kind}) => {});
adapter.on('track-replaced', ({trackName, kind}) => {});

await adapter.publishStreams({camera, microphone, screenShare: {video, audio}});
await adapter.unpublishStreams([camera]);
await adapter.close();
```

---

## Configuration

Defaults (`src/config.ts`), exposed as `config.moq`:

| Key | Default | Description |
| --- | --- | --- |
| `media.videoBitrate` | `2_000_000` | Video bitrate (bps) |
| `media.audioBitrate` | `128_000` | Audio bitrate (bps) |
| `media.videoResolution` | `'720p'` | `'480p' \| '720p' \| '1080p'` |
| `media.jitterBufferDelay` | `50` | Jitter buffer delay (ms) |
| `media.enableStats` | `false` | Enable moq-web media stats |
| `connection.connectionTimeout` | `10_000` | WebTransport connect timeout (ms) |
| `catalog.autoSubscribe` | `true` | Intended: subscribe to discovered tracks automatically (see limitations) |

Per-call `mediaConfig` overrides the plugin defaults. Publish adds these options (defaults applied in
`buildPublishConfig`):

| Key | Default | Description |
| --- | --- | --- |
| `keyframeInterval` | `1` | Keyframe interval |
| `deliveryTimeout` | `5000` | Delivery timeout (ms) |
| `priority` | `128` | Track priority |
| `deliveryMode` | `'stream'` | Video delivery: `'stream'` or `'datagram'` |
| `audioDeliveryMode` | `'datagram'` | Audio delivery |
| `videoEnabled` / `audioEnabled` | `true` | Enable each media kind |

`MoqPlugin.configure(partial)` stores the config. Fields missing from it fall back to the defaults above.

---

## API reference

### `MoqPlugin` (implements `IMoqPlugin`)

| Member | Description |
| --- | --- |
| `connectionState` | `'disconnected' \| 'connecting' \| 'connected' \| 'error'` |
| `configure(config)` | Set plugin config (`Partial<MoqPluginConfig>`) |
| `connect(relayUrl)` | Open transport and media session. Throws `ALREADY_CONNECTED` if connected |
| `subscribe(options)` | Subscribe by catalog (no `tracks`) or explicit `tracks`. Returns `{id, streams}` |
| `unsubscribe(id)` | Stop a subscription |
| `publish(options)` | Publish a `MediaStream` as a track. Returns `{id, trackAlias}` and emits `publishing` |
| `unpublish(id)` | Stop a publication |
| `disconnect()` | Tear everything down and go to `disconnected` |
| `on(event, handler)` / `off(event, handler)` | Typed events |

`subscribe`, `publish` and the other operations require a connection and throw `NOT_CONNECTED` otherwise.

### Events

| Event | Payload | When |
| --- | --- | --- |
| `state:changed` | `{state}` | Every state transition |
| `track:added` | `{subscriptionId, trackName, mediaStream, kind}` | A track was subscribed and its `MediaStream` is ready |
| `track:removed` | `{subscriptionId, trackName}` | Declared in the event map; not emitted yet |
| `publishing` | `{id, trackName, trackAlias}` | A publish succeeded |
| `error` | `{error: MoqError, context: MoqErrorType}` | Connection or media session error |

### Connection state machine

```
disconnected --connect()--> connecting --ok--> connected --disconnect()--> disconnected
                                 |
                                 +--fail--> error  (connect() can be retried)
```

Internally the state is a discriminated union (`DisconnectedState | ConnectingState | ConnectedState |
ErrorState`). `transport`, `session` and `bridge` exist only on `ConnectedState`, so the compiler prevents
using them while disconnected.

---

## Data flow

### Subscribe (catalog-driven)

```
subscribe({namespace})
  -> new CatalogManager()
  -> createMSFSession(moqtSession, namespace).subscribeCatalog()
        catalog update
  -> findVideoTracks() + findAudioTracks()
  -> 'tracks-discovered' (DiscoveredTrack[])
  -> for each track (Promise.allSettled):
        session.subscribe(namespace, name, mediaConfig, kind)  -> moqSubId
        bridge.addTrack(moqSubId, kind, name)                  -> MediaStream
        emit 'track:added'
```

### Media path (receive)

```
relay -> WebTransport -> MediaSession (LOC decode via WebCodecs)
      -> 'video-frame' / 'audio-data'
      -> StreamBridge.writeFrame(subscriptionId, frame)
      -> MediaStreamTrackGenerator.writable
      -> MediaStream (track:added) -> <video>/<audio>
```

### Publish

```
publish({namespace, trackName, stream})
  -> session.publish(namespace, trackName, stream, publishConfig) -> trackAlias
  -> emit 'publishing'
```

---

## Components

| File | Responsibility |
| --- | --- |
| `src/moq.ts` | `MoqPlugin`: state machine, operations, event wiring, config merging |
| `src/catalog-manager.ts` | `CatalogManager`: MSF catalog subscription and `DiscoveredTrack` extraction |
| `src/stream-bridge.ts` | `StreamBridge`: one `MediaStreamTrackGenerator` and `MediaStream` per subscribed track |
| `src/meeting-adapter.ts` | `MoqMeetingAdapter`: maps meeting `LocalStreams` to MoQ publications |
| `src/local-stream.ts` | `LocalStream` interfaces the adapter expects (structural types) |
| `src/async-queue.ts` | `AsyncQueue`: runs async tasks strictly in order, continuing after failures |
| `src/errors.ts` | `MoqError` and `MoqErrorType` |
| `src/types.ts` | Public types (`IMoqPlugin`, options, results, events, config) |
| `src/config.ts` | Default config |

### Operation serialization

`connect`, `subscribe`, `unsubscribe`, `publish`, `unpublish` and `disconnect` all go through one
`AsyncQueue`. Calls run one at a time in submission order, and a failed task does not block the next one.
For example, `disconnect()` called right after `subscribe()` waits for the subscribe to finish.

### `StreamBridge`

For each subscribed track it creates a `MediaStreamTrackGenerator` (`kind` = `video` or `audio`), takes
its writer, and wraps the generator in a `MediaStream`. It keeps two indexes: by numeric moq-web
`subscriptionId` (used on the frame hot path) and by track name (used for lookups and
`getAllStreams()`). `removeTrack` closes the writer and stops the generator.

### `MoqMeetingAdapter`

Maps each local stream to a track named `${participantId}/${slot}`:

| Local stream | Track name suffix | Kind | Media config forced |
| --- | --- | --- | --- |
| `camera` | `camera` | video | video on, audio off |
| `microphone` | `microphone` | audio | audio on, video off, `datagram` delivery |
| `screenShare.video` | `screenshare-video` | video | video on, audio off |
| `screenShare.audio` | `screenshare-audio` | audio | audio on, video off, `datagram` delivery |

Behavior:

- Publishing the same `LocalStream` object again is a no-op. A different stream for the same slot
  unpublishes the old one first.
- A `stream-ended` event on the local stream unpublishes its track automatically.
- `output-track-change` emits `track-replaced`.
- Adapter events: `published`, `unpublished`, `track-replaced`.
- Adapter state: `idle` -> `active` (on `publishStreams`) -> `idle` (on `unpublishAll`) -> `closed`
  (on `close`).

---

## Error handling

Failures are reported as `MoqError` with a `type` (`MoqErrorType`) and the original `cause`.

| Type | Raised when |
| --- | --- |
| `CONNECTION_FAILED` | Transport connect or session setup failed. Emitted as `error`, state becomes `error`, and the original error is rethrown |
| `ALREADY_CONNECTED` | `connect()` while connected |
| `NOT_CONNECTED` | An operation that needs a connection ran while not connected |
| `MEDIA_SESSION_ERROR` | `MediaSession` emitted `error`. Emitted as a plugin `error` event |
| `PUBLISH_FAILED`, `SUBSCRIBE_FAILED`, `UNSUBSCRIBE_FAILED`, `UNPUBLISH_FAILED`, `TRANSPORT_CLOSED`, `CATALOG_ERROR` | Defined for these cases but not yet thrown or emitted by the plugin code |

During catalog subscription, individual track failures use `Promise.allSettled` and are skipped silently, so
one failing track does not prevent the others from starting.

## Browser requirements

- WebTransport (QUIC) support.
- WebCodecs (`VideoDecoder`, `AudioDecoder`, `VideoFrame`, `AudioData`).
- `MediaStreamTrackGenerator` (Insertable Streams for MediaStreamTrack). This is currently Chromium-only,
  so Safari and Firefox are not supported on the receive path until a fallback exists.

## Testing

```bash
yarn workspace @webex/plugin-moq test:unit
yarn workspace @webex/plugin-moq test:unit --targets ...   # jest filters also work via the jest CLI
```

Suites in `test/unit/`: `moq-plugin`, `catalog-manager`, `stream-bridge`, `meeting-adapter`, `async-queue`,
`errors`. All `@moq-web/*` calls are mocked. There are no integration tests against a real relay yet.

## Project layout

```
packages/@webex/plugin-moq/
  src/
    index.ts            public exports
    moq.ts              MoqPlugin
    catalog-manager.ts  MSF catalog discovery
    stream-bridge.ts    WebCodecs -> MediaStream
    meeting-adapter.ts  meeting stream publishing
    local-stream.ts     LocalStream types
    async-queue.ts      operation serialization
    errors.ts           MoqError / MoqErrorType
    config.ts           defaults
    types.ts            public types
  test/
    __mocks__/@moq-web/ core, media, msf mocks
    __mocks__/@webex/   webex-core mock
    unit/               unit tests
```

## Known limitations

These are observations from the current code, not design goals:

- **Not registered with `webex-core`.** `MoqPlugin` is a standalone class created with `new MoqPlugin()`.
  It is not yet a `WebexPlugin`, so `webex.config.moq` is not read automatically. Call `configure()` yourself.
- **`catalog.autoSubscribe` is not honored.** Catalog-driven subscriptions always auto-subscribe to every
  discovered track.
- **`unsubscribe()` is coarse.** It stops the catalog manager but does not call `MediaSession` to
  unsubscribe individual tracks, and it removes all bridge tracks, including those of other subscriptions.
  `trackSubscriptionIds` is tracked but not used.
- **`track:removed` is never emitted.** If a track disappears from the catalog, nothing is torn down.
- **Catalog updates re-subscribe.** Each catalog update emits all current tracks, and `subscribeToTracks`
  does not skip tracks it already subscribed to. A second update for the same track would hit
  `StreamBridge.addTrack`, which throws on duplicate subscription ids.
- **Catalog-driven subscribe returns early.** `subscribe()` returns `streams` right after the catalog
  subscription starts, so the map can be empty. Use the `track:added` event to get streams.
- **No cleanup of `transport` on failed `connect()`.** If `session.setup()` fails after the transport
  connected, the transport is not closed.
- **`cat` and `secure-objects` are unused.** Authentication tokens and E2E encryption are not wired in.
- **Alpha dependencies** pinned to exact versions. API changes in later alphas will need code changes.
- **Mocked tests only.** Behavior against a real relay is unverified.
