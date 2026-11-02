# DRE-10 incremental acceptance: ciphertext-only station playout

This change adds a **portable, deterministic playout and recovery contract**,
not a production station server or a completed DRE-10 milestone.

- Broadcaster approves and compiles a revision using the existing editorial and
  rights system, and publishes independently encrypted media at an authorized
  endpoint. No plaintext media, private decryption manifest or media keys are
  accepted as scheduler inputs.
- The trusted runtime stages approved revision versions and verified ciphertext
  references. Every non-marker cue must match the station's tenant and a
  ciphertext SHA-256. Unexpected source or secret-bearing fields are rejected.
- The playhead uses an absolute trusted timestamp, the approved revision
  schedule and broadcast-cycle boundaries. The artist device need not be
  connected for the pure schedule to advance. The runtime never chooses
  per-listener tracks.
- **Every individual cue** requires fresh playout-right and ciphertext
  availability authorization; revocation and missing content fail closed.
- An atomic state-store boundary persists sanitized fixed-version schedules,
  uses optimistic publication revisions and issues expiring fencing tokens.
  Restarting a worker against the same adapter recovers the shared timeline;
  expired, superseded and stale-worker leases cannot return a cue.
- The bundled memory store is a deterministic development adapter only. A
  production store must provide the same atomic semantics with durable storage,
  distributed time and operational recovery evidence.
- Independent adapters must validate signatures, actual asset hashes, rights,
  device authorization, encrypted asset storage and durable operation. Tests
  use stubbed trusted adapters solely to validate this boundary.

## Run checks

```sh
node --test tests/station-operations.test.mjs
npm run check
```

## Remaining DRE-10 acceptance gates

1. Build and operate an actual always-on scheduled ciphertext service and
   production state-store adapter, including distributed clock and recovery.
2. Exercise a deployed publisher-offline / restart / stale-lease / failed-relay
   rehearsal, verifying no mobile app remains necessary. Portable simulations
   now cover these transitions but are not operational evidence.
3. Integrate the approved endpoint encryption and storage/delivery contracts
   from Distributed Audio Engine, with no decryption authority on the relay.
4. Demonstrate real rights expiry, revoked publisher, corrupt-asset recovery,
   actual listener playback and security-profile evidence.
5. Only after those tests pass can DRE-10 be marked complete in the roadmap.

Never mark a test double as actual ciphertext availability, native player
readiness or independent security acceptance.

