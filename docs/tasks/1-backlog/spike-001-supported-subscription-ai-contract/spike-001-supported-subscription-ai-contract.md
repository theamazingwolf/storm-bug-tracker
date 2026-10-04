---
type: spike
id: spike-001
slug: supported-subscription-ai-contract
owner:
verified_by:
created: 2026-10-04
priority: p2
submitter:
blocked_ask:
---

# spike-001 — supported subscription AI contract

Parent verification of current official OpenAI documentation confirmed that Sign in with ChatGPT (SIWC) supports OSS/local personal tools using dynamic client registration and the `chatgpt.tokens.use.direct` scope. This is a documented subscription-backed path, distinct from API-key billing. Tim selected a local helper and Linux first; parent approved protocol/extension implementation in `issue-002-linux-siwc-helper-extension`. This evidence ticket does not authorize live sign-in, inference, or system installation.

Important verified constraints:

- The callback must be `http://127.0.0.1:<port>/<fixed-path>` with the listener started before opening the browser. The official guide does not document a `chromiumapp.org` callback.
- Responses API use must set `store: false` and `stream: true`; discover models live rather than assuming a fixed model. Image support depends on the selected model.
- The SIWC SDK devkit is Noncommercial licensed and must not be copied into this MIT-licensed fork.
- Parent recommends a native-messaging local companion rather than unsupported DNR interception. Tim selected the local-helper approach and Linux first.

Evidence: [OpenAI SIWC guide](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) and [preview limitations](https://developers.openai.com/siwc/preview-limitations).

This ticket preserves the source evidence; implementation is tracked separately in `issue-002-linux-siwc-helper-extension`. No live sign-in, inference, credential access, provider call, or system installation is performed as part of this evidence ticket. The approved account/routing and API-key AI capability/error work remain independent.

## Acceptance

- Preserve the primary-source citations and constraints above in a reviewable implementation plan.
- Preserve the source-verified contract and Tim's local-helper/Linux decision in the approved plan and link the implementation boundaries to `issue-002-linux-siwc-helper-extension`.
- Keep the implementation security constraints explicit. Live SIWC sign-in, subscription inference, and system installation remain explicit user actions and are not proven by mocks.
- Do not use the Noncommercial SDK devkit in the MIT fork, the undocumented extension callback, or DNR interception.
- No live OAuth/token use, credential reads, browser auth, provider calls, or spend occurs in this evidence ticket; implementation code is owned by `issue-002-linux-siwc-helper-extension`.


## Acceptance Ledger

| ID | Source | Criterion | Status | Owner | Verifier | Evidence | Note |
|----|--------|-----------|--------|-------|----------|----------|------|
[ACCEPTANCE-LEDGER-VERIFIER-SEPARATION: STRICT-FROM-HERE]
| AC-supported-subscription-ai-contract-01 | spike-001 | Preserve the primary-source citations and constraints above in a reviewable implementation plan. | OPEN | — | — | — | — |
| AC-supported-subscription-ai-contract-02 | spike-001 | Preserve the source-verified contract and Tim's local-helper/Linux decision in the approved plan and link the implementation boundaries to `issue-002-linux-siwc-helper-extension`. | OPEN | — | — | — | — |
| AC-supported-subscription-ai-contract-03 | spike-001 | Keep the implementation security constraints explicit. Live SIWC sign-in, subscription inference, and system installation remain explicit user actions and are not proven by mocks. | OPEN | — | — | — | — |
| AC-supported-subscription-ai-contract-04 | spike-001 | Do not use the Noncommercial SDK devkit in the MIT fork, the undocumented extension callback, or DNR interception. | OPEN | — | — | — | — |
| AC-supported-subscription-ai-contract-05 | spike-001 | No live OAuth/token use, credential reads, browser auth, provider calls, or spend occurs in this evidence ticket; implementation code is owned by `issue-002-linux-siwc-helper-extension`. | OPEN | — | — | — | — |
