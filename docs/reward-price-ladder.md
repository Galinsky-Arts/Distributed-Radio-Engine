# DRE-17 versioned reward prices

The tier-64-capped multiplier prototype is replaced by the planned formula:

`ceil(base × (1 + gentle_growth × tier) × exp(acceleration × tier²))`

`createRewardPricePolicy` binds creator, version, positive BigInt base, rational
gentle-growth/acceleration parameters, formula version and point units. The
illustrative default is gentle growth 1/20 and acceleration 1/100; creators may
approve explicit overrides/policies. These quote defaults neither authorize a
transaction nor select a production offer. Unsupported/ambiguous settings and
legacy multiplier/maxLevel knobs are rejected rather than silently repriced.

## Exact bounded integer materialization

Tier identity uses nonnegative BigInt (safe integer Numbers are accepted at the
boundary). There is no business maximum tier. Quotes preserve an exact rational
formula for very large tiers. Inputs, series work and materialized digits have
explicit resource budgets; inability to produce an integer returns `symbolic`
with null points and a reason. It never clamps to tier64, returns Infinity,
truncates a quoted price or treats a symbolic expression as executable currency.

Integer lower/upper bounds evaluate the exponential. The argument is repeatedly
halved to at most1/2. Positive Taylor terms round down/up, with an upper remainder
bound twice the next term. Integer interval squaring reverses range reduction.
The finite lower sum is strict for a positive exponent. Materialization returns
an integer only when the price ceiling is uniquely established by the interval.
Adaptive guard precision handles near-integer cases; unresolved precision/series
budgets remain symbolic. Zero-exponent rational prices use exact ceiling directly.
The conservative digit bound can decline a materialization before actual output
would exhaust the budget; the mathematical tier/formula still exists.

## Creator-approved immutable offer snapshots

`createOfferPriceSnapshot` requires exact synchronous creator-approval verifier
success over the frozen offer record and complete validated policy. It binds
offer/version, creator, policy/formula version, tier, fixed units and integer
price. Explicit creator overrides are labeled separately. Later policy edits do
not mutate an earlier snapshot. Symbolic quotes cannot become executable offer
prices. Promises, truthy objects and failed verifiers do not authorize a snapshot.
No signature/authorization protocol is invented; the verifier is an explicit
trusted application adapter. Quotes/snapshots always report `spendAuthorized:false`.

The authenticated DRE-18 catalog must retain a versioned snapshot, enforce rights,
stock/budget and atomic creator-wallet debit/entitlement. This module cannot spend
points or deliver rewards. DRE-16 PR23 remains draft pending actual receipt
authority integration; no production catalog/wallet acceptance is inferred here.

## Verification

Local `npm run check` passes65 tests and roadmap validation on Node24.19.0.
The suite compares177 independent reference cases:55 default tiers through400 and
122 rational-policy/near-integer cases. Reference exponentials use Python Decimal
precision1100; zero-exponent cases use exact Fraction ceilings to avoid a decimal
oracle rounding an exact integer upward. Tests exercise tier65 and huge symbolic
tiers, work budgets, ambiguity rejection, immutable snapshots, explicit overrides
and failed approval. An illustrative1000-output all-day arithmetic case is not
physical speaker evidence or safety advice. Current-head CI remains a separate
gate; keep PR24 draft until accepted wallet/catalog authorization integration.
