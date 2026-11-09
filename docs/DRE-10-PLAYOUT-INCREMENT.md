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
- `createSqliteStationOperationsStore(filename)` persists public schedule state,
  optimistic revisions, clock high-water marks and leases with SQLite WAL, FULL
  synchronous commits and atomic transactions. Multiple connections share writer
  locking; process-exit recovery is tested. The memory adapter remains for tests.
  Both are trusted operator APIs; callers must authorize publication and worker
  access. Station IDs are globally unique and cannot change tenant. Protect the
  database and its directory; provide a trusted clock and anti-rollback backups.
  Multi-region storage, distributed time and deployed recovery remain unqualified.
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
   deploy the single-host state adapter, or qualify a distributed adapter and clock.
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


## November 9 software review

66 local radio tests pass on Node 24.22.1, including a child-process exit without
closing SQLite, recovery with two separate connections, stale-worker fencing,
optimistic publication conflicts, clock rollback and overflow denial. Sponsor
cues now accept the compiler's null occurrence ID. Timeline gaps and overlaps
are rejected before publication. No acoustic, device or deployed service
evidence is inferred from these tests. Independent review remains deferred
under AGENTS.md; development merge does not complete operational acceptance.

DRE-20 integration retains only validated public completion times and shared
transition markers in the durable schedule. These timing/occurrence identifiers
are intentional public program metadata. Private manifests, approval proofs,
media keys and arbitrary cue fields are still omitted. A real compiler-to-SQLite
restart test verifies that a recovered schedule can project the same shared
outro-to-intro opportunity without a broadcaster phone or per-listener insertion.
