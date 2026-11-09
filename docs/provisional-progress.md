# DRE-14 authenticated provisional progress

`new ProvisionalProgress({scope, verifyWindow, ...bounds})` replaces the earlier
no-argument prototype. Scope contains tenant, application, station, principal and
playback-session IDs. Each window also binds a stable cycle, broadcast occurrence,
creator, program digest, point-policy version, content/outro timeline and the
listener's join instant. A client `verified` boolean is not an input authority.

The explicit synchronous trusted `verifyWindow(canonicalEvent, scope)` must return
exact `true` after authenticating the accepted DRE-12/13 decision and its playback
continuity/timeline binding. The frozen canonical event includes a bounded opaque
proof, integer units and exact context; it excludes arbitrary ambient-audio/raw
fields. Callback errors, Promises and truthy objects do not create progress. A
test callback returning true does not implement physical evidence verification.

Windows lie entirely inside content, not its identification/outro or ads. Only a
listener joined no later than the start of the whole cycle can preview that
cycle. Late join creates a terminal `LATE_JOIN` record. Authenticated windows
accumulate exact BigInt `micro-reference-seconds`; duplicates count once and
conflicting replay/overlap is rejected. A cycle cannot change its beneficiary,
occurrence, program digest, policy or timing after the first accepted window.

`preview(cycleId)` returns an immutable scoped view, cached provisional total,
accepted-window count and explicit state. `spendablePoints` is always zero and
`settled` is always false. This component cannot award or spend wallet credit.
The later DRE-15/16 boundary must independently validate closure and persist a
unique authoritative grant rather than trusting a client preview object.

`abandon(cycleId, reason)` handles stop/pause/seek/mute/route interruption. It
wipes provisional points/windows but retains a terminal tombstone, including if
interruption happened before the first sample. Authenticated replay cannot
recreate the abandoned cycle. Repeated abandon calls are idempotent. No reset or
tombstone-pruning API is exposed that could revive a forfeited cycle.

The state is deliberately **ephemeral**. Playback-session IDs must be issued and
bound by the trusted producer; new runtimes/sessions cannot authenticate proofs
from an old session. This class does not claim cross-process replay persistence,
crash recovery or durable settlement. Losing preview state never grants points.
Applications must treat a restarted/late-joined cycle as ineligible and use the
next full cycle; durable grant uniqueness remains the ledger's responsibility.

Bounds cover active and terminal cycles (default 1,000, maximum 10,000), per-cycle
windows (maximum 10,000), total retained windows (maximum 100,000), proof size
(8 KiB), per-window quantity (10^30 units), content window (at most 60 seconds)
and whole cycle (at most six hours). Capacity failure preserves existing state;
abandon frees window capacity while retaining the bounded cycle tombstone.

Local `npm run check` passes 70 tests and the roadmap validator on Node 24.19.0.
The acceptance fixtures cover scope/session/revision isolation, authentication,
late join, replay/overlap, interruption, metadata minimization and resource
bounds. PR #21 stays draft until accepted DRE-12/13 producer integration and the
subsequent authenticated settlement path are verified. No live evidence,
calibrated-device result, wallet transaction or production readiness is claimed.
