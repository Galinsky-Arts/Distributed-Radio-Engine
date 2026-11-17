# Changelog

## Unreleased — November 17, 2026

- New optional `./postgres-durability` export: `createPostgresStoreDurability`
  backs any of the SQLite stores (points, vesting, listener history, recording
  channels, station operations) with PostgreSQL snapshots for hosts without a
  persistent disk. SQLite stays the default and the query engine; the pool is
  injected, so the package adds no runtime database dependency (`pg` is a
  development dependency for the suite). Restore is digest-checked before any
  store opens, writes are fenced by an ownership epoch, and a failed write is
  reported and retried, never acknowledged.

## 0.1.0-rc.1 — November 15, 2026

First release candidate of the reusable radio engine (DRE-28). **Not production
qualified.** It is a private, development-candidate package: passing software
fixtures do not establish deployed identity/key provisioning, physical audio
output, field measurement or provider transactions.

Included (DRE-01 to DRE-27, merged):

- Station roles, editorial authority, general catalog, rights and publishing checks.
- Program compiler with completion boundaries, versioned rotations, interstitials,
  sponsor placement and common-program accounting.
- Durable ciphertext-only station scheduling and the radio join/playback facade.
- Conservative contribution policy, independent multi-speaker evidence,
  provisional progress, full-outro vesting receipts and creator-specific wallets.
- Exponential reward price ladder, atomic points redemption, separate Unlocked
  Groove catalog, shared transition opportunities, rarity/eligibility, listener
  completion (including headphones) and the Groove grant ledger.
- Complete-work commerce with application-isolated receipts and the Stripe
  sandbox Checkout adapter; creator and sponsor reporting.
- Station recovery hardening and the radio security-flow inventory.

Release contract:

- The consumer API is locked by `docs/public-api.json` and
  `tests/release-contract.test.mjs`. Any export change must update this changelog.
- The engine carries no consumer-application dependency or branding.
- `/readyz` stays 503 and `/api/status` reports `productionReady: false`.

Before a stable 1.0 (see docs/RELEASE_READINESS.md and docs/developer-kit.md):
deployed identity/key/provider validation, a real restore/replay drill, actual
supported native/output evidence and live provider callbacks. Independent expert
review remains honestly pending deferred work.
