# Security Ledger — finding lifecycle + accepted-risk register

> One row per security finding, appended by the Security Reviewer when it's found, statused by
> the PM at the gate. Auditors read this FIRST and never re-report an ACCEPTED or DEFERRED row
> unless the current wave's diff changed its blast radius (then re-open it with a dated note).
> This file is why a settled risk decision stays settled instead of being re-litigated — and
> re-fixed — at every audit.
>
> Gate rule (see `references/qa/pipeline-gates.md`): Critical/High block their wave until fixed
> and re-tested. Medium carries an owner + target wave and does not block. Low is recorded here
> and never enters an in-wave fix loop. The acceptance-gate bar is **no unaccepted Critical/High
> rows** — not an empty ledger.
>
> Status vocabulary:
> - **OPEN** — reported, not yet resolved
> - **FIXED** — fixed and re-tested by the Security Reviewer (cite the wave)
> - **ACCEPTED** — deliberate risk acceptance; rationale + who accepted + date are mandatory
> - **DEFERRED** — worth fixing, not now; owner + target wave/stage are mandatory
> - **DEFERRED-ESCALATED** — two LLM fix attempts failed; parked for static analysis + human
>   review at the next checkpoint. Not a license for more prompting.
>
> **Canonical destination (issue-034, 2026-09-28).** New findings are appended to the project
> aggregate `docs/tasks/security-ledger.md`. A legacy `handoff/security-ledger.md` is read-only —
> consulted so an ACCEPTED/DEFERRED row already recorded there is never re-reported, but new rows
> are never written back to it.

| ID | Finding (one line) | Severity | Status | Rationale / evidence | Owner | Target | Date |
|---|---|---|---|---|---|---|---|
