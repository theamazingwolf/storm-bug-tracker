---
type: spike
id: spike-001
slug: supported-subscription-ai-contract
owner:
verified_by:
created: 2026-10-04
priority: p2
submitter:
blocked_ask: Tim to choose the local helper approach and specify the target host OS before implementation work proceeds.
---

# spike-001 — supported subscription AI contract

Parent verification of current official OpenAI documentation confirmed that Sign in with ChatGPT (SIWC) supports OSS/local personal tools using dynamic client registration and the `chatgpt.tokens.use.direct` scope. This is a documented subscription-backed path, distinct from API-key billing. It is not authorization to register an app or implement/authenticate it.

Important verified constraints:

- The callback must be `http://127.0.0.1:<port>/<fixed-path>` with the listener started before opening the browser. The official guide does not document a `chromiumapp.org` callback.
- Responses API use must set `store: false` and `stream: true`; discover models live rather than assuming a fixed model. Image support depends on the selected model.
- The SIWC SDK devkit is Noncommercial licensed and must not be copied into this MIT-licensed fork.
- Parent recommends a native-messaging local companion rather than unsupported DNR interception. Tim's helper choice and target host OS are still required before the subscription lane can proceed.

Evidence: [OpenAI SIWC guide](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) and [preview limitations](https://developers.openai.com/siwc/preview-limitations).

No credentials, browser sessions, registration, live auth, endpoint calls, or provider spend are authorized. Keep this ticket blocked until Tim supplies the local helper choice and target host OS. Account/routing and API-key-based AI capability/error work remain independent and may proceed under their own plan approval.

## Acceptance

- Preserve the primary-source citations and constraints above in a reviewable implementation plan.
- After the helper and OS decision, specify the local companion protocol, loopback listener lifecycle, dynamic registration/token flow, model discovery, storage/privacy contract, failure handling, and cross-platform boundaries.
- Security review the actual design before implementation; require explicit approval before registration or auth flow tests.
- Do not use the Noncommercial SDK devkit in the MIT fork, the undocumented extension callback, or DNR interception.
- No OAuth/token code, credential reads, browser auth, provider calls, or spend occurs during this blocked spike.


## Acceptance Ledger

| ID | Source | Criterion | Status | Owner | Verifier | Evidence | Note |
|----|--------|-----------|--------|-------|----------|----------|------|
[ACCEPTANCE-LEDGER-VERIFIER-SEPARATION: STRICT-FROM-HERE]
| AC-supported-subscription-ai-contract-01 | spike-001 | Preserve the primary-source citations and constraints above in a reviewable implementation plan. | OPEN | — | — | — | — |
| AC-supported-subscription-ai-contract-02 | spike-001 | After the helper and OS decision, specify the local companion protocol, loopback listener lifecycle, dynamic registration/token flow, model discovery, storage/privacy contract, failure handling, and cross-platform boundaries. | OPEN | — | — | — | — |
| AC-supported-subscription-ai-contract-03 | spike-001 | Security review the actual design before implementation; require explicit approval before registration or auth flow tests. | OPEN | — | — | — | — |
| AC-supported-subscription-ai-contract-04 | spike-001 | Do not use the Noncommercial SDK devkit in the MIT fork, the undocumented extension callback, or DNR interception. | OPEN | — | — | — | — |
| AC-supported-subscription-ai-contract-05 | spike-001 | No OAuth/token code, credential reads, browser auth, provider calls, or spend occurs during this blocked spike. | OPEN | — | — | — | — |
