# Worship Studio — Architecture & Implementation Plan

Status: draft for review. Source of truth for features remains `design/feature-spec.md`;
this document is the technical plan for building it. Nothing has been implemented yet —
this is a from-scratch build, not a reconciliation with prior code.

## 1. Stack & tooling decisions

| Concern | Choice | Why |
|---|---|---|
| Shell | Tauri v2 | Already decided in spec; native file I/O, multi-window, keyring |
| UI framework | Vue 3 + `<script setup>` + TypeScript | Spec-mandated; TS strongly recommended given how relational the data model is (songs ↔ arrangements ↔ services) |
| Component library | Vuetify 4 | Spec-mandated component library; v4 went stable Feb 2026 (MD3, CSS cascade layers, OS-following default theme) and is the current line — starting fresh, no reason to begin on v3 and migrate later. Requires Vue ≥3.5.0, Node ≥24.11.1, TS ≥4.7 |
| State | Pinia | One store per domain (songs, services, media, settings, live-presentation, sync). Standard pairing with Vue 3, good devtools support |
| Routing | vue-router | Screens map ~1:1 to routes (landing, service workspace, library editors, settings) |
| Package manager | pnpm | Fast, disk-efficient, plays well with Tauri's existing GH Actions examples |
| Backend logic | Rust (`src-tauri`) | File I/O, display/window management, external-app hand-off, keyring, local HTTP server for remote control |
| Bible/data files | `serde_json` (Rust) / native JSON (JS) | Per spec section 7 — no SQLite, avoids concurrent-write corruption over Dropbox sync |
| Component tests | Vitest + Vue Test Utils | Spec-mandated |
| E2E | WebdriverIO + `tauri-driver` | Spec-mandated; scripts double as demo-video/docs-site source (fast mode + demo-mode with pauses) |
| CI/CD | GitHub Actions + `tauri-apps/tauri-action` | Windows full build, macOS prep-only build, static demo → GitHub Pages |

## 2. The adapter boundary (the load-bearing architectural decision)

Every screen in the spec needs to run two ways: as the real Tauri app, and as a static
mocked demo (spec section 7). This only works if **no Vue component ever talks to
`@tauri-apps/api` or the filesystem directly.** All of that goes through one interface.

```
src/
  adapters/
    types.ts          # the Port interface — the ONLY contract components depend on
    tauri/             # real implementation — invokes Rust commands, fs, keyring
    mock/              # fixture-backed implementation — in-memory + localStorage
    index.ts           # resolves which adapter to use (see below)
```

`types.ts` defines one interface, grouped by domain, e.g.:

```ts
interface StudioAdapter {
  songs: SongPort;        // list, get, save, delete, importFromOpenSong(...)
  services: ServicePort;  // list, get, save, delete, listUpcoming(range)
  slides: SlideLibraryPort;
  media: MediaPort;       // list, import, detectDuplicates
  themes: ThemePort;
  settings: SettingsPort; // library-settings.json (synced) + per-machine settings
  scripture: ScripturePort; // resolve(reference, translation) -> passage
  live: LivePresentationPort; // startPresenting, stopPresenting, goTo(index), display state
  displays: DisplayPort;   // list monitors, assign roles — Tauri-only, no-op/stub on demo
  externalApps: ExternalAppPort; // Windows-only — feature-detected, absent port on mac/demo
  remote: RemotePort;      // pairing, device list — Tauri-only (needs local HTTP server)
  sync: SyncPort;          // status heuristics, conflict list
  diagnostics: DiagnosticsPort; // allowlisted support summary, redacted logs, bundle export
  exports: ExportPort;     // generated Word/PDF/Excel files and native save/open flow
}
```

- **Feature-detection, not stubbing-with-lies**: Windows-only ports (`externalApps`,
  the live-role parts of `displays`) are typed as optional (`externalApps?: ExternalAppPort`)
  so components check for presence and hide the UI, rather than the mock adapter pretending
  to support something it can't. This is the same pattern the spec already uses for the
  Mac build vs. Windows build.
- **Resolution logic** (`adapters/index.ts`): `window.__TAURI__ !== undefined` → real adapter;
  otherwise mock. No separate build target/entry point needed — same bundle can run either
  way, which keeps "build the demo" a matter of `vite build` without Tauri's asset injection,
  rather than maintaining two Vite configs.
- **Fixture data for the mock adapter** doubles as e2e/demo-mode test fixtures — one dataset,
  reused by "click through the demo on GitHub Pages" and "run the E2E suite," rather than two
  parallel sample datasets drifting apart.

Every domain feature (Song Library, Scripture, etc.) should be buildable and demoable against
the mock adapter alone, before the matching Rust commands exist. This lets frontend work
proceed independently of native-side plumbing.

## 3. Data model (mirrors spec section 7, made concrete)

All records are JSON, one file per item, with two fields stamped on every save:
`updatedAt` (ISO 8601, app-maintained) and `updatedByDevice` (from Settings → General →
"This Computer's Name"). This is what makes conflict resolution (spec section 6) possible.

```
<synced-root>/
  songs/<song-id>.json
  services/<year>/<service-id>.json
  slides/<slide-id>.json
  bibles/<TRANSLATION>/...
  themes/<theme-id>.json
  media/images/, media/video/            # actual files; JSON references by relative path
  manifest.json                          # index for fast startup, no full-folder scan
  library-settings.json                  # service types, preachers, collections, volunteer
                                          # roles, branding, theme defaults, bible translations config
```

Per-machine data (Tauri app-data dir, **not** synced): machine settings and display roles,
`remote-devices.json` (including revocable pairing tokens), `external-apps.json`,
`canva-auth.json`, and local media. Portable mode keeps the same instance-specific files beside
the executable so it remains independent from an installed copy.

### Core TypeScript shapes (initial cut, will firm up per-feature)

```ts
interface SongBlock { id: string; label: string; text: string }
interface Arrangement { sequence: string[] }  // block IDs, repeats allowed

interface Song {
  id: string; title: string; ccli?: string; author?: string; copyright?: string;
  collections: { collectionId: string; number?: string }[];  // number is per-collection
  tags: string[];
  notes?: string;             // library-level notes, not per-service
  blocks: SongBlock[];
  defaultArrangement: Arrangement;
  usage: { lastUsedAt?: string; usesPastYear: number };
  updatedAt: string; updatedByDevice: string;
}

type ServiceItem =
  | { type: 'song'; songId: string; arrangement: Arrangement; person?: string }
  | { type: 'scripture'; reference: string; translation: string; displayMode: 'full' | 'reference-only' }
  | { type: 'slide-ref'; slideId: string }
  | { type: 'text-slide'; slides: SongBlock[] }       // service-only, ad hoc (sermon notes)
  | { type: 'media'; mediaId: string; fit: 'cover' | 'contain' }
  | { type: 'video' | 'audio'; mediaId: string }
  | { type: 'external-app'; profileId: string; file?: string }
  | { type: 'countdown'; targetTime: string; text?: string }
  | { type: 'qr'; url: string; caption?: string };

interface Service {
  id: string; date: string; type: string;
  preacher?: string; sermonTitle?: string; keyPassage?: string;
  items: (ServiceItem & { id: string; person?: string })[];
  presenterNotes?: Record<string, string>;  // keyed by item id
  volunteerRoster?: RoleAssignment[];
  updatedAt: string; updatedByDevice: string;
}
```

Full schemas for `SlideLibraryItem`, `MediaItem`, `Theme`, and settings shapes get written
when their features are built, not all up front — the spec has enough detail per-section to
derive them at that point, and firming them up too early risks guessing wrong before a UI
exists to validate against.

## 4. Repo layout

```
worship-studio/
  src/                     # Vue app — shared between Tauri build and static demo
    adapters/
    components/            # shared building blocks (SlideCard, ArrangementChips, etc.)
    views/                 # one per screen, named after the matching sketch
    stores/                # Pinia, one per domain
    models/                # TS types (section 3)
    router/
  src-tauri/               # Rust
    src/
      commands/            # file I/O, display setup, external-app hand-off, remote server
      main.rs
  e2e/                      # WebdriverIO specs; fast + demo-mode variants
  fixtures/                 # shared mock-adapter data, reused by e2e + demo build
  scripts/
    migrate-opensong/       # OpenSong XML → Worship Studio JSON converter (CLI, Node or Rust)
  .github/workflows/
    ci.yml                  # lint, typecheck, unit tests, e2e (fast mode)
    release.yml             # tauri-action build for Windows + macOS, signed artifacts
    demo.yml                 # static build → GitHub Pages on release
  docs/                     # this plan; later, generated docs site output config
```

## 5. Phased build order

Ordered against the spec's own v1 "must-have" list, sequenced so each milestone is
demoable (mock adapter) before its native plumbing exists.

1. **M0 — Scaffolding**: Vite+Vue+TS+Vuetify+Pinia+router project, Tauri init, the
   adapter interface + mock adapter shell (empty/fixture data), CI skeleton (lint/typecheck/
   unit test on PR).
2. **M1 — Data layer**: finalize JSON schemas for songs/services/slides/settings, mock
   adapter fixtures, Tauri-side file read/write + manifest indexing, `updatedAt`/
   `updatedByDevice` stamping.
3. **M2 — Landing & Create Service**: Home/Browse tabs, service cards, service shell
   creation (date/type/preacher/sermon title/key passage).
4. **M3 — Song Library**: list + editor (blocks, default arrangement, collections/number,
   tags, notes), OpenSong XML import.
5. **M4 — Main workspace**: service order list, block/slide center panel, live/preview
   footer, flattened Next/Prev, direct click-to-live, in-workspace arrangement editing,
   keyboard shortcuts.
6. **M5 — Scripture**: reference table (book/chapter/verse-count) for validation +
   reference-only wayfinding, local-file translation import first (no API keys needed to
   develop against), picker (type-a-reference / choose-fields), auto-fit/splitting.
7. **M6 — Slide Library**: single + multi-slide groups, loop/countdown-overlay config.
8. **M7 — Settings basics**: Display Setup (with single-monitor fallback), Service Types,
   Preachers, Bible Translations, General (device name, dark mode).
9. **M8 — Undo/auto-save**: the toast mechanism, wired into every destructive/edit action
   from M2 onward (retrofit as needed) — this is cross-cutting, not a discrete screen.
10. **M9 — Release pipeline**: Windows/macOS builds via `tauri-action`, self-signed cert
    install docs, static demo → GitHub Pages on release.

v1.1 items (remote control, sheet music, video/audio, external-app hand-off, CCLI
reporting, theme editor/branding, order-of-worship export) and deferred items (QR slide,
planning-ahead calendar, volunteer roster, email) come after, in the order the spec lists
them, unless real usage reprioritizes.

**OpenSong migration** (`scripts/migrate-opensong/`) can start any time after M1 defines
the `Song`/`Service` JSON shapes — it's a converter script, not a UI feature, so it doesn't
block or get blocked by the milestone order above. Worth doing early as a real-data stress
test of the schema (249 songs, years of sets, embedded background images to re-home into
the media library) rather than leaving it until the end.

## 6. Open decisions for you to confirm

- **Node/pnpm version pin** — Vuetify 4 requires Node ≥24.11.1, so the engines field and CI
  runner version need to match that floor. Low-stakes, will just pick current-stable unless
  you want otherwise.
- **Where translated Bible reference data (book/chapter/verse counts) comes from** — needed
  even for reference-only mode and not yet sourced in the spec; likely a small bundled JSON,
  public-domain data (e.g. derived from a KJV verse index) is easy to find.
- **Self-signed cert generation** — who holds the signing key / how it gets installed on
  church machines — a process question more than a code one, worth deciding before M9.
