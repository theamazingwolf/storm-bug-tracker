---
for_agent: |
  ONE work queue for this project. Every unit of work — feature, defect, chore, research
  spike — is a folder in docs/tasks/{1-backlog,2-ready,3-in-progress,4-review,5-completed}/
  named <type>-NNN-slug/. The folder a ticket sits in IS its status; promote it with
  `roster ticket move` (the CLI performs the git move) rather than editing a status field.
  A GitHub issue association is carried IN the ticket (its slug, or a `github_issue:`
  frontmatter field) — never by living in a separate folder tree. Do NOT write task artifacts
  to a root tasks/ folder.
for_human: |
  All work lives here in one queue, whatever its source. The folder a ticket is in tells you
  its status. GitHub-issue work is a ticket like any other, tagged rather than segregated.
---

# Tasks

One work queue. Every unit of work is a ticket folder in a lifecycle lane.

- **Lanes:** `1-backlog/` → `2-ready/` → `3-in-progress/` → `4-review/` → `5-completed/`.
  Location is status; use `roster ticket move` to promote the whole ticket folder.
- **Ticket:** `<type>-NNN-slug/` where type is `prd` · `issue` · `chore` · `spike`. Type
  selects which roles touch it and which templates apply — never the state machine. Optional
  `priority:` is shared by every type: `p0`–`p3`; absent or blank means `p2`, and legacy
  legacy `severity:` is deliberately not read. Optional `submitter:` is also shared by every
  type; bare scaffolds leave it blank, and a present value must be a normalized single-line YAML
  string without `|` (it is persisted in the completed ledger). New `chore` and `spike` scaffolds
  also carry blank `owner:` and `verified_by:` fields; compaction requires distinct normalized
  full-token and pre-`@` identities. Legacy ownerless lighter tickets fail closed until repaired.
  Spikes additionally require substantive `findings.md`, which stays in the ticket folder —
  compaction no longer copies it to `handoff/` or deletes it (issue-034, 2026-09-28); chores
  do not require findings.
- **Submitter provenance** is recorded as `submitter:` when a ticket came from another repo or
  person. It is optional and does not resolve or link an origin ticket.
- **GitHub issues** are ordinary `issue-` tickets. Record the issue in the slug or a
  `github_issue:` field; they do not get their own folder tree.

Task artifacts never go in a root `tasks/` folder — that location is retired.
