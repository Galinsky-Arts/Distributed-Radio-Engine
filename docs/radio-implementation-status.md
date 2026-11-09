# Distributed Radio Engine — implementation and release evidence

This page tracks implementation *in this repository*, separately from the upstream Distributed Audio Engine status.

## DRE-11 branch checkpoint — 2026-10-18

PR #18 adds the public `./playback` and `./join` subpaths, a web/native endpoint
adapter lifecycle, mandatory station-verification callback, bounded one-frame
ciphertext backpressure, abort/cleanup fencing, current-clock recovery and
allowlisted public status/errors. Local `npm run check` passes **75 tests** and
the roadmap validator on Node **24.19.0**. GitHub CI uses Node 22; exact-head CI
must be inspected separately after commit. Test adapters are explicit fixtures,
not native/browser streaming or hardware evidence.

Remaining unit acceptance is the real DRE-10 authenticated station/transport and
authorized endpoint integration. Gateway evidence for imported DRE-10 PR #14
currently returns `PR_MAPPING_CONFLICT`; the source registry has no numeric
association. No duplicate PR or alternative-connector workaround is authorized.
Keep PR #18 draft until integration acceptance and current-head checks pass.
See [the SDK contract and limits](radio-playback-sdk.md).

The table below is the initial historical baseline and does not supersede live
GitHub/registry evidence or the branch-specific checkpoint above.

| Roadmap | Implemented | Integration | Field / independent evidence |
| --- | --- | --- | --- |
| DRE-01 | Portable neutral station/media contracts; test suite | Upstream DAE-23 version and consumer-install smoke **pending** | Not claimed |
| DRE-02–DRE-28 | Planned | Not integrated | Not claimed |

The neutral interfaces do not implement media encryption, keys, acoustic validation, payments or listener privacy. Those remain external dependencies or later packages. A green unit test is not authorization to publish a production radio service.

## Deployment

There is currently no deployed production station or listener application. Future Render preview health and readiness endpoints must explicitly describe their limited scope, and must not claim that secure streaming or verified speaker rewards are operational.

## Upstream reference

[Distributed Audio Engine implementation evidence](https://github.com/neophilism/Distributed-Audio-Engine/blob/main/docs/implementation-status.md).

## Monitoring contract

Automation should publish a build SHA, test status, deployment state and timestamp, and mark unavailable upstream/security/hardware evidence as **unknown** or **pending**, never **passed**.

