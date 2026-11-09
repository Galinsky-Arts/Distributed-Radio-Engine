# Distributed-Radio-Engine

**Development and handoff plan:** [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md).

**DRE-17 price contract:** [versioned gentle/exponential reward ladder](docs/reward-price-ladder.md)
supports unbounded mathematical tiers, exact bounded quotes, symbolic fallback
and creator-approved immutable prices. It does not authorize a spend.
**DRE-16 wallet boundary:** [durable scoped point accounting](docs/point-ledger.md)
uses authenticated receipt consumption, atomic balances/audit, constrained
reversals and concurrent-spend protection. Real producer integration and release
acceptance remain separate from software fixtures.
**DRE-15 completion gate:** [authenticated durable vesting receipts](docs/vesting-receipts.md)
bind the matching outro and persist unique occurrence decisions across restarts
and concurrent processes. Wallet settlement remains explicitly pending.
**DRE-14 preview contract:** [authenticated provisional progress](docs/provisional-progress.md)
uses a scoped producer verifier, nonoverlapping exact windows and terminal
interruption tombstones. It never creates spendable point credit.
**DRE-13 evidence contract:** [scope-bound physical-output adjudication](docs/speaker-evidence.md).
The one-argument status-flag prototype is replaced by an explicit authenticated
verifier boundary with deduplication/overlap checks. Software fixtures do not
constitute calibrated-device evidence or authorize spendable point grants.
**DRE-12 contribution software:** [policy, exact units and authenticated evidence
boundary](docs/contribution-policy.md). Integer conservative energy equivalents
remain provisional; real playback/evidence integration and later settlement gates
are separate. `npm run check` exercises the fixture-based software acceptance.
**DRE-11 SDK work:** [linear-radio playback facade](docs/radio-playback-sdk.md)
provides transport-neutral web/native lifecycle adapters, current-station joins,
bounded ciphertext backpressure and recovery. `npm run check` exercises software
fixtures; actual DRE-10 station/endpoint integration remains pending. The SDK does
not establish keys, implement a new encryption protocol or certify live playback.

# Four-project development plan

120 planned work packages: 34 Distributed Audio Engine, 32 SceneSignal, 28 Distributed Radio Engine, 26 TrackZero. The original 88-package baseline remains mapped separately; 32 work packages were added. These are roadmap identifiers, not GitHub PR numbers.

Build order requested by the owner: Distributed Audio Engine, SceneSignal, Distributed Radio Engine, TrackZero. The radio engine does not depend on SceneSignal; build order is not an architectural coupling.

Distributed Audio Engine owns neutral encrypted media, device/timing evidence, generic timelines, spatial rendering, scoped controls and reusable commerce/entitlement primitives. SceneSignal consumes it directly. Distributed Radio Engine also consumes it and owns general radio programming, contribution economics, creator-specific wallets and free bonus releases. TrackZero consumes Distributed Radio Engine and supplies consumer/creator experiences.

No organizer event rules or radio-product reward rules belong in the audio core. SceneSignal requires permit evidence or a specific no-permit-required attestation for activated public sessions. TrackZero and the radio engine require no venue, attendance, scheduled gathering or artist proximity.

A **Spime** is a Bluetooth-enabled physical instrument anchor in SceneSignal: its validated location controls a virtual source such as the strings section. Phone, speaker and Spime locations are separate.

All projects adopt the pinned End To End Everywhere architecture as their default. TLS and server disk encryption supplement endpoint encryption; they never substitute for it. Production assurance, native-device and field qualification are evidence gates distinct from merging development code.

Implementation begins after the preceding stage. [Development plan](docs/distributed-radio-engine-development-plan.md).

## End-to-End Everywhere progress

The canonical [security/e2eesa-status.json](security/e2eesa-status.json) records standard implementation, complete testing and independent expert review separately. Engine Room reads it automatically from GitHub. All initial stages are pending; existing profile locks and approved decisions remain authoritative. Read [adoption and independent-account instructions](docs/E2EESA_ADOPTION.md), and run `python3 scripts/validate_e2eesa_status.py`. Record validation does not establish product security or certification.

