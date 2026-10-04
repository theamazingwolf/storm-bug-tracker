# Fork integration verification — 2026-10-04

Code checkpoint: `cc3a073` on `dev`. This is a source-review receipt, not a production release or live-provider acceptance.

## Results

| Gate | Result |
| --- | --- |
| TypeScript | `pnpm typecheck` passed |
| Extension unit/integration tests | 8,823 passed, 2 skipped, 454 files |
| Native helper tests | 29 passed; helper syntax checks passed |
| Production build | Passed; pre-arm chunk validation passed |
| Chromium regression suite | 372 passed across four shards (106 / 81 / 92 / 93) |
| New destination smoke tests | 2 passed, separately from the four shards |
| Targeted capture/provider/onboarding flows | 21 passed, including those 2 smoke tests; not additional to the totals above |
| Built manifest | No upstream extension key; `nativeMessaging` permission present |

The final full unit/helper/build run followed the removed-account retry fix. Browser shard 1 was rebuilt and rerun after that fix. Other shards and the destination smoke tests passed on the preceding browser artifact; the last production change only changes the missing-bound-account retry stop reason, covered by shard 1 and a new unit regression.

## Reproduction

Use Node/pnpm versions documented by the repository and the dummy `.env.ci` values for tests. Never supply real provider credentials to these tests.

```sh
pnpm typecheck
pnpm exec vitest run --maxWorkers=4 --minWorkers=1
npm ci --ignore-scripts --prefix native/chatgpt-host
npm test --prefix native/chatgpt-host
npm run check --prefix native/chatgpt-host
pnpm build
node scripts/check-prearm-chunk.mjs dist
pnpm build:e2e
E2E_LOCAL_ONLY=1 E2E_SHOW=1 xvfb-run -a \
  --server-args='-screen 0 1920x1080x24' \
  pnpm exec playwright test --config e2e/playwright.config.ts
```

The browser run uses disposable profiles, synthetic credentials, intercepted provider traffic, a loopback fixture server, and external DNS denial. Do not rebuild `dist-e2e` while a browser run is using it.

## Regression coverage and security review

- Connection migration, independent account/workspace settings, exact-origin matching, ambiguous/unmatched origins, inline setup, saved destination overrides, and immutable restored snapshots have automated coverage. `e2e/storm-destination-routing.spec.ts` exercises the actual capture → save → submit-modal flow, including a nonselected bound account and profile edits after capture.
- Slack promotion preserves the original record on failure. Recovery tests retain no-create/no-cross-provider assertions. Local OAuth-configuration probes are distinguished from external provider operations. A removed bound account stops before any provider request and leaves the recovery journal unchanged.
- Remote AI images require explicit approval of the exact endpoint/model. Local and subscription transports remain text-only. Tests cover preserved text/evidence, cancellation, retry, safe errors, and no subscription-to-paid-API fallback.
- Independent security review reproduced the pre-fix deleted-account resurrection and stale-token overwrite attacks, then checked grant-bound token overlays and fail-closed resolution after the fixes.
- Independent native-helper review exercised cryptographic validation, real framed pipes, extension/helper seams, generated launchers, cancellation and grant fencing with synthetic fixtures. Follow-up regressions require JWT expiration and count the four-byte native-message header in the total frame limit.

## Remaining limits and acceptance

- **Live helper acceptance is blocked.** No real helper installation, SIWC sign-in, provider inference, existing credential access, or client-data transmission was performed. The maintainer must explicitly authorize a separate live run. Helper AC06 remains `BLOCKED`.
- **GitHub website-cookie attachment uploads are not atomically account-bound.** API issue operations and destination snapshots are explicitly connection-bound, but a successful upload under a changed browser cookie session is outside that guarantee. Use the documented manual/download fallback when that distinction matters.
- No diagnosis of any specific model's image compatibility was established by these mock-only tests.
- No deployment or Chrome Web Store publication is part of this receipt. Upstream MIT attribution is retained. Build chunk-size warnings remain nonfatal.
- Implementer acceptance rows stop at `DONE`, not `VERIFIED`. Tickets await independent acceptance review; security-specific reviews do not substitute for whole-ticket acceptance.
