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

Determine whether a documented, supported ChatGPT/Codex subscription path can be used by this personal tool, distinct from API-key billing. A pasted guide mentioned subscription-token claims but included placeholder endpoints and omitted core authorization protections; those claims are unverified and must not be implemented or repeated as fact.

Research only primary provider documentation and applicable product terms. Do not access stored credentials, browser sessions, or auth flows; do not send requests to provider endpoints or spend credits. Record the supported client/endpoint contract, authorization and token lifecycle requirements, permitted use, limitations, and whether a supported path exists. If evidence is inconclusive, say so and leave implementation blocked.

## Acceptance

- A reviewer can trace each conclusion to current primary provider documentation or an explicit unresolved question.
- The result distinguishes subscription entitlements from API access and states any terms/product restrictions without extrapolating.
- No OAuth/token code, credential reads, browser auth, provider calls, or spend occurs.
- If a supported path is confirmed, define a follow-on implementation contract and security review gate. Otherwise document the blocker and retain API-key support without claiming subscription support.


## Acceptance Ledger

| ID | Source | Criterion | Status | Owner | Verifier | Evidence | Note |
|----|--------|-----------|--------|-------|----------|----------|------|
[ACCEPTANCE-LEDGER-VERIFIER-SEPARATION: STRICT-FROM-HERE]
| AC-supported-subscription-ai-contract-01 | spike-001 | A reviewer can trace each conclusion to current primary provider documentation or an explicit unresolved question. | OPEN | — | — | — | — |
| AC-supported-subscription-ai-contract-02 | spike-001 | The result distinguishes subscription entitlements from API access and states any terms/product restrictions without extrapolating. | OPEN | — | — | — | — |
| AC-supported-subscription-ai-contract-03 | spike-001 | No OAuth/token code, credential reads, browser auth, provider calls, or spend occurs. | OPEN | — | — | — | — |
| AC-supported-subscription-ai-contract-04 | spike-001 | If a supported path is confirmed, define a follow-on implementation contract and security review gate. Otherwise document the blocker and retain API-key support without claiming subscription support. | OPEN | — | — | — | — |
