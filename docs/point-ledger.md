# DRE-16 creator-specific durable point ledger

The in-memory unrestricted `post` prototype is replaced by a scope-bound wallet
facade and atomic local-endpoint SQLite adapter. There is no default map wallet
or public arbitrary credit API.

## Authorization and accepted receipt consumption

Construct `CreatorPointLedger` with authenticated tenant/application/principal
scope, a durable store, a trusted vesting-receipt verifier, an operation
authorizer and an authoritative clock. These are trusted endpoint/service
dependencies, not caller-provided booleans. Actual request authentication and
roles must be established before constructing this scoped facade.

`creditVesting` requires a complete accepted DRE-15 full-outro receipt, its exact
creator/listener scope, program/outro references, timing, policy and units.
`createStoredVestingVerifier` supplies a concrete adapter: first authorize receipt
access, then compare the complete decision with the immutable authoritative
receipt store. It does not trust a client copy or a signature flag. The receipt
identity includes tenant/application/listener/creator/occurrence, so a fresh
operation ID or another station cannot credit it again. Truthy/async verifier
results and exceptions fail closed. Test callbacks are explicit fake authority.

The original receipt remains immutable with its pending field. Ledger receipt
consumption is the authoritative settlement view; retrying a pending-looking
source receipt cannot credit it twice. A crash before credit leaves the receipt
retryable; a crash after commit finds the consumed source identity. No
cross-database distributed transaction is claimed or needed for this
append-only-source/idempotent-consumer path.

`spend` authorizes exact creator, amount and offer identity. `reverse` authorizes
an original scoped operation and reason, derives its exact opposite delta, and
allows one full reversal. It cannot reverse a reversal, another creator's
operation or more than the original amount. Negative balances are prohibited,
including a credit clawback after funds were spent. Such a clawback fails without
changing entries; no invisible debt, transfer or administrative mint is invented.
Partial reversals are not supported by this version.

## Transactions, lifetime accounting and audit

The Node-only `./point-store` subpath exports `SqlitePointStore`. It uses built-in
Node SQLite (22.13+), private endpoint directory/file checks, WAL, FULL synchronous
commits, bounded contention, schema versioning and `BEGIN IMMEDIATE`. Receipt
uniqueness, operation uniqueness, reversal uniqueness, balance/lifetime changes
and the append-only audit insert share one transaction. A failure rolls all
changes back. Only the materialized wallet view is updated; prior audit entries
are not rewritten through this API.

All quantities use BigInt and decimal text, never SQLite floating-point sums.
The local adapter bounds materialized integers to 1,000 decimal digits as a
resource limit, not a reward-tier or safe-Number limit. Per-operation and account
size checks happen before commit. No universal wallet or cross-creator transfer
exists. Gross lifetime earned never falls when points are spent/refunded;
authorized invalid-credit reversals are separately recorded, with net earned
available as gross minus reversed.

Audit pages are scope-filtered, immutable and bounded to 1,000 rows, with BigInt
sequence cursors. `audit` performs a consistent read-snapshot reconstruction of
balances, earned/reversed totals and reversal relationships. A census exceeding
its declared resource bound returns unverified/limit-reached, never success.
Reconciliation detects inconsistent materialized accounting; it is not a
cryptographic tamper-proof seal, external audit or security certification.

## Persistence and privacy boundary

Supply an absolute database path inside a POSIX endpoint-owner-private directory.
Files are created mode 0600; nonprivate ordinary files/symlinks/directories fail.
Volatile SQLite is allowed only by explicit test opt-in. This is a local endpoint
adapter, not a selected production backend or a network-filesystem multiwriter
solution. Stored IDs, quantities, offer/reversal metadata and immutable source
bindings are accounting metadata. No credentials, raw audio, private media, keys
or opaque authorization proofs are stored. File permissions are not a claim of
E2EE/at-rest encryption. Production storage encryption, retention, backups/restore
qualification and endpoint authorization remain under the pinned project
security architecture.

Do not expose the internal store API as a remote authorization boundary.
Authenticated service code must use the scoped facade. DRE-18 still owns atomic
stock/offer/entitlement redemption; a standalone spend is not evidence that a
reward was delivered. An authorized reversal supports failed-grant recovery but
does not replace that later transaction integration.

## Evidence and remaining acceptance

Local `npm run check` passes 72 tests and roadmap validation on Node 24.19.0.
Tests cover exact 100-digit-plus values, scope/creator isolation, immutable receipt
matching, repeated receipts under fresh operation IDs, authorization failures,
idempotent spends/reversals, lifetime conservation, restart, audit pagination,
corruption detection and transaction rollback. Four independent processes race
60-point debits against 100 points: exactly one debit commits, leaving 40 points
and exactly two ledger entries. No real credit, payment or production account was
accessed.

Keep PR #23 draft until actual accepted DRE-15 producer/receipt authority is
integrated, current-head Node-22 CI passes and the recorded unit acceptance gates
are met. DRE-15 PR #22 remains draft pending real playback/evidence integration.
A callback fixture or green software CI does not supply that missing live trust.

