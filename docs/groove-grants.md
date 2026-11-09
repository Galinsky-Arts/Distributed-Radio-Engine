# DRE-23 durable Groove grants and endpoint delivery

`GrooveGrantIssuer` joins the actual DRE-20 shared transition, DRE-21 auditable
positive-tail draw, DRE-22 authorized durable completion history and DRE-19
separate recording catalog. `radioOccurrenceId` binds the tenant/application,
station revision and full broadcast occurrence. A matching authenticated
full-outro completion is mandatory. Headphones qualify for Grooves and still
award no speaker points.

The host supplies an approved creator policy, protected issuer seed, current
identity/opportunity/policy verifiers and rights resolver. No client-selected
seed, sequence, tier, completion count, grant or recording URL is accepted by the
issuer. A shared opportunity can be claimed only in its bounded transition
window. Reconnect reads the persisted original result; stock-exhaustion outcomes
also persist and cannot be rerolled after restocking.

The private endpoint registry commits outcome, capacity consumption and immutable
entitlement in one SQLite transaction. Capacity includes previously issued
entitlements and cannot be lowered below issuance. Duplicate ownership does not
consume more stock. A failed outcome insert rolls back the grant and stock.
An explicit trusted creator authorizer must guard `configureGrooveStock`;
registry APIs are internal persistence, never public authorization endpoints.

`receipt` requires current viewer access. `deliver` additionally requires the
entitled listener, device authorization, current creator reward rights and a
successful acknowledgment from a constructor-bound approved DAE delivery adapter.
That adapter must enforce membership, expiry, rights and revocation at each
actual key/chunk emission through the pinned authenticated endpoint channel.
This wrapper creates no protocol, media key, raw URL or TLS-only alternative.
No method selects, stops, replaces or inserts personalized radio audio.

Intentional state: public station revision/transition times; private authorized
endpoint completion counts, outcome/entitlement IDs, tier and seed/context/weight
commitments. Proofs, protected seeds, media, raw ambient recordings, private
manifests and keys are absent from persistence and receipts. Protect databases,
backups and clocks under the endpoint's retention/recovery policy.

Software tests use the real compiler, shared transition projector, completion
history, draw and SQLite catalog. They cover restart replay, a failed outcome
commit, rights/access denial, stable exhausted outcomes and four independent
listener processes racing for one stock item. Identity, acoustic playback and
endpoint delivery adapters are explicit fixtures. Production enrollment, actual
DAE ciphertext/key-channel delivery, deployed recovery and device acceptance
remain pending; no field qualification or certification is claimed.
