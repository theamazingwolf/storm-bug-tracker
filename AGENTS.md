# Storm Bug Tracker

- **Workflow:** saas-build
- **Lifecycle:** by-folder

Storm Bug Tracker is a browser extension for capturing bug reports and submitting them to a user-selected issue tracker. Preserve the client-side privacy boundary: capture data, credentials, and user-authored content must not be sent to a Storm Bug Tracker service. Any direct provider or AI request must remain user-initiated and use the configured destination.

## Engineering rules

- Keep changes scoped to the approved task and follow existing TypeScript, React, Zustand, and Vitest conventions.
- Add or update focused tests for behavior changes. Preserve existing application, unit, and end-to-end gates.
- Do not add credentials, client data, private agent definitions, runtime configuration, captures, or local handoff logs to public commits.
- Treat provider capability and destination selection as explicit contracts. Do not infer image support, account identity, or a destination from model names or partial matches.
- External integration calls must remain explicit user actions. This repository does not automate intake from external issue trackers.
- Do not deploy, publish releases, send notifications, or push changes without explicit authorization.
- Use English for project communication and commit messages. Do not add co-author trailers or rewrite shared history.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm build:e2e` followed by `pnpm test:e2e` when end-to-end behavior changes

Read `docs/CI.md` before changing CI workflows and consult `docs/ARCHITECTURE.md` for the subsystem being changed.
