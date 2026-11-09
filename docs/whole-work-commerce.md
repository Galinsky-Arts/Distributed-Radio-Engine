# DRE-24 whole-work commerce composition

`WholeWorkCommerce` delegates quote creation, exact minor-unit accounting,
provider raw-webhook verification and durable settlement to the actual
Distributed Audio Engine `CheckoutEngine`. Active fulfillment uses its
source-deduplicated `EntitlementLedger`; there is no second payment protocol,
provider signature scheme, point currency or local card-data handler.

The trusted catalog must authorize a complete album, show or documentary and
its exact complete asset set. Partial works and standalone music singles are
rejected. Buyer identity, merchant identity and explicit transaction approval
are separate mandatory adapters. Purchase eligibility has no speaker or points
condition. A scope-bound operation ID binds each provider checkout; replays
preserve the immutable price and buyer.

A settled provider order does not automatically mean fulfillment succeeded.
The current authorized complete-work snapshot must match its original digest,
and rights must be verified again. Only then is a download entitlement issued
for every complete-work asset. The grant is source-deduplicated, so reopening
the database or retrying after a settlement/fulfillment interruption does not
charge or issue twice. A pending fulfillment is reported honestly. The grant
contains no media key and never creates on-demand playback in the radio client.

CI builds immutable audio core source
`b49fa569ea49663182bffdcef319ec48222c40c7` and runs real SQLite checkout and
entitlement composition tests. Provider identity/webhook, catalog and account
adapters are explicit fixtures, with no real payments. Tests cover idempotency,
settlement, database reopen, complete-asset access, delayed fulfillment,
unauthorized/partial purchases, wrong buyers, forged webhook authentication
and catalog mutation after quoting.

Production payment-provider configuration and signed sandbox/webhook evidence,
refund/payout dispatch and entitlement revocation reconciliation, lawful rights
records, production identities and actual encrypted endpoint delivery remain
pending. Optional tips/gifts require their own approved provider transaction
adapters. Do not treat these software fixtures as a live merchant integration,
settlement run, production readiness or certification.

Paid recording membership uses the same permanent DRE-19 recording-channel
registry as points and Grooves. Complete-work publication cannot reuse a bonus
recording or silently reassign its creator. Fulfillment rechecks this immutable
ownership even after restart. Channel reservations occur only after trusted
complete-work approval and core registration; an interrupted registration can
leave an unused reservation, never a cross-channel entitlement or payment.
