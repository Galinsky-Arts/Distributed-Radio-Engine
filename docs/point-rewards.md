# DRE-18 atomic point rewards

`PointRewards` is a trusted endpoint facade over the DRE-16 wallet store. It
accepts creator-authorized, versioned coupon, recording and lawful fan-reward
offers using an authenticated immutable DRE-17 price snapshot. Points remain
creator-specific exact integer micro-reference-seconds. No cash checkout or paid
single is introduced. Recording offers reserve their immutable recording identity
in DRE-19's shared channel registry and require current DRE-05 reward rights.

A listener explicitly authorizes the exact creator, offer version and operation.
Inside one SQLite IMMEDIATE transaction, the store rechecks the offer and trusted
authorization, debits that creator wallet, decrements stock and inserts an immutable
entitlement. A failed grant rolls back all three. Same-operation retries return
the original receipt; new operation IDs cannot charge the same listener/offer
twice. Offer edits preserve issued receipts. Generic wallet reversal of a reward
debit is blocked until a future refund/revocation reconciliation operation exists.

The store and facade are internal authorized-endpoint APIs, not a public HTTP
service. The private local database retains wallet/entitlement metadata. Media,
keys and private manifests never enter these records. Actual fulfillment and
ciphertext/key delivery must recheck entitlement and creator rights at authorized
endpoints. No invented encryption or TLS-only fallback is added.

Validation includes actual DRE-17 snapshots and channel registry composition,
reopened databases, an injected entitlement-insert failure, stale price/rights
and cross-creator denial, insufficient balance, duplicate ownership and a
four-process race for one stock item. These tests use explicit fixture authority,
not production identity or field evidence. Production creator authentication,
endpoint enrollment, actual lawful reward fulfillment and privacy/restore drills
remain integration gates. Development merge is not production acceptance.
