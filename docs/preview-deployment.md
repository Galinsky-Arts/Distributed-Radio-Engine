# Render development preview

## Deployment record — November 15, 2026

Free Render web service `distributed-radio-engine-preview`
(`srv-dbsvmupsrm7s739q64h0`, https://distributed-radio-engine-preview-btkp.onrender.com)
in the Galinsky Arts workspace, no database. Deploy `dep-dbsvmv1srm7s739q65q0` of
commit `b1d81c9` is live. The build cloned and built Audio Engine `c6fd5fa` and ran
`npm run check`: 289 passed, 0 skipped. Render's `/healthz` probe passed. Auto-deploy
follows `main` after GitHub checks pass. The preview reports status only; it does
not broadcast, stream or award points, and `/readyz` stays 503.

Blueprint: `render.yaml` (free web service `distributed-radio-engine-preview`, no database).

Build command: `npm ci --ignore-scripts && npm run check`, with `DRE_BUILD_AUDIO_ENGINE=1`
and `DRE_REQUIRE_AUDIO_ENGINE=1` so the build clones and builds the Audio Engine revision
pinned in `.github/workflows/radio.yml` and fails rather than skipping DAE-backed suites.

Start command: `node preview-server.mjs` (same as `npm start`). Health check: `/healthz`.

Runtime: Node.js 24 (`NODE_VERSION=24.19.0`); default process listens on `0.0.0.0:$PORT`. No database, media keys, paid cloud tier or sensitive environment variables are needed for the preview.

- `/healthz` returns 200 when this **preview server** is reachable. It does **not** mean radio broadcasting is active.
- `/readyz` and `/api/readiness` return 503 until actual secure live-station prerequisites are met and independently verified.
- `/api/status` returns development and release-gate states; it must never be interpreted as live audio or speaker verification.
- `/` is an explicit disclosure-oriented development-status page.

When a real radio backend is available, replace the readiness handler with real checks for authorized station program, ciphertext delivery, key channels, required rights, and qualified device support. Do not turn readiness green merely to satisfy health dashboards. Engine Room can monitor the health and separate readiness indicators.
