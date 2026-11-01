# DRE-19 implementation checkpoint — incomplete

`RecordingChannelRegistry` supplies an actual local-endpoint SQLite constraint on
tenant/application/recording identity. Groove, points and paid reservations share
one primary key; creator/channel/entry identity cannot be reassigned, including
after withdrawal. A separate unique constraint prevents an entry ID from being
retargeted to another recording. Exact replay is idempotent. Transactions use
BEGIN IMMEDIATE, WAL, FULL synchronous commits, bounded contention and a versioned
schema. Private endpoint directories/ordinary files are required; new files use
0600 permissions and memory stores require explicit test opt-in.

Groove publication/withdrawal now requires exact synchronous creator-authorizer
success on a frozen operation and tenant/application/principal scope. Publishing
uses the shared reservation before updating its local view. Caller flags, async
truthy returns and missing authority cannot publish. The callback must establish
actual creator rights; fixture callbacks are not production authorization.

The shared-channel constraint only covers writers using the **same authoritative
database**. Points/paid catalog writer integration is not implemented here yet.
Independent databases do not establish global exclusivity. This is a local
endpoint persistence adapter, not a selected hosted service, at-rest encryption
or E2EE certification. It stores opaque catalog/business metadata, never audio,
keys or protected asset plaintext.

The earlier client-ID-only in-memory `grant` API did not authenticate an issuer or
persist entitlements. It now fails closed. Entitlement reads also report the
missing durable adapter rather than falsely returning an empty entitlement list.
No fixture-grant bypass is exposed. No real grant/entitlement data was migrated
or modified. Existing catalog items remain an ephemeral view; durable active
catalog/withdrawal state, authorized issuer receipts, preserved grant reads and
secure endpoint delivery remain implementation work. The permanent channel
reservation is not an active-publication or entitlement record.

Local `npm run check` passes67 tests and roadmap validation on Node24.19.0,
including13 catalog tests. Actual SQLite tests cover persistence across restart,
two independent connections, paid/points/Groove collision, immutable identities,
scope separation and rollback after a uniqueness violation. Authorization and
fail-closed missing grant behavior, sanitized authorization failures, symlink/
nonprivate-file rejection and unsupported schema rejection are exercised.
Current-head CI is separate.

## Resume this unit first

Keep PR25 draft. Resume its actual boardroom/DRE-19 branch and inspect exact-head
CI. Implement durable catalog active/revision state, authenticated rights/issuer
contracts and append-only entitlements with same-decision replay/withdrawal
preservation, then connect all points/paid writers to one authoritative channel
registry. Integrate the approved DRE-05 rights checks and later DRE-23 secure
grant/delivery path. Test concurrency, restart, unauthorized access, withdrawal
and existing entitlement continuity. Do not label this unit complete, invent a
live grant, restore the old client-ID grant API or merge this partial checkpoint.

## Durable active publication revisions

A scoped SQLite publication table now records active/withdrawn state and
monotonically increasing revision. Creator-authorized publication/withdrawal
updates are transactional. Repeated publication of an already active Groove
does not increase its revision; withdrawal preserves reservation/history and
republication of the same immutable identity increments the revision. Fresh
catalog instances reload authoritative state after restart, rather than relying
on an in-memory map. Real issuer grants, rights and secure delivery remain
unimplemented and the PR must remain draft.

## Durable grant ledger (software boundary)

A separate SQLite grant table now stores immutable grant IDs and the original
publication revision/recording reference, with an atomic active-publication
check and unique listener/Groove entitlement constraint. Exact replay is
idempotent; conflicting grant IDs and duplicate issuance fail closed.
Withdrawals never erase existing entitlement snapshots, including after restart.
GrooveCatalog.grant and entitlements require explicit synchronous trusted issuer
and reader authorization with bounded opaque proof; missing/async/truthy
callback results cannot issue grants or reveal entitlements.

Actual issuer/root authentication, service rights, end-to-end encrypted asset
delivery and integration with later reward/commerce writers are still pending.
Passing fixture tests is not proof of any live grant. Keep PR25 draft.

## DRE-05 rights-policy adapter

createGrooveRightsAuthorizer connects a trusted creator decision and trusted
rights-record lookup to the existing DRE-05 requirePublishingRights evaluator.
It checks the exact recording asset identity, current authorized reward use,
territory, and validity; asynchronous/throwing authorities fail closed without
exposing provider details. This is testable adapter code, not a deployed rights
registry. Real creator/root provisioning and rights-record persistence remain
external approved integration work, as does secure encrypted content delivery.

## Atomic first publication

The initial channel reservation and active publication now share one
BEGIN IMMEDIATE transaction. A failed publication no longer strands an
independently committed orphan channel reservation before the catalog row can
be written. Conflicting creator/recording identity remains fail-closed.
