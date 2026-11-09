# DRE-11 linear-radio SDK facade

Import `@neophilism/distributed-radio-engine/playback` for the web/native adapter
facade. This subpath and `./join` use no Node-only imports; the broader engine
entrypoint also includes server-side editorial compilation. No native media
framework or browser decoder is bundled here.

```js
import {createWebRadioPlayback} from '@neophilism/distributed-radio-engine/playback';

const radio = createWebRadioPlayback({
  station: authenticatedStationAdapter,
  transport: ciphertextTransportAdapter,
  endpoint: authorizedPlaybackEndpoint,
  maxFrameBytes: 1024 * 1024,
  operationTimeoutMs: 10000,
});
const lifetime = radio.start();
// UI reads radio.status(). Stop and await cleanup before replacing the route.
await radio.stop();
await lifetime;
```

`createNativeRadioPlayback` uses the same lifecycle contract. The facade exposes
only `start`, `stop`, `recover` and `status`; there is no media selection, seek or
on-demand command. `start()` returns the stream lifetime promise, not a promise
that resolves upon the first frame. Duplicate starts share that promise.

## Trusted endpoint adapter contracts

- `station.read({signal})` returns `{program, startedAtMs}` from the current
  authoritative station timeline. `station.verify(snapshot)` must authenticate
  the exact station/revision using the upstream approved authority mechanism;
  only exact `true` permits connection. Authentication is **not** implemented by
  this callback contract. Application adapters are trusted code, never a remote
  peer's assertion of authority. The facade checks bounded clock arithmetic,
  version/identity and timeline continuity before joining.
- `transport.connect({join, signal})` returns a connection with an async iterable
  `frames` and an idempotent `close()` that settles pending reads. Each yielded
  frame contains only `{ciphertext: Uint8Array}`. Full stream/session/header
  authentication, frame ordering, encryption profile and replay protection stay
  in the upstream transport/endpoint adapter. The facade cannot infer encryption
  from bytes and never claims otherwise.
- `endpoint.writeCiphertext(bytes, {join, signal})` accepts one copied ciphertext
  frame at a time. It performs authorized decryption/rendering at the endpoint,
  under the pinned upstream profile, never at a relay. It must honor abort and
  backpressure. `endpoint.stop()` must settle pending writes and stop playback.
  Optional synchronous `endpoint.evidence()` reports `verified`, `unverified` or
  `unavailable`; absent evidence is unavailable. These are adapter reports, not
  authenticated contribution proofs and cannot award points or media rights.

Adapter implementations must not embed private keys, plaintext, credentials or
raw measurement data into joins/status. Only status fields are copied from
route/evidence records; provider exception strings are not exposed. The SDK does
not generate keys, establish a crypto protocol or downgrade to TLS-only media.

## Backpressure, recovery and limits

The facade pulls one frame and awaits endpoint acceptance before pulling another.
It copies at most one accepted frame per write, bounded by `maxFrameBytes` (default
1 MiB, maximum 16 MiB). Underlying transport/network/decoder queues must enforce
their own limits; this facade does not bound external adapter buffers.

Every asynchronous adapter operation has a watchdog, default 10 seconds and at
most 60 seconds. An adapter timeout or failed cleanup permanently seals the
session, aborts its signal and reports unavailable. Recovery cannot open a second
connection while cleanup is unresolved. A late timed-out connection is closed
and never played. Application code must dispose a sealed session and repair the
adapter rather than bypassing abort/close semantics.

Route status becomes ready only after an endpoint accepts a frame. Unexpected
stream end reports `STATION_STREAM_ENDED` and unavailable, including for an
always-on source. A clean `recover()` first stops the old route, rereads and
authenticates the current station, then joins at the current clock offset. It
does not resume cached content from a stale offset or reroll rewards. The join
object retains its initial route/evidence observation; `status().route` and
`status().evidence` describe the current facade state. No audience account or
location is imposed by these APIs; upstream guest endpoint authorization remains
mandatory.

## Verified scope and remaining integration

Software tests exercise native/web adapter contracts using explicit fake
ciphertext sources. They verify live offset, station authentication ordering,
backpressure, bounds, no key-bearing frame metadata, abort/stale completion,
cleanup failure, sanitized errors and recovery across cycles. Passing them does
not prove actual web/native playback, device calibration, E2EE conformance or
production readiness.

DRE-10 PR #14 is now merged with SQLite-backed scheduling and fenced recovery.
The adapter contracts remain explicit: the application must supply authenticated
station data, ciphertext transport and an authorized endpoint. No native or
production playback acceptance is inferred from this software merge.

The optional `onStatus(snapshot)` observer reports connecting, playing, stopping
and terminal states. It enables consumer UI to follow the stream lifetime;
`start()` still resolves only when that lifetime ends. Observer exceptions do not
skip cleanup. It conveys no authorization or reward evidence.
