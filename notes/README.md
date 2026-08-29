# Design notes

Working documents, not user documentation — the reasoning behind decisions, the findings that
were expensive to get, and the plans not yet built. User-facing help lives in [../docs](../docs)
and ships inside the app; nothing here does.

They are kept because the *why* is the part that gets lost. A code comment can say what a
constant is; it can't reasonably carry a week of investigation into why the narrower OneDrive
permission returns "not found" on a shared folder.

## Start here

- [architecture-plan.md](architecture-plan.md) — the whole system, milestone by milestone. The
  one to read first, and the one that explains the adapter split everything else assumes.
- [release-process.md](release-process.md) — branches, the flyup path, cutting a release,
  code-signing setup. Read before touching anything in `.github/workflows/`.
- [dev-workflow-plan.md](dev-workflow-plan.md) — release notes, branching and the dev
  deployment, agreed 2026-08-27. Partly built; the release-notes and branching halves are done.

## Subsystems

Each of these covers one area in depth — read the relevant one before changing that area, since
most record a constraint that isn't obvious from the code.

- [help-system-plan.md](help-system-plan.md) — one VitePress build shipped two ways: bundled
  into the desktop app for offline help, and deployed as the public site.
- [tablet-onboarding-and-account-model.md](tablet-onboarding-and-account-model.md) — how a
  tablet reaches the library. Contains the platform findings that cost the most to establish:
  the Entra app registration requirements, why `Files.ReadWrite.All` rather than the narrower
  scope, and why colon-path addressing fails on a shared folder.
- [tablet-push-latency-plan.md](tablet-push-latency-plan.md) — sync cadence and debouncing.
- [desktop-library-change-detection.md](desktop-library-change-detection.md) — how a running
  desktop notices files another device changed.
- [web-feature-parity.md](web-feature-parity.md) — what the browser build can and cannot do,
  and why.
- [canva-setup.md](canva-setup.md) — the Canva integration's one-time setup.

## Feature plans

Written before building, kept afterwards as the record of what was decided and rejected.

- [setup-wizard-decisions-plan.md](setup-wizard-decisions-plan.md) and
  [setup-wizard-join-plan.md](setup-wizard-join-plan.md) — first-run setup, and the later
  new-library/join-existing fork.
- [slide-transitions-plan.md](slide-transitions-plan.md) and
  [slide-auto-advance-plan.md](slide-auto-advance-plan.md) — presentation behaviour.
- [background-audio-plan.md](background-audio-plan.md) — **not built, and may never be.** A plan
  written before it was clear the feature answers a problem anyone actually has. Kept as a record
  of the thinking, not as a commitment.

## Reference

- [e2e-driving-checklist.md](e2e-driving-checklist.md) — patterns for writing specs that drive
  the real app without becoming flaky.
- [completion-audit.md](completion-audit.md) — a point-in-time sweep of what was finished
  against the spec. Historical; it is not kept current.
