# DRE-21 bounded rarity and eligibility

The original positive-tail integer rarity weights remain deterministic and
mathematically positive for every tier. `eligibleRarityWeights` accepts an
ordered policy of minimum completed listens; these completion counters MUST
originate from an authenticated durable listener history, never an unverified
client flag. At each integer lifetime threshold, more tiers become eligible.
Unlocked tiers retain their prior positive weights. This mechanism does not
guarantee an individual award and does not provide a wallet/entitlement.

`auditedRarityDraw` takes an issuer-protected random seed (32 to 128 bytes)
and trusted immutable context: issuer, station, opportunity, listener and
sequence. It derives a deterministic uniform integer with HMAC-SHA256
counter blocks and rejection sampling; it returns a tier, numeric draw and
SHA256 commitments to the protected seed, context and weight vector without
exposing the raw seed or listener identifier. The operator must bind one
issuer-approved seed and one opportunity context to a durable audited decision;
without this authority, fixtures are only functional software tests. Never
allow a listener to select a preferred seed, sequence or opportunity.

The server verifier must enforce seed provisioning, algorithm version,
commit-before-draw, replay protection, auditable seed reveal or independent
attestation, and any operational constraints. No encrypted media keys or
key-exchange/group protocol are implemented by these mathematical helpers.

DRE-20 authenticated station timing and DRE-22 durable listener completion
history are not yet accepted for live issuer integration, so this PR remains
draft pending actual service-level acceptance.
