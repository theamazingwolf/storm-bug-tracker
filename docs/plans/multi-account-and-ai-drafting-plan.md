# Storm Bug Tracker: connection routing and AI drafting plan

**Status:** proposed backlog plan; no feature implementation authorized in this bootstrap. Related tickets: `prd-001`, `issue-001`, and `spike-001` in `docs/tasks/1-backlog/`.

## Current source contracts

- `src/store/settings-store.ts` persists provider connections as an `accounts` object keyed by `PlatformId`; GitHub and Linear each have a single optional account today. `src/types/github.ts` and `src/types/linear.ts` model provider auth and defaults; `PlatformAccountBase` is in `src/types/platform.ts`.
- GitHub supports PAT/OAuth; Linear supports API key/OAuth. Their provider-specific connection and API flows live in `src/sidepanel/tabs/connect/`, `src/background/github-*`, and `src/background/linear-*`. Existing providers share the `PlatformId`/`Accounts` contract and must continue to work.
- Submit defaults and last-used fields are currently part of the account/settings contracts. Destination matching must not silently mutate those values or conflate an account with a repository/team destination.
- AI configuration is separate: `src/store/settings-ui-store.ts` owns `LlmConfig`, distinct from integration `settings-store.ts`. `src/sidepanel/lib/ai-provider.ts` exports `BYOK_CAPABILITIES` with `supportsImages: true`; `byokCapabilities(baseUrl)` distinguishes loopback from remote endpoints but does not inspect the model. `src/sidepanel/lib/buildAiDraftRequest.ts` already omits images when the supplied capability says images are unsupported. Capability provenance, not a model-name guess, must decide whether images can be sent.
- AI Draft's request construction, section preservation, and UI are in `src/sidepanel/lib/buildAiDraftRequest.ts`, `src/sidepanel/lib/mergeAiDraftSections.ts`, and `src/sidepanel/tabs/AiDraftDialog.tsx`. `docs/ARCHITECTURE.md` → “AI 통합” describes request trimming, protected content, current provider errors, and the client-side egress boundary.

## Product boundaries

- Build only for GitHub and Linear first; preserve all existing providers and their single-account behavior.
- Capture → explicit user-authorized GitHub/Linear submission → repository backlog → execution is the intended flow. Polling/importing external issues or other external intake automation is not part of this scope.
- No server-side capture storage, full redesign, billing, hosting, or connector expansion.
- No live model, auth, GitHub, or Linear calls in tests. No provider credentials or spend.
- ChatGPT/Codex subscription access is unresolved. `spike-001` is research-only; do not implement pasted OAuth claims or assume official support. No credential/browser-session access or auth attempt.

## Shared contracts and work lanes

Implement in dependency order after a separate feature-plan approval. Keep file ownership disjoint; contracts below are the integration boundaries.

### Lane A — shared account and routing schema (foundation)

**Owns:** `src/types/platform.ts`, `src/types/github.ts`, `src/types/linear.ts`, `src/store/settings-store.ts`, and the corresponding store/type tests.

Define stable app-local `accountId` values and represent multiple GitHub accounts and independent Linear organization connections without using secrets as identifiers. Add an explicit destination reference discriminated by provider and account, with provider-native target identifiers (GitHub owner/repository; Linear team and optional project). Define website-origin rules separately from account defaults. Migrate the existing singleton entries deterministically, preserving auth, defaults, and last-submit state; do not duplicate or log tokens. This lane owns persistence/migration only, not connection UI or matching behavior.

**Contract:** connection/UI, routing, and submit lanes import the account/destination/rule types and use store actions; they do not redefine persistence or add fields to the shared store themselves.

### Lane B — connection manager and account identity

**Owns:** GitHub/Linear connection UI and provider-specific connect/disconnect/account-selection behavior under `src/sidepanel/tabs/connect/`, plus the directly related background identity helpers and tests. It does not edit Lane A's shared type/store files or Lane C's routing components.

Support adding, selecting, and removing one of several GitHub accounts and independently connecting multiple Linear organizations. OAuth/PAT/API-key methods retain existing provider behavior. Account labels must be useful without exposing tokens. Existing accounts migrate and remain selectable.

**Depends on:** Lane A contract and migration tests.

### Lane C — exact-origin routing and mapping UX

**Owns:** a pure URL-origin normalizer/matcher and tests under `src/lib/`, plus separate website mapping UI components/tests under a dedicated settings subtree. It consumes Lane A's mapping contract and must not edit Lane A's schema/store or Lane D's submission adapters.

Default comparison is exact normalized origin: scheme, host, and effective port. Normalize host casing and default ports using the URL standard. Do not use suffix/fuzzy matching, wildcard matching, or path prefix as implicit grants. Multiple origins may intentionally target one repository, including a monorepo. If one origin has multiple valid destinations, prompt rather than guess. An unmatched origin offers inline connect/choose and a separate explicit “remember this mapping” action. Every prefill is user-overridable. Add path-level matching only if product evidence requires it and then make it opt-in, explicit, and covered by separate tests.

**Depends on:** Lane A contract. Mapping UI owns rule editing; it does not submit reports.

### Lane D — capture prefill and stable destination binding

**Owns:** capture-to-draft routing orchestration, draft destination snapshot/persistence, and the submit/retry boundary under the editor/draft and `src/sidepanel/lib/submitAdapters.ts` surfaces. It does not edit Lane A's schema/store or Lane C's matching/mapping UI.

Consume Lane C's `matched | unmatched | ambiguous` result. Store an immutable destination binding on the draft before upload or submission: provider, `accountId`, and provider-native destination identifiers. Re-resolve only when the user explicitly changes destination; never use whichever account/site happens to be active when a saved draft is retried. Cover initial capture, switching tabs, draft save/reopen, upload, retry, and resubmission.

**Depends on:** Lanes A and C contracts. External submission remains an explicit user action.

### Lane E — AI capability, text-only, and failure-safe drafting

**Owns:** `settings-ui-store.ts`, AI provider capability/model metadata and request composition (`src/sidepanel/lib/ai-provider.ts`, `buildAiDraftRequest.ts`), relevant AI Draft UI/prompt handling, and AI-specific tests. This lane is separate from integration `settings-store.ts` and account/routing lanes.

Use captured context and optional user instruction to draft. Support an explicit safe text-only option. Images may be sent only when capability is affirmatively supported by an authoritative provider/model contract or explicit verified user setting; unknown capability defaults to no images. Do not infer vision from a provider/model label. Errors should name a useful next action while sanitizing provider responses and never exposing API keys/headers. On error or cancellation preserve user edits, captured evidence, and retryability. Treat the reported DeepSeek v4 Flash screenshot incompatibility only as an unverified hypothesis until the actual contract/request is checked.

**Independent of:** account/routing feature. Subscription work must wait for Lane F's evidence and a separate approved implementation ticket.

### Lane F — subscription path evidence (research-only spike)

**Owns:** `spike-001` research artifact only. Use primary, current provider documentation and applicable terms to determine whether a supported subscription-backed ChatGPT/Codex client path exists and its auth/security/use constraints. Do not access credentials, browser sessions, or auth endpoints. No implementation in this lane. If supported, create a follow-on ticket with security review and explicit user approval; if inconclusive or unsupported, document the blocker and retain API-key support.

## Verification plan

Use deterministic mocks only. Before local test/typecheck runs, seed the ignored local environment with the repository's public dummy config: `cp .env.ci .env.local`. Do not substitute real provider configuration. CI's `verify` and `e2e` jobs must both load this dummy config before tests/builds; `docs/CI.md` documents that no real credentials are needed. Baseline verification on a separate untouched worktree passed after this setup: typecheck passed; `pnpm test` passed (433/433 files, 8,525 passed, 2 skipped). This is evidence for the current base only, not feature acceptance.

Focused commands to extend with new lane tests:

- Account migration/identity: `pnpm test --run src/store/__tests__/settings-store.test.ts src/background/__tests__/github-oauth.test.ts src/background/__tests__/linear-oauth.test.ts src/sidepanel/tabs/connect/__tests__/PlatformConnectFlow.test.tsx`.
- Origin matcher: add `src/lib/__tests__/site-destination-routing.test.ts` and run it with `pnpm test --run src/lib/__tests__/site-destination-routing.test.ts`.
- Draft persistence/submission binding: add focused draft and retry tests alongside the current draft store/submit-adapter tests; cover immutable binding and account mismatch without issuing a request.
- AI: `pnpm test --run src/sidepanel/lib/__tests__/ai-provider.test.ts src/sidepanel/lib/__tests__/buildAiDraftRequest.test.ts src/sidepanel/tabs/__tests__/AiDraftDialog.test.tsx` and new UI/error preservation tests.
- After each lane integration: `pnpm typecheck`; targeted unit/UI tests; then `pnpm test` and `pnpm build`. For browser-visible routing and retry flows, run `pnpm build:e2e` and the focused Playwright specs, then the full `pnpm test:e2e` gate.

The current source checkout has not been independently baseline-tested in this worktree. Parent baseline evidence is separate; do not treat it as evidence for this branch's new content.
