# DRE-15 authenticated outro completion and durable receipts

The prior in-memory, station-local prototype is replaced by a mandatory trusted
completion verifier and atomic receipt-store interface. `VestingGate` binds a
tenant/application/listener scope. Each completion binds creator, globally stable
broadcast occurrence, station, program digest, content reference, matching outro
reference, exact required/content/outro times, integer quantity and policy version.
Only exact synchronous verifier success can authorize a decision; input flags,
Promise/truthy values or arbitrary client preview totals cannot supply authority.

The verifier must authenticate the exact frozen canonical completion, accepted
DRE-12/13 units, DRE-14 continuity/forfeiture state and compiled DRE-06/08 outro.
It is an approved upstream endpoint adapter, not a signature protocol implemented
here. No private keys, media, ambient audio or opaque proofs are returned/stored.
Test callbacks are deliberately fake and do not establish device authenticity.

Full content plus the complete matching outro is required. A premature completion
can retry after closure; a late join, pause/seek/mute/route interruption or broken
playback continuity creates a durable terminal forfeiture. Later corrected flags
cannot resurrect that occurrence. Future timestamps, malformed timelines, stale
first decisions and scope mismatches fail closed. Exact authenticated retries of
already-recorded decisions remain idempotent after the freshness interval.

The receipt identity is tenant/application/listener/creator/**occurrence**, not
station/occurrence. Re-presenting the same logical occurrence through a different
station cannot mint a second receipt; conflicting authentic payloads are rejected.
Independent aired occurrences need distinct upstream occurrence IDs. Independent
listeners and beneficiary creators remain separate scopes.

## Atomic local endpoint persistence

`@neophilism/distributed-radio-engine/vesting-store` exports the Node-only
`SqliteVestingStore`. It uses built-in `node:sqlite` (engine requirement 22.13+),
WAL, FULL synchronous commits, bounded busy timeout, a namespaced versioned schema
and `BEGIN IMMEDIATE` transactions. The first immutable decision wins; failed
inserts roll back and release the transaction. Record shape, exact quantities and
scope-bound keys are checked **before** commit. Unknown schema versions fail.
SQLite is an explicit local endpoint adapter, not an authorized hosting/database
choice for a production service or a network-filesystem multiwriter solution.

Supply an absolute path inside an endpoint-owner-private directory. New database
files use mode 0600; nonprivate ordinary files/symlinks and nonprivate directories
are rejected. Sidecars stay inside that private directory. Memory stores require
explicit `allowMemory: true` and are for tests only. These permissions are not an
E2EE or at-rest encryption claim: the stored IDs, decision, timings and quantities
are operational accounting metadata at an authorized endpoint. Application
storage encryption, backup/restore qualification, retention and production
authorization must be integrated under the project's pinned security profiles.
Never put media, keys or proof payloads into this store. Its internal persistence
API does not itself authenticate a remote caller.

## Wallet boundary and acceptance

A vested receipt has `walletSettlement: pending`; a forfeiture has no settlement.
No wallet, transferable balance or spendable entitlement is created. DRE-16 must
consume the immutable receipt via an idempotent transactional credit path and
retain its unique receipt identity for recovery. A retry must not turn a pending
receipt into a second credit. Do not infer atomic wallet integration from this
standalone receipt transaction.

Local `npm run check` passes 70 tests and roadmap validation on Node 24.19.0.
Tests cover full-outro gates, terminal forfeiture, authenticated scopes, exact
replay/conflicts, cross-station duplication, stale/future decisions, private-file
setup, close/reopen, rollback, unknown schemas and four independent processes
racing one occurrence (exactly one inserted receipt). Current-head Node-22 CI
must be inspected after commit. No real playback/attestation, hardware, encrypted
storage or production deployment evidence is claimed. Keep PR #22 draft until
accepted DRE-14 producer and real compiled-outro/endpoint evidence are integrated.
