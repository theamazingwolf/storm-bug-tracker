# Storm Bug Tracker ChatGPT native helper (Linux)

This is an independently implemented, draft-only local companion for Linux, wired to the extension's ChatGPT subscription settings. It uses the public Sign in with ChatGPT OAuth contract and a Chrome Native Messaging host. It does not use the OpenAI DevKit source, Codex credentials, browser cookies, ChatGPT backend APIs, redirect interception, or a first-party Codex client ID.

## Boundary and current status

- Native host name: `com.storm.bug_tracker.chatgpt`.
- Node.js 20+; `jose` verifies ID-token signatures against OpenAI's public JWKS. No custom JOSE/signature implementation.
- Credentials are stored in `~/.config/storm-bug-tracker/chatgpt/` by default, directory `0700`, files `0600`; override only with `STORM_BUG_TRACKER_CHATGPT_HOME` for isolated tests or an explicitly configured user path.
- The helper only accepts user-originated Native Messaging method requests. It has no shell tool, MCP, agent, filesystem browsing, or arbitrary URL surface. The only browser launch is an explicit `signIn` method and invokes fixed `xdg-open` with the constructed OpenAI authorization URL using `shell:false`.
- Draft requests are text-only for now. Images are rejected explicitly; no audio/video or arbitrary local paths are accepted.
- Native Messaging frames are length-prefixed JSON, capped at 256 KiB total per request and response, including the four-byte header. Stdout carries only protocol frames. Diagnostics to stderr contain only normalized codes. The host accepts at most 32 concurrent auth/model/draft requests; SSE is capped at 1 MiB per unterminated event and 8 MiB total.
- Inference uses only `GET https://api.openai.com/v1/models` and `POST https://api.openai.com/v1/responses`, the account-visible selected model, `store:false`, `stream:true`, and a bounded `instructions` + `input` request. Optional app instructions are limited to 16,000 UTF-8 bytes; the host prepends a fixed untrusted-capture guard, while captured text stays separate in user input. The only success signal is `response.completed`.
- Sign-out clears local tokens. This implementation does not attempt remote revocation; `remoteRevocation: "not_attempted"` is explicit. User can disconnect Storm Bug Tracker in ChatGPT settings.

## Setup (explicit user action only)

Install dependencies in this directory, then provide the **exact ID of the user's Storm Bug Tracker fork extension**. IDs are validated as 32 lowercase `[a-p]` characters; wildcard origins and upstream BugShot IDs are not accepted by default. The installer writes a user-space Native Messaging manifest and its owner-only executable launcher. It does not install Node, change system files, launch Chrome, or grant host permissions. Review the generated file before restarting Chrome/Chromium.

```sh
cd native/chatgpt-host
npm ci
node install.js --browser chrome --extension-id <exact-fork-extension-id>
# or: node install.js --browser chromium --extension-id <exact-fork-extension-id>
```

The optional `--config-root` exists for tests and deliberate alternate user-space setups. Never point it at a system directory. Remove only a manifest matching the requested host and extension ID:

```sh
node uninstall.js --browser chrome --extension-id <exact-fork-extension-id>
```

Native host manifests should be verified in the expected user locations:

- Chrome: `~/.config/google-chrome/NativeMessagingHosts/com.storm.bug_tracker.chatgpt.json`
- Chromium: `~/.config/chromium/NativeMessagingHosts/com.storm.bug_tracker.chatgpt.json`

The browser manifest has a single exact `allowed_origins` entry and points to an owner-only generated shell launcher; it uses only Chrome's documented manifest fields. The launcher passes the exact fork ID to the host, which independently checks Chrome's caller origin. The extension's runtime ID is path-derived and can change when its unpacked path changes. Re-register the helper with the exact current ID: uninstall using the old exact ID, then install using the new exact ID. The upstream BugShot ID is a reject-only guard and test fixture; it is never generated as an allowed origin. Installer scripts have only been tested with temporary fixture directories; they have not been run against a real home directory, system, or browser registry.

## Native Messaging contract v1

Every request is `{ "id": string|safe-integer, "method": string, "params": object }`. Responses correlate by `id` and are either `{ "id", "result" }` or `{ "id", "error": { "code", "message" } }`. IDs are required, unique while in flight, and at most 128 characters when strings. Unknown keys and methods are rejected. Error messages are fixed safe user-facing text; token values and upstream bodies are never returned. During drafting the helper may emit `{ "event":"draftDelta", "data": { "requestId": id, "delta": text } }` frames before the final result. Extension consumers must ignore unknown events and never interpret streamed deltas as a completed draft.

| Method | Params | Result |
|---|---|---|
| `status` | `{}` | `{connected, activeProfileId, profile, planEnabled, imageInput:"unsupported"}`. Does not sign in or refresh. `connected` means the process has an active, signed-in profile; it is not a Native Messaging reachability probe. Empty-store status is `connected:false`, but the reachable host still accepts first sign-in. After host restart `activeProfileId` is `null` until selected; callers with a saved profile must pass its ID explicitly for model listing/draft. |
| `signIn` | `{profileId?: string, reconnect?: boolean}` | `{profileId, email, planEnabled, active:true}`. Explicitly launches browser. `profileId` reconnects only that saved registration; otherwise starts dynamic registration. A callback cannot replace a different registration's client ID/account. |
| `listProfiles` | `{}` | `{profiles:[{id,email,subject,clientId,signedIn,planEnabled}]}`; never tokens. |
| `selectProfile` | `{profileId}` | `{profileId,selected:true}`. Selects existing saved identity; no OAuth or inference. |
| `listModels` | `{profileId?: string}` | `{profileId,models:[{slug,displayName}]}` from selected-account `visibility:"list"` results. |
| `draft` | `{profileId?: string,model:string,text:string,imageChoice?:"text-only",instructions?:string}` (`instructions` ≤16,000 UTF-8 bytes) | `{profileId,text,completed:true}` only after `response.completed`. Caller instructions are additive to the host safety guard. Capture text stays in user input. `images` always fails explicitly as unsupported. |
| `cancel` | `{requestId:string|safe-integer}` | `{requestId,cancelled:boolean}`; aborts matching in-flight authorization/draft. |
| `signOut` | `{profileId}` | `{profileId,localCredentialsCleared:true,remoteRevocation:"not_attempted",detail}`. Local clearing is not remote revoke. |

Profile IDs are helper-generated opaque hashes of validated issuer, subject and issued client ID; callers do not get to choose storage paths. The account subject plus issued client ID stay bound. A valid ID token without `chatgpt.tokens.use.direct` is not enabled for drafting. New registration sends `dynamic_agent_client` only to authorization; the issued callback client ID is saved and used for token exchange and future sign-ins. A missing OIDC email remains `null`; the helper never invents an email value.

## OAuth/security details

- Loopback listener binds only to `127.0.0.1` on an ephemeral port and exact `/auth/callback`; Host and route are checked. It is started before the browser launch, has a timeout, and closes on success/cancel/error.
- Fresh state, OIDC nonce and PKCE S256 are generated per attempt. Callback state, route, OAuth error, issued-vs-saved client ID, callback scheme/host/path are validated. Authorization uses the same redirect URI in exchange.
- ID tokens are verified using `jose` with RS256, issuer, issued client ID audience, expiry, JWKS, and nonce; returning identity must match. Plan scope is checked in the token response. Refresh tokens rotate together with access/ID tokens and expiry in an atomic owner-only file replacement; owner-checked profile lock directories serialize refresh/sign-in/sign-out across host processes, and `earliest_refresh_at` is honored. A dead lock owner is recovered after PID liveness checks; `.lock-recovery` or `.stale-lock-*` left by a crash/tamper event requires inspecting the private data directory before manual cleanup.
- The extension never receives access, refresh, or ID tokens. No secret is placed in browser storage, logs, frames, URL diagnostics, or error messages.
- Usage-limit errors stop the draft and direct the user to ChatGPT usage settings. No API-key or paid-inference fallback exists.

## Timeouts and error codes

Operation caps stay inside the frontend bridge contract: sign-in 110 s (bridge 120 s), model listing 25 s (30 s), draft 160 s (180 s), sign-out lock wait 8 s (bridge 10 s), cancel 5 s (immediate control path). Token exchange is capped at 30 s. Status/listProfiles/selectProfile perform local filesystem work only; status `connected` retains the active-authenticated-profile meaning above. The safe error-code allowlist is defined by `src/security.js`; key public codes include `authorization_denied`, `authorization_cancelled`, `authorization_timeout`, `browser_open_failed`, `invalid_state`, `plan_scope_not_granted`, `profile_not_found`, `profile_not_signed_in`, `profile_lock_busy`, `token_refresh_not_yet_allowed`, `model_not_available`, `subscription_sharing_usage_limit_exceeded`, `images_unsupported`, `instructions_too_large`, `request_too_large`, `request_cancelled`, `draft_timeout`, `timeout`, and `request_failed`. Unknown or unsafe codes collapse to `request_failed`; messages remain fixed and do not include provider bodies.

## Local verification

```sh
npm ci
npm test
npm run check
```

The tests use injected fetch, browser, verifier, and temporary filesystem paths. They make no provider calls and use fake test credentials. Independent security review and synthetic framed-pipe integration cover the helper and extension bridge. This is not live-acceptance evidence: real Chrome installation, desktop UX, account consent, eligible models, and subscription inference still require an explicitly authorized user test. Remote revocation remains a manual action in ChatGPT settings. Root CI runs this Node suite separately from the extension's Vitest suite.

## Public contract references

- [Sign in with ChatGPT: registration/sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Profiles and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [Errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)
- [Public OIDC discovery metadata](https://auth.openai.com/.well-known/openid-configuration)
