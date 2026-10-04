---
type: issue
id: issue-002
slug: linux-siwc-helper-extension
owner: linux-helper-implementation
verifier:
created: 2026-10-04
priority: p1
submitter:
blocked_ask: Maintainer authorization for a separate live Linux installation, SIWC sign-in, and inference run.
---

# issue-002 — Linux SIWC helper and extension integration

Implement the Linux-first local companion and extension Native Messaging protocol for ChatGPT Sign in with ChatGPT (SIWC), using the source-verified contract recorded in [`spike-001`](../../1-backlog/spike-001-supported-subscription-ai-contract/spike-001-supported-subscription-ai-contract.md) and the approved [implementation plan](../../../plans/multi-account-and-ai-drafting-plan.md). Parent approved this scope. Tim selected a local helper and Linux first.

This ticket authorizes protocol and product-code implementation, not live OAuth, inference, or system installation. Do not copy the Noncommercial SIWC SDK devkit into this MIT fork. Those real-user actions remain explicit and are not test setup.

Primary sources: [OpenAI SIWC guide](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) and [preview limitations](https://developers.openai.com/siwc/preview-limitations).

## Acceptance

- The Linux helper and extension implement a validated Native Messaging request/response protocol for SIWC and draft requests using `chatgpt.tokens.use.direct`. Tokens remain in helper-protected storage and are not returned to the extension or written to logs; do not use DNR interception.
- The SIWC flow follows the official dynamic-registration contract and uses only `http://127.0.0.1:<port>/<fixed-path>` as its callback. Start the loopback listener before opening the browser; do not use the undocumented `chromiumapp.org` callback.
- The helper's Responses API adapter sets `store: false` and `stream: true`, discovers available models at runtime, and sends images only when the selected model's capability supports them.
- Installer/manifest generation accepts an exact caller extension ID allowlist for this fork and fails closed if the ID is missing or invalid. It emits only explicitly supplied fork IDs, never a wildcard, and does not hardcode or use the upstream BugShot extension ID. Tests use a forbidden-upstream-ID fixture and validate the generated allowlist without writing OS native-host registration files or running the installer.
- Deterministic tests exercise helper/extension protocol, callback ordering, error handling, request privacy flags, model discovery, and allowlist validation using fakes only. Tests must not launch auth, call live provider endpoints, access credentials, register a native host, or install system components.
- **Live acceptance:** Verify a real Linux SIWC sign-in followed by subscription-backed inference and user-level system installation in an explicit user-authorized live run. Mocked auth, fixture tokens, and fake Responses API tests do not satisfy this criterion.


## Acceptance Ledger

| ID | Source | Criterion | Status | Owner | Verifier | Evidence | Note |
|----|--------|-----------|--------|-------|----------|----------|------|
[ACCEPTANCE-LEDGER-VERIFIER-SEPARATION: STRICT-FROM-HERE]
| AC-linux-siwc-helper-extension-01 | issue-002 | The Linux helper and extension implement a validated Native Messaging request/response protocol for SIWC and draft requests using `chatgpt.tokens.use.direct`. Tokens remain in helper-protected storage and are not returned to the extension or written to logs; do not use DNR interception. | DONE | fork-implementation@2026-10-04 | — | test: native/chatgpt-host/test/security.test.js; src/sidepanel/lib/__tests__/nativeChatGptBridge.test.ts | Awaiting independent acceptance; see integration receipt. |
| AC-linux-siwc-helper-extension-02 | issue-002 | The SIWC flow follows the official dynamic-registration contract and uses only `http://127.0.0.1:<port>/<fixed-path>` as its callback. Start the loopback listener before opening the browser; do not use the undocumented `chromiumapp.org` callback. | DONE | fork-implementation@2026-10-04 | — | test: native/chatgpt-host/test/security.test.js | Awaiting independent acceptance; see integration receipt. |
| AC-linux-siwc-helper-extension-03 | issue-002 | The helper's Responses API adapter sets `store: false` and `stream: true`, discovers available models at runtime, and sends images only when the selected model's capability supports them. | DONE | fork-implementation@2026-10-04 | — | test: native/chatgpt-host/test/api.test.js; src/sidepanel/lib/__tests__/nativeChatGptProvider.test.ts | Awaiting independent acceptance; see integration receipt. |
| AC-linux-siwc-helper-extension-04 | issue-002 | Installer/manifest generation accepts an exact caller extension ID allowlist for this fork and fails closed if the ID is missing or invalid. It emits only explicitly supplied fork IDs, never a wildcard, and does not hardcode or use the upstream BugShot extension ID. Tests use a forbidden-upstream-ID fixture and validate the generated allowlist without writing OS native-host registration files or running the installer. | DONE | fork-implementation@2026-10-04 | — | test: native/chatgpt-host/test/launcher.test.js | Awaiting independent acceptance; see integration receipt. |
| AC-linux-siwc-helper-extension-05 | issue-002 | Deterministic tests exercise helper/extension protocol, callback ordering, error handling, request privacy flags, model discovery, and allowlist validation using fakes only. Tests must not launch auth, call live provider endpoints, access credentials, register a native host, or install system components. | DONE | fork-implementation@2026-10-04 | — | test: native/chatgpt-host/test/security.test.js; docs/verification/2026-10-04-fork-integration.md | Awaiting independent acceptance; see integration receipt. |
| AC-linux-siwc-helper-extension-06 | issue-002 | Live acceptance: Verify a real Linux SIWC sign-in followed by subscription-backed inference and user-level system installation in an explicit user-authorized live run. Mocked auth, fixture tokens, and fake Responses API tests do not satisfy this criterion. | BLOCKED | — | — | — | Tim to explicitly authorize and perform live SIWC sign-in, inference, and user-level installation when ready; mocks cannot satisfy this criterion. |

## Implementation receipt

[Integrated verification and remaining limits](../../../verification/2026-10-04-fork-integration.md). Implementation evidence is recorded as `DONE`, not independent `VERIFIED` acceptance. No ticket is being self-accepted or closed.

AC06 remains blocked on explicit live-run authorization. Subscription drafting is deliberately text-only.
