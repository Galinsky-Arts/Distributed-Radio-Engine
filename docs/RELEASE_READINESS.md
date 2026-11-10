# Reusable radio release readiness

Development merges are authorized. The package remains 0.1.0-dev, private and unqualified for production. A stable version/publication is not implied by passing software fixtures.

| Contract | Implemented evidence | Remaining operational integration |
|---|---|---|
| Ciphertext scheduling/playback | Durable schedule restart, authenticated current joins, bounded lifecycle/backpressure; mixed-content-pilot tests use actual DAE encrypt/decrypt and tamper rejection | Approved endpoint key enrollment/transport, native sink/secure storage and actual output evidence |
| Contributions/points | Exact conservative arithmetic, explicit verifier boundary, terminal outro receipts, durable wallet credits, atomic reward debit/stock/entitlement | Real calibrated routes, private trusted measurement verification, creator rights/prices and delivery |
| Grooves | Actual program transition, completion history, issuer draw, stock/grant deduplication, atomic creator policy and durable reveal claim | Authenticated current policy/rights provisioning, protected issuer seed, endpoint delivery and deployment retention |
| Commerce | Actual DAE immutable quote/settlement and complete-work download grants; official Stripe sandbox adapter and raw-signature fixtures | Secure test key, deployed webhook and actual sandbox checkout; Connect payouts, refunds/disputes and live activation |
| Reporting | Mandatory source authentication, scope, exact separate units/currencies and unknown coverage | Actual private authenticated source bindings and deployed viewer authorization |

## DRE-27 mixed-content pilot evidence

`tests/mixed-content-pilot.test.mjs` runs music/documentary fixtures through actual DAE attachment encryption and authentication via the DRE ciphertext facade, including altered-ciphertext rejection. `tests/whole-work-commerce.test.mjs` exercises complete albums, shows and documentaries with actual durable settlement and complete download grants. Point/vesting/Groove suites independently compose their real persistent stores and source APIs. Fixture verifiers are explicit; no claim of deployed enrollment, physical audio output, personal streaming or field measurement follows.

For an operational pilot, provision actual endpoint enrollment/codecs, authorized complete-work recordings/rights/programs, durable private stores and trusted clock, reward evidence/price/policy authorizers, protected issuer seed and real provider callbacks. Exercise creator publication -> current-position listening -> interruption/rejoin -> full-outro settlement -> wallet redemption/Groove grant -> provider webhook -> scoped download/report. Include cross-tenant/role denial and duplicate delivery after restart. Record exact source/device/OS/route and retain private evidence only at its authorized endpoint.

## DRE-28 developer and support procedure

Build DAE at the pinned revision in .github/workflows/radio.yml (`npm ci --ignore-scripts; npm run build`), install this package with `npm ci --ignore-scripts`, set AUDIO_ENGINE_MODULE to the absolute dist/src/index.js, and run `npm run check`. RecordingChannelRegistry, point/vesting/schedule stores are authorized endpoint business storage; use owner-private persistent directories, do not share unsynchronized independent SQLite copies, and restore from a coherent backup with durable tombstones intact. Do not reset deduplication history as a recovery shortcut.

Pin exact consumer versions and native artifacts. The playback facade exposes only start/stop/recover/status; start resolves when its stream ends, while onStatus signals readiness. On uncertain identity, current rights, unavailable signature verification or cleanup failure, fail closed and stop issuing new rewards/purchases. Keep error output free of keys, payment URLs, ambient audio and private metadata. Inspect health with scoped authorization and a fresh trusted clock. A stable release needs deployed identity/key/provider validation, a real restore/replay drill, maintained dependency/secret gates and actual supported native/output evidence. External review remains honestly pending deferred work, not an inferred approval requirement.

Stripe setup is documented in STRIPE_CHECKOUT.md. Probe an account using `node --use-env-proxy scripts/inspect-stripe-sandbox.mjs` when the secure environment provides a test key. No live charges, payout configuration or real transaction has been performed by this work.
