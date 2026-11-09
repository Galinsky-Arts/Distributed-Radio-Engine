# DRE-13 physical-output evidence adjudication

`aggregateSpeakerEvidence(entries, options)` now requires a scope-bound
adjudication window, policy version and explicit trusted evidence verifier.
The prior one-argument prototype trusted `status: verified`; it is intentionally
rejected. No production consumer may substitute a client flag for authentication.

Options require tenant/application/station/creator/occurrence scope and an ordered
nonnegative window of at most 60 seconds. At most 10,000 entries are accepted per
decision, with a configurable lower bound. Each eligible entry must identify one
physical output, issuer and measurement window, use the expected policy/version
and `micro-reference-seconds`, lie entirely in the adjudication window, and carry
nonnegative bounded BigInt units and an opaque proof (at most 8 KiB). The
per-window resource bound is 10^30 units, above DRE-12's configured mathematical
range; aggregation remains arbitrary-precision BigInt.

The **synchronous** `verifyEvidence(frozenRecord, frozenContext)` must return exact
`true` after checking the approved DAE device/calibration evidence and binding its
derived units to the complete canonical record and scope. It must independently
establish the physical-output identity and calibrated DRE-12 calculation. A
function returning true is an explicit test fixture, not an attestation system.
No signature, key-establishment or hardware protocol is invented by this unit.
Promises, truthy objects, exceptions and unauthenticated entries fail closed and
do not expose private verifier exception text.

Only `outputKind: physical`, speaker routes and authenticated records can
contribute. Aggregate field observations and declared speaker-count records are
excluded, so they cannot be added to component speakers. Repeated matching
physical-output intervals count once even across issuers/window IDs. Distinct
nonoverlapping intervals from one output accumulate. Partial overlap, conflicting
authenticated amounts or reused issuer/window IDs for different measurements
reject the decision rather than selecting an input order. Unauthenticated
conflicts cannot poison accepted evidence. Sorting uses code-unit order, not a
machine's locale. The accepted/duplicate/excluded census reconciles all inputs.

The immutable result includes provisional units, distinct physical outputs,
window/census counts and scope. It contains no raw audio, proof, calibration
measurement or exact location, and never asserts a number of people heard the
program. It is not a spendable grant. Pure aggregation cannot stop replay across
separate calls; the later occurrence/vesting/ledger boundary must persist the
scope/window/physical-output decision IDs and reject replay transactionally.

The software tests use explicit fake proofs. Local repository tests and roadmap
checks cover fanout, independent outputs, adjacent/overlapping windows, cross-scope
rejection, aggregate-field exclusion, signature-verifier failures, exact large
totals, permutation invariance and census accounting. Physical calibration and
device validation are not claimed. Keep PR #20 draft until the recorded trusted
attestation/device integration gate passes. DRE-12 PR #19 remains draft; integrate
its accepted policy and actual DAE verifier through the normal prerequisite path,
then verify current-head CI and acceptance before requesting ready/merge.
