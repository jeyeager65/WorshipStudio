# Worship Studio

A church presentation/service-management desktop app. Plan a service, run it live, and keep your
song/slide library organized — all from one app, with no server or database: your library lives
as plain JSON files in a folder you already sync (Dropbox, OneDrive, or similar).

- **Try it**: [live web demo](https://jeyeager65.github.io/WorshipStudio/app/) (runs entirely in
  your browser against sample data — nothing is saved) · [help
  site](https://jeyeager65.github.io/WorshipStudio/) · [download the desktop
  app](https://github.com/jeyeager65/WorshipStudio/releases)

## Features

- **Plan a full order of worship** — songs, scripture, sermon, media, and announcements — in one
  workspace, using a reusable [service template](https://jeyeager65.github.io/WorshipStudio/service-templates.html)
  so you're not rebuilding the structure every week.
- **Run it live** on a second display, with per-item transport (Next/Previous, Blank Screen,
  Background Only) and a readiness check that flags anything not ready to present.
- **Song and slide libraries** you build once and reuse every week, including OpenSong XML
  import and a Canva integration for slide design.
- **Presentation themes** for consistent, on-brand styling of generated content (backgrounds,
  fonts, text effects) without styling every song and scripture slide by hand.
- **Assignments** — who's serving each week, with automatic double-booking and availability
  conflict detection, and one-click roster sharing.
- **Bulletins and reports** generated straight from your service plans — a printable order of
  worship, CCLI song-usage reporting, and multi-week planning views — no separate documents to
  keep in sync.
- **Multi-computer sync** over whatever file-sync tool you already use, with built-in detection
  and recovery if two computers edit the same record at once.
- **Remote control** a running service from a phone or tablet, and hand off to an external app
  (like a video player) mid-service.
- **Windows and macOS**, with a signed Windows installer.

See the [help site](https://jeyeager65.github.io/WorshipStudio/) for a full walkthrough of every
area of the app.

**Status:** the full v1 milestone roadmap is built — service planning, the song library, the
main live-presentation workspace, scripture lookup, a slide library, settings, an undo
mechanism, and this release pipeline. See [notes/architecture-plan.md](notes/architecture-plan.md)
for the milestone-by-milestone breakdown. Native (Tauri/Rust) backend support currently covers
songs, services, slides, and settings; a few adapter ports further out on the roadmap (displays,
live-session transport, media, remote control, sync status, email) are still mock-only — real
in the browser demo and in the UI, but not yet wired to native OS behavior. `src/adapters/types.ts`
is the authoritative list of what each port does.

- **Technical architecture & build plan**: [notes/architecture-plan.md](notes/architecture-plan.md)
- **Cutting a release / code-signing setup**: [notes/release-process.md](notes/release-process.md)

## Stack

Vue 3 + TypeScript + Vuetify 4, Pinia, vue-router, Vite, Tauri v2 (Rust). See the architecture
doc for the full rationale, the adapter-based frontend/backend split, and the milestone plan.

## Requirements

- Node.js ≥ 24.11.1 (Vuetify 4's floor) — this repo pins `24.18.0` in CI
- pnpm (enable via `corepack enable && corepack prepare pnpm@11.17.0 --activate`, or install directly)
- Rust stable + Cargo, for the desktop shell (`src-tauri/`)

## Getting started

```sh
pnpm install

# Web-only, against the mock/fixture adapter (also the static demo build target)
pnpm dev

# Full desktop app, real Tauri backend
pnpm tauri dev
```

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Vite dev server, mock adapter (browser, no Tauri) |
| `pnpm tauri dev` | Full desktop app against the real Rust backend |
| `pnpm build` | Type-checks, then builds `dist/` — the same output used by the Tauri bundle and the static demo |
| `pnpm preview` | Serves a built `dist/` locally |
| `pnpm type-check` | `vue-tsc`, no emit |
| `pnpm lint` | ESLint, auto-fixing |
| `pnpm format` | Prettier, writes `src/` |
| `pnpm test:unit` | Vitest — frontend unit tests |

Rust side (`src-tauri/`): `cargo fmt`, `cargo clippy --all-targets -- -D warnings`, `cargo test`
— all three run in CI (`.github/workflows/ci.yml`) alongside the frontend checks above.

## Project layout

```
src/                    Vue app — shared between the Tauri build and the static demo build
  adapters/             The UI/backend boundary
    types.ts            One interface every backend implements; the source of truth for what
                         each port (songs, services, slides, settings, displays, live, media,
                         remote, sync, email, ...) does and whether it's optional/feature-detected
    mock/                Browser/localStorage-backed implementation (demo + local dev)
    tauri/               Real desktop implementation, calling into src-tauri/ via invoke()
  models/                TypeScript types for the JSON data (songs, services, slides, settings)
  stores/                Pinia stores
  views/                 Screens (routed pages)
  components/            Shared/reusable components
  utils/                 Pure helper functions (scripture references, service flattening, ...)
  router/                vue-router routes + the unsaved-changes navigation guard
  plugins/               Vuetify setup (themes, icons)
src-tauri/               Rust backend
  src/commands/          Thin Tauri command wrappers (#[tauri::command])
  src/domain/            Pure logic the commands call into, unit-tested independent of Tauri
  src/models.rs          Rust-side mirror of the JSON data shapes (serde)
  src/paths.rs            Where the synced library folder lives on disk
  icons/                 App icons for every platform Tauri bundles for
notes/                   Architecture and release-process planning docs
docs/                    VitePress help site (in-app + GitHub Pages landing page) — see notes/help-system-plan.md
scripts/release/         Windows code-signing certificate + one-time machine-trust script
.github/workflows/       CI (every push/PR) and Release (on a vX.Y.Z tag push)
```

## Releases

Tagged releases (`vX.Y.Z`) build a signed Windows installer and an unsigned macOS build, and
republish the GitHub Pages site (the VitePress help site as the landing page, the static browser
demo nested at `/app/`) — see
[notes/release-process.md](notes/release-process.md) for the full one-time setup and the
steady-state release flow, including the one-time steps a church machine needs (trusting the
Windows certificate; the macOS Gatekeeper bypass).
