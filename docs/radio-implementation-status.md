# Distributed Radio Engine — implementation and evidence

## Release candidate checkpoint — November 15, 2026

All 28 DRE units now have merged software implementations. DRE-28 adds the
release contract: a locked consumer API snapshot (`docs/public-api.json`),
a [developer kit and support matrix](developer-kit.md), a [changelog](../CHANGELOG.md)
and `tests/release-contract.test.mjs`, which enforces no consumer-application
dependency or branding, a non-production readiness surface and a pre-release
version string. The package is `0.1.0-rc.1`; it is a release candidate, not a
stable or production release. The suite has 287 passing cases against the
pinned audio engine. Operational gates in RELEASE_READINESS.md are unchanged.

November 9, 2026 software checkpoint. Live GitHub PRs and their exact tested
heads are authoritative; `registry/prs.json` records dated observations.

DRE-01–DRE-15 have merged development implementations. They cover scoped station
roles, catalog and publishing rights, common editorial programs, identifications,
sponsors, durable ciphertext-only scheduling, a web/native playback facade,
conservative contribution arithmetic, physical-output deduplication, provisional
progress and durable full-outro receipts. DRE-16 adds durable creator-specific
wallets and receipt-to-wallet integration. These are software boundaries with
explicit trusted adapters, not a deployed station or verified loudspeaker network.

Local checks cover process-exit SQLite recovery, multiple connections/processes,
stale-worker fencing, publication conflicts, replay, interruption forfeiture,
creator separation, exact arithmetic and ledger reconciliation. The wallet
integration uses an actual reopened receipt database and rejects altered or
missing receipts. Hosted checks must pass at the exact PR head before merge.

## Remaining integration

- Production identity/device enrollment, authenticated endpoint bootstrap,
  ciphertext relay deployment and actual browser/native media playback.
- Calibrated physical-source attribution, route/device qualification, audible
  interruption latency, battery and long-duration field tests.
- Provider-backed fulfillment, deployed recovery/retention drills and integrated
  pilot/release evidence. No deployment or certification is claimed.

The canonical registry restores the dependency edges, scope and acceptance text
from the approved 120-package source plan. Empty dependency arrays in older
registry exports must not be interpreted as permission to skip prerequisites.
Independent expert review remains honestly pending and deferred under AGENTS.md;
it is not a software merge prerequisite.
