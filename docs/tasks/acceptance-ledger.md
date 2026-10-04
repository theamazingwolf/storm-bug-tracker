# Acceptance Ledger — acceptance criteria as durable FSM state

> The acceptance-criterion layer that sits ABOVE the checkbox task lists — it does NOT replace them.
> Task lists (`docs/tasks/<lane>/**/tasks-*.md`) track work items (sub-tasks → `[x]`); this tracks acceptance
> criteria as a 4-state FSM that survives context loss and becomes the PR's audit trail.
> Always on. Every roster project runs this ledger — there is no opt-out tier and no mode that
> skips it. The conditional this line used to carry WAS the missed-acceptance-criterion hole.
>
> **Canonical destination (issue-034, 2026-09-28).** This shape is seeded into a ticket's own
> `## Acceptance Ledger` section inside `<type>-NNN-slug.md` — that section is authoritative for
> its ticket when present. Rows with no owning ticket folder (a migrated legacy list, an epic)
> live in the project aggregate `docs/tasks/acceptance-ledger.md`. A legacy
> `handoff/acceptance-ledger.md` is read-only: consulted only for ids with no local or aggregate
> row, never written by new work. First materialization of a ticket's local section must copy
> forward its already-recognized rows — status, owner, verifier, evidence, and the
> verifier-separation marker position — before appending any new `OPEN` row; never shadow prior
> rows with a section that looks freshly empty.

## How to use it

- `generate-tasks` lifts every PRD acceptance criterion into an `OPEN` row at plan time.
- The **implementer** flips `OPEN → IN PROGRESS → DONE` (never VERIFIED) — DONE requires the same
  no-stub evidence bar as a checked box (no TODO / mock-in-production / sentinel).
- A **different actor** — the QA Reviewer, or a fresh dev pass in a different worktree/session for
  internal/non-UI criteria — flips `DONE → VERIFIED` at the wave boundary. Implementers do not grade
  their own homework: the Verifier MUST differ from the Owner.
- Actor identity is an explicit opaque instance token, conventionally
  `model-or-role@session/worktree` (for example `sonnet@wave-2d/w2d-issue-026`), not merely a model
  name. Doctor normalizes Unicode form, case, surrounding/collapsed whitespace, and placeholders,
  then requires both the full token and the base identity before `@` to differ. Thus
  `sonnet@session-a` and `sonnet@session-b` do not satisfy the different-model rule; `luna@…` and
  `terra@…` do. This proves only that the declared base/token identities differ — it cannot prove
  runtime/session provenance, honesty, or independent operation.
- Mature ledgers may grandfather rows before the visible marker
  `[ACCEPTANCE-LEDGER-VERIFIER-SEPARATION: STRICT-FROM-HERE]`. Rows after it, including every row
  appended by `roster ac-backfill`, are strict. A new ledger is strict by default because this
  marker is included before its table. A missing marker is not a silent exemption: doctor warns
  and checks every row; malformed or duplicate markers are errors.
- A `DONE` row the Verifier cannot reproduce reopens to `OPEN` (not DONE) and becomes a finding.
- This ledger is part of the verification spine the machine owns; it is NOT a license to skip Tim's
  two strategic gates (plan + acceptance). A `BLOCKED` row escalates at a gate, never authorizes
  proceeding without one.

## State legend (FSM)

```
OPEN ──▶ IN PROGRESS ──▶ DONE ──▶ VERIFIED
                          │
                          └─(can't reproduce)─▶ OPEN  (+ finding)

DESCOPED   — terminal outcome; the criterion was deliberately removed from scope.
SUPERSEDED — terminal outcome; the criterion was replaced by another decision or criterion.
BLOCKED    — side-state, legal ONLY with a specific ask in the Note (what's needed, from whom).
             A BLOCKED row without an ask is malformed. Silent skipping is not allowed.
```

- **OPEN** — lifted from the PRD; not yet started.
- **IN PROGRESS** — an Owner is actively implementing it.
- **DONE** — fully implemented with passing evidence; awaiting verification. The implementer stops here.
- **VERIFIED** — a different actor reproduced the evidence. The terminal success state.
- **DESCOPED** — deliberately removed from scope with its rationale recorded. Terminal and non-blocking; it does not require verification.
- **SUPERSEDED** — replaced by another criterion or decision with its rationale recorded. Terminal and non-blocking; it does not require verification.
- **BLOCKED** — parked; the Note holds the specific ask. Surfaced at the acceptance gate.

## Row rules

- **ID** is stable (`AC-<prd-slug>-NN`) and is referenced from the task list's `(maps to: …)` annotation and the PR.
- **Verifier MUST differ from Owner** — that difference is the gate's teeth; same-actor verification never counts.
- In a strict `VERIFIED` row, Owner and Verifier must both be non-empty, non-placeholder instance
  tokens and must differ after normalization. Doctor names the row and source when it refuses one.
- **Evidence** is typed: a test name, a Playwright flow, or `file:line` — "code exists" does not close a row.
- **Note** is required for `BLOCKED` only, and must name the specific ask.

## Repairing legacy AC slugs

Roster versions before issue-025 could drop the first letter from an unnumbered `prd-`, `epic-`,
`story-`, or `stories-` filename. The AC id is a durable join key, so do not hand-edit affected
rows or run a normal backfill first. Run the in-tool migration, preferably as a preview:

```bash
roster ac-backfill . --dry-run
roster ac-backfill .
```

The command rewrites only the first ID cell when the old derivation, source document, and criterion
text prove one unambiguous target. It preserves status, owner, verifier, evidence, and note bytes,
is idempotent, and runs before ordinary lifting so it cannot duplicate a repaired row. A
legacy+correct collision (or any unproven source) is an explicit hard stop: the ledger is left
unchanged, and an operator must resolve the two rows deliberately before re-running. Never apply a
manual bulk replacement or touch an external project's ledger without its owner.

[ACCEPTANCE-LEDGER-VERIFIER-SEPARATION: STRICT-FROM-HERE]

## Ledger

| ID | Source | Criterion | Status | Owner | Verifier | Evidence | Note |
|----|--------|-----------|--------|-------|----------|----------|------|
| AC-<slug>-01 | prd-<slug> §x | <verbatim criterion text> | OPEN | — | — | — | — |
