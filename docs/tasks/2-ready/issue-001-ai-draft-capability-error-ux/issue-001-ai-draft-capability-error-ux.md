---
type: issue
id: issue-001
slug: ai-draft-capability-error-ux
owner:
verifier:
created: 2026-10-04
priority: p1
submitter:
blocked_ask:
---

# issue-001 — AI draft capability and error UX

Make AI drafting capability-aware and failure-safe without making external model calls in development or tests. The existing remote BYOK capability advertises image support based on endpoint locality, not selected model; `buildAiDraftRequest.ts` already gates image attachments on the capability supplied to it. Unknown model capability must not be guessed from a model name.

Allow a safe text-only path. When images are supported and included, keep them user-controlled and bounded. On failures, show a sanitized, actionable explanation and preserve the user's edits and captured evidence for retry. A hypothesis that a particular model rejects screenshots is not a diagnosis; establish the actual request/capability contract before changing provider behavior.

Subscription-backed ChatGPT transport is separately scoped to the approved Linux helper/extension ticket `issue-002-linux-siwc-helper-extension`. Keep this issue focused on API-key AI drafting capability and error UX; do not duplicate helper/auth work here.

## Acceptance

- Capability handling is explicit and tested: supported, unsupported, and unknown image capability are distinguished; unknown defaults to text-only. Never infer vision support from model identifiers or brand names.
- The user can choose text-only drafting without losing capture context or existing report content; unsupported providers never receive image payloads.
- Provider/model errors map to concise, actionable UI guidance without exposing API keys, authorization headers, raw response bodies, or untrusted provider text.
- A failed/aborted draft leaves user-authored text and evidence intact and retryable; tests cover representative auth, unsupported-capability, quota/overload, malformed/empty response, and network failures.
- Tests use deterministic mocks only. No live model call, credentials, or provider spend.


## Acceptance Ledger

| ID | Source | Criterion | Status | Owner | Verifier | Evidence | Note |
|----|--------|-----------|--------|-------|----------|----------|------|
[ACCEPTANCE-LEDGER-VERIFIER-SEPARATION: STRICT-FROM-HERE]
| AC-ai-draft-capability-error-ux-01 | issue-001 | Capability handling is explicit and tested: supported, unsupported, and unknown image capability are distinguished; unknown defaults to text-only. Never infer vision support from model identifiers or brand names. | OPEN | — | — | — | — |
| AC-ai-draft-capability-error-ux-02 | issue-001 | The user can choose text-only drafting without losing capture context or existing report content; unsupported providers never receive image payloads. | OPEN | — | — | — | — |
| AC-ai-draft-capability-error-ux-03 | issue-001 | Provider/model errors map to concise, actionable UI guidance without exposing API keys, authorization headers, raw response bodies, or untrusted provider text. | OPEN | — | — | — | — |
| AC-ai-draft-capability-error-ux-04 | issue-001 | A failed/aborted draft leaves user-authored text and evidence intact and retryable; tests cover representative auth, unsupported-capability, quota/overload, malformed/empty response, and network failures. | OPEN | — | — | — | — |
| AC-ai-draft-capability-error-ux-05 | issue-001 | Tests use deterministic mocks only. No live model call, credentials, or provider spend. | OPEN | — | — | — | — |
