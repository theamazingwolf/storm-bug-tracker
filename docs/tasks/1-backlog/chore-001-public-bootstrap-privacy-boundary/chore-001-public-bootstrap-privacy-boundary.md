---
type: chore
id: chore-001
slug: public-bootstrap-privacy-boundary
owner:
verified_by:
created: 2026-10-04
priority: p1
submitter:
blocked_ask:
---

# chore-001 — public bootstrap privacy boundary

The public fork must not ship upstream private agent definitions or trigger deployments and notifications outside this repository. Keep a small public project context, while local Roster output and local handoff material remain untracked and recoverable.

## Acceptance

- Generated/private `.agents`, `.claude`, `.codex`, `.pi`, and other runtime files are absent from the public index and ignored locally; prior source remains recoverable from local files or Git history.
- `AGENTS.md` and `CLAUDE.md` contain only public project context, with no proprietary role content, credentials, or machine-specific absolute paths. Preserve the MIT license and existing copyright.
- The active CI workflow retains typecheck, unit, build, pre-arm, and e2e gates but does not send Slack notifications or trigger a web deployment. Agent-mirror generation/checks are not required for a clean public checkout.
- Native Roster state, credentials, captures, and local handoff notes stay out of the public index. Roster doctor/status/ticket-check receipts are local-only.
- A clean checkout can follow the documented public verification commands without local agent files.


## Acceptance Ledger

| ID | Source | Criterion | Status | Owner | Verifier | Evidence | Note |
|----|--------|-----------|--------|-------|----------|----------|------|
[ACCEPTANCE-LEDGER-VERIFIER-SEPARATION: STRICT-FROM-HERE]
| AC-public-bootstrap-privacy-boundary-01 | chore-001 | Generated/private `.agents`, `.claude`, `.codex`, `.pi`, and other runtime files are absent from the public index and ignored locally; prior source remains recoverable from local files or Git history. | OPEN | — | — | — | — |
| AC-public-bootstrap-privacy-boundary-02 | chore-001 | `AGENTS.md` and `CLAUDE.md` contain only public project context, with no proprietary role content, credentials, or machine-specific absolute paths. Preserve the MIT license and existing copyright. | OPEN | — | — | — | — |
| AC-public-bootstrap-privacy-boundary-03 | chore-001 | The active CI workflow retains typecheck, unit, build, pre-arm, and e2e gates but does not send Slack notifications or trigger a web deployment. Agent-mirror generation/checks are not required for a clean public checkout. | OPEN | — | — | — | — |
| AC-public-bootstrap-privacy-boundary-04 | chore-001 | Native Roster state, credentials, captures, and local handoff notes stay out of the public index. Roster doctor/status/ticket-check receipts are local-only. | OPEN | — | — | — | — |
| AC-public-bootstrap-privacy-boundary-05 | chore-001 | A clean checkout can follow the documented public verification commands without local agent files. | OPEN | — | — | — | — |
