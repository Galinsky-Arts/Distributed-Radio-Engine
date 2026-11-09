# DRE-12 contribution policy and evidence boundary

This unit defines one creator-scoped speaker contribution metric. Its output is
potential/provisional accounting, not spendable credit, a calibration certificate
or an audience count. Outro completion, replay deduplication, independent-output
aggregation and durable settlement belong to subsequent units.

## Versioned policy and units

`createContributionPolicy` requires an explicit positive version, threshold,
reference level, ceiling and maximum window (at most 60 seconds). It pins A
weighting, a reference measurement geometry when using verified evidence,
millidecibel conservative quantization and `lower-bound-integer-v1` rounding.
Maximum evidence age is bounded to 60 seconds. These are configuration bounds,
not a claim that any particular output level is safe or recommended. No default
acoustic levels or physical calibration are supplied by the library. Production
policy values and reference geometry still require supported-device validation.

The wire arithmetic unit is **micro-reference-seconds**. A reference-level second
is 1,000,000 units; a reference-level minute is 60,000,000. Dividing by 60,000,000
expresses the product specification's reference-energy-equivalent minutes. Keep
one metric, record the policy version/unit and never relabel these integer units
as summed decibels, a currency or an audience estimate.

At a conservative level `L` and reference `R`, the potential quantity is the
downward-rounded integral of `10^((L-R)/10)` over time. Durations are integer
milliseconds. The implementation lowers readings and raises the reference to
millidecibel boundaries, uses a 30-decimal lower-bound integer factor for the
fractional exponent, handles exact ten-decibel decades exactly, and returns
BigInt units. It does not use floating-point exponentiation or a safe-Number
balance limit. Subresolution binary input error can conservatively lose one
millidecibel. Splitting a fixed-level window cannot increase credited units.

`measureContribution` retains the earlier pure arithmetic API. Its `evidence`
string is only an arithmetic eligibility input, **not an authenticated proof**.
Never use that function directly to award points from untrusted client data.
Inputs are revalidated so a forged policy object cannot bypass bounds/rounding.

## Authenticated calibrated evidence

`measureVerifiedContribution({policy,claims,scope,nowMs,verifyEvidence})` requires:

- Exact tenant, application, station, creator and broadcast-occurrence scope.
- Window, physical-output, issuer and calibration identities.
- A-weighted geometry matching the policy, calibrated before the entire window,
  with calibration valid through its end.
- Nonfuture, ordered, bounded and fresh timing; exact policy version.
- Finite measured level and nonnegative uncertainty, an explicit output route,
  mute state and bounded opaque proof.
- A trusted **synchronous** verifier returning exact `true` for the frozen
  normalized claims and complete validated policy. Async/truthy/client boolean
  substitutes fail closed. The callback is supplied by the approved DAE evidence
  implementation; no signature/key-establishment protocol is invented here.

The lower bound (`measured - uncertainty`) must **exceed** the threshold. The
upper bound (`measured + uncertainty`) must remain within the governing ceiling.
Headphones, unavailable routes and mute yield zero even for authenticated
measurements. Invalid, stale, out-of-scope or unauthenticated data is rejected.
Only minimal scope/window/output IDs and provisional units leave this boundary;
proofs, raw levels, raw ambient audio and arbitrary extra fields are not returned.
The caller must authenticate the proof over precisely this canonical contract;
merely injecting a function that returns true is a test fixture, not real trust.

## Tests and integration status

Local `npm run check` on Node 24.19.0 passes 72 tests and the roadmap validator.
The tests include 768 independent golden calculations generated with Python
Decimal at 100-digit precision, exact-decade/high-value cases, downward rounding,
scope/authentication/calibration/freshness rejection, upper-bound safety and
headphone/mute/threshold exclusions. These prove software behavior with explicit
fixtures; they do not prove a device's physical calibration.

The software boundary is implemented. Merge/integration must still respect the
written DRE-11 prerequisite (PR #18 remains draft with DRE-10 integration pending).
Use its actual authenticated playback/evidence adapter when accepted. Do not
replace that dependency with fabricated measurements or award spendable points
before later outro/ledger gates. DRE-13 owns independently verified multi-output
deduplication; this unit never trusts a declared speaker count.
