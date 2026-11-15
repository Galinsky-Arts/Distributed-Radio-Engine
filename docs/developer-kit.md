# Developer kit and support matrix (DRE-28)

## Consumer contract

Entry points and their exported names are locked in [public-api.json](public-api.json).

| Entry point | Purpose |
|---|---|
| `@neophilism/distributed-radio-engine` | Contracts, catalog, rights, programs, rotations, sponsors, points, vesting, Grooves, commerce, reporting |
| `./playback` | Web/native radio playback facade (start / stop / recover / status only) |
| `./join` | Authenticated current-position radio join |
| `./vesting-store`, `./point-store` | Durable SQLite endpoint stores (`node:sqlite`) |
| `./reward-prices` | Default exponential reward price ladder |
| `./recording-channels` | Private recording/merchant/buyer binding registry |
| `./stripe` | Stripe sandbox Checkout adapter (official SDK, pinned API version) |

The engine depends on the Distributed Audio Engine through `AUDIO_ENGINE_MODULE`
(absolute path to its built `dist/src/index.js`) at the revision pinned in
`.github/workflows/radio.yml`. Consumers pin both exactly.

## Support matrix

| Surface | Status |
|---|---|
| Node.js 24.19+ (24.x), Linux x64 | Tested in hosted CI on every PR |
| Other Node majors | Unsupported (`engines` refuses) |
| Browser playback facade | Software-tested through DAE browser adapters; no device matrix |
| Android / iOS native output | Via DAE foreground hosts; no supported-device qualification yet |
| SQLite stores | Single writer per store file; no unsynchronized replicas |
| Stripe | Sandbox only; live keys, Connect payouts and refunds not implemented |

## Release procedure

1. On the exact candidate SHA, run `npm ci --ignore-scripts`, `npm audit --audit-level=high`,
   `python3 scripts/check-current-secrets.py` and `npm run check` with the pinned DAE build.
2. Confirm every hosted workflow succeeded at that exact SHA.
3. If exports changed, review consumers, update CHANGELOG.md and regenerate
   `docs/public-api.json` with `node scripts/public-api.mjs --write`.
4. Tag `vX.Y.Z-rc.N` and publish a GitHub **pre-release** with the changelog section.
5. A stable version additionally requires the RELEASE_READINESS.md operational evidence;
   the release-contract test refuses a stable version string until then.
