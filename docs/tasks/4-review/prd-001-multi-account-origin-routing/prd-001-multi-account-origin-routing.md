---
type: prd
id: prd-001
slug: multi-account-origin-routing
owner: connection-implementation
verifier:
created: 2026-10-04
priority: p1
submitter:
blocked_ask:
---

# prd-001 — multi-account origin routing

Support independent connections to multiple GitHub accounts and Linear organizations, and route reports from many website origins to a selected issue destination. This is a client-side extension flow; the user remains in control of capture, destination, and submission. GitHub and Linear are first, while existing providers remain supported.

Detailed contracts, disjoint lanes, dependencies, and verification commands: [`docs/plans/multi-account-and-ai-drafting-plan.md`](../../../plans/multi-account-and-ai-drafting-plan.md).

External intake automation is out of scope. The intended flow ends at capture → user-authorized GitHub/Linear submission → repository backlog → human/agent execution; this work does not poll or sync external issues into the repository.

## Acceptance

- GitHub supports multiple independently removable accounts; Linear supports independent organization connections. Existing single-account settings migrate without losing credentials/defaults or changing other providers.
- A website mapping binds one exact origin to an explicit provider account and destination; multiple origins may map to a repository/monorepo destination.
- Matching uses normalized exact origin (scheme, host, effective port), never fuzzy suffixes or wildcard grants. If path-level rules are needed, they are explicit and separately tested.
- A matching origin preselects only an unambiguous destination; ambiguous mappings prompt, unmatched origins offer inline connect/choose and an explicit remember action. A user can override any prefill.
- The chosen destination binding is stable through draft save, upload, retry, and resubmission; changing the current website or active connection cannot silently redirect an existing draft.
- Automated tests cover legacy migration, duplicate accounts, exact origin normalization, ambiguity, overrides, and destination stability. No live connector calls are used in tests.


## Acceptance Ledger

| ID | Source | Criterion | Status | Owner | Verifier | Evidence | Note |
|----|--------|-----------|--------|-------|----------|----------|------|
[ACCEPTANCE-LEDGER-VERIFIER-SEPARATION: STRICT-FROM-HERE]
| AC-multi-account-origin-routing-01 | prd-001 | GitHub supports multiple independently removable accounts; Linear supports independent organization connections. Existing single-account settings migrate without losing credentials/defaults or changing other providers. | DONE | fork-implementation@2026-10-04 | — | test: src/store/__tests__/connection-foundation.test.ts; src/store/__tests__/connection-settings-contract.test.ts | Awaiting independent acceptance; see integration receipt. |
| AC-multi-account-origin-routing-02 | prd-001 | A website mapping binds one exact origin to an explicit provider account and destination; multiple origins may map to a repository/monorepo destination. | DONE | fork-implementation@2026-10-04 | — | test: src/lib/__tests__/site-destination-routing.test.ts | Awaiting independent acceptance; see integration receipt. |
| AC-multi-account-origin-routing-03 | prd-001 | Matching uses normalized exact origin (scheme, host, effective port), never fuzzy suffixes or wildcard grants. If path-level rules are needed, they are explicit and separately tested. | DONE | fork-implementation@2026-10-04 | — | test: src/lib/__tests__/site-destination-routing.test.ts | Awaiting independent acceptance; see integration receipt. |
| AC-multi-account-origin-routing-04 | prd-001 | A matching origin preselects only an unambiguous destination; ambiguous mappings prompt, unmatched origins offer inline connect/choose and an explicit remember action. A user can override any prefill. | DONE | fork-implementation@2026-10-04 | — | test: src/sidepanel/tabs/__tests__/IssueCreateModal.confirmDraft.test.tsx; e2e/storm-destination-routing.spec.ts | Awaiting independent acceptance; see integration receipt. |
| AC-multi-account-origin-routing-05 | prd-001 | The chosen destination binding is stable through draft save, upload, retry, and resubmission; changing the current website or active connection cannot silently redirect an existing draft. | DONE | fork-implementation@2026-10-04 | — | test: src/sidepanel/lib/__tests__/retryAttachments.test.ts; e2e/storm-destination-routing.spec.ts | Awaiting acceptance; cookie-session upload limitation is explicit in the integration receipt. |
| AC-multi-account-origin-routing-06 | prd-001 | Automated tests cover legacy migration, duplicate accounts, exact origin normalization, ambiguity, overrides, and destination stability. No live connector calls are used in tests. | DONE | fork-implementation@2026-10-04 | — | test: e2e/storm-destination-routing.spec.ts; docs/verification/2026-10-04-fork-integration.md | Awaiting independent acceptance; see integration receipt. |

## Implementation receipt

[Integrated verification and remaining limits](../../../verification/2026-10-04-fork-integration.md). Implementation evidence is recorded as `DONE`, not independent `VERIFIED` acceptance. No ticket is being self-accepted or closed.
