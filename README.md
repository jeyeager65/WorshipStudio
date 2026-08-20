# Worship Studio

A church presentation/service-management desktop app. Plan a service, run it live, and keep your
song/slide library organized — all from one app, with no server or database: your library lives
as plain JSON files in a folder you already sync (Dropbox, OneDrive, or similar).

![The Services screen — today's service and the next two weeks at a glance](docs/public/screenshots/services-schedule.webp)

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
  worship, song-usage reporting (CCLI number included when your songs have one), and multi-week
  planning views — no separate documents to keep in sync.
- **Multi-computer sync** over whatever file-sync tool you already use, with built-in detection
  and recovery if two computers edit the same record at once.
- **Remote control** a running service from a phone or tablet, and hand off to an external app
  (like a video player) mid-service.
- **One library, three ways in**: the full desktop app for Windows, a zero-install web build for
  prep work from any browser (songs, slides, services, media, scripture, rosters — the same
  synced folder, via the File System Access API), and an installable tablet PWA that keeps its
  own local cache synced straight to Dropbox or OneDrive for volunteers on an iPad or Android
  tablet.

See the [help site](https://jeyeager65.github.io/WorshipStudio/) for a full walkthrough of every
area of the app.

**Status:** the full v1 milestone roadmap is built and in real use — service planning, the song
library, the main live-presentation workspace, scripture lookup, a slide library, settings, an
undo mechanism, and this release pipeline. See
[notes/architecture-plan.md](notes/architecture-plan.md) for the milestone-by-milestone
breakdown. Four backends implement the same `StudioAdapter` interface
(`src/adapters/types.ts` — the authoritative list of what each port does):
`tauri` (the real desktop app), `web` (the File System Access build), `tablet` (the
cloud-synced PWA), and `mock` (the browser demo and local dev fixtures). Not yet in scope for
1.0: a native audio service-item player (the data model exists; live playback doesn't yet), and
an in-app auto-updater (deprioritized while day-to-day use is mostly `pnpm tauri dev` rather than
distributed installs).

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

# Browser only, no Tauri — prompts to open a real library folder (the web adapter) or try the
# demo (the mock adapter); also the static demo build target
pnpm dev

# Full desktop app, real Tauri backend
pnpm tauri dev
```

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Vite dev server, browser only — real web adapter or the mock demo, your choice at launch |
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
    tauri/               Real desktop implementation, calling into src-tauri/ via invoke()
    web/                 File System Access implementation — same synced folder, from a browser
    tablet/              OPFS-cached implementation synced directly to Dropbox/OneDrive (PWA)
    mock/                Browser/localStorage-backed implementation (demo + local dev)
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

Tagged releases (`vX.Y.Z`) build a Windows installer, signed with a self-signed certificate — a
paid CA certificate isn't realistic for a free, open-source project — and republish the GitHub
Pages site (the VitePress help site as the landing page, the static browser demo nested at
`/app/`). Each machine trusts that certificate once
(`scripts/release/install-trust-windows.ps1`); every release after that installs without a
publisher warning — see [notes/release-process.md](notes/release-process.md) for the full setup
and release flow.
