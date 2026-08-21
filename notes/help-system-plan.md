# In-App Help System & Video Tutorials — Design Notes

Status: as of 2026-08-08, in-app help is wired up end to end and confirmed working — both by
automated e2e verification and by the operator manually clicking through it. Every named route
in `src/router/index.ts` declares `meta.helpTopic`; the app-bar Help button (and F1) opens the
matching page of the embedded VitePress site; clicking it again while already open navigates
that same window to the new topic instead of opening a second one; closing the window (the
real X button) works. The site is served through a small custom Rust URI scheme handler
(`src-tauri/src/lib.rs`) rather than Tauri's generic asset protocol — see "Architecture" below
for why the simpler approach didn't work and had to be replaced, and why *window creation*
still happens in the frontend (like every other secondary window in this app) while only
*navigating an already-open window* goes through Rust. The same site is also now the project's
public GitHub Pages landing page (dark-mode logo, link to the web demo nested at `/app/`) — see
`notes/release-process.md`'s "GitHub Pages site structure". Every topic page now has real content
and real screenshots (captured via the `e2e/docs-screenshots/capture.js` pipeline), including a
Sync page added after this doc's original topic list below. A proof-of-concept overview video
pipeline also exists in `e2e/video/` (one video, `overview.mp4`). Still not done: the full
multi-topic tutorial video series — see "Open items".

## Goal

Context-sensitive help, available two ways:

- **In-app**, offline, bundled with the Tauri app.
- **Online**, via GitHub Pages, for browsing without installing/running the app.

A help affordance in the app opens the doc page specific to whatever screen you're
currently on, with an obvious way to instead browse the whole help site.

## Decisions made

1. **Static site generator: VitePress**, not VuePress. It shares the Vite/Vue 3 toolchain
   already used everywhere in this repo (no new bundler to learn) and is the more actively
   developed of the two.
2. **Both delivery targets from one build.** The same VitePress build output gets bundled
   into the Tauri app *and* deployed to GitHub Pages — not two separate docs sets to keep
   in sync.
3. **In-app delivery mechanism: a dedicated Tauri `WebviewWindow`**, not a system-browser
   link. This was the one real fork in the design — see the tradeoff below. Chosen because
   it matches how this app already manages other secondary windows (the presentation
   display, the remote-control pairing flow) and works fully offline, at the cost of more
   upfront wiring than a plain "open in browser" link would have needed — turned out to be
   more wiring than originally expected, too: embedding the site at compile time and serving
   it through a small custom Rust URI scheme handler, not Tauri's generic asset protocol (see
   Architecture for why).
4. **Per-page help via route metadata.** Each route can declare a help topic (e.g.
   `meta.helpTopic: 'service-workspace'`) matching a VitePress page. The in-app "Help"
   button resolves the current route to its topic and opens that specific page, falling
   back to the docs homepage for routes that don't have a topic yet.
5. **Doc content gets written collaboratively**, not auto-scaffolded from the codebase.
   When this resumes, the plan is to draft the actual help text together, page by page,
   rather than me generating placeholder content from route/component names for you to
   fix up afterward.

## Architecture (built and working)

- **VitePress project lives at `docs/`**, using its own default convention
  (`docs/.vitepress/config.ts`, `docs/index.md`, `docs/<topic>.md`, flat rather than nested
  under `pages/`) — no custom `srcDir` needed. The naming conflict this section used to
  describe is resolved: the internal engineering documents that used to live at `docs/`
  (`architecture-plan.md`, `canva-setup.md`, `completion-audit.md`, `release-process.md`,
  this file) moved to **`notes/`** instead, freeing `docs/` for VitePress. `outDir` in
  `docs/.vitepress/config.ts` points straight at `src-tauri/resources/help` — one build
  command, no separate copy step.
- **Route → topic mapping** via `meta.helpTopic` on each route in `src/router/index.ts` — 15
  topics (see below), every named route covered, optional `#fragment` support built in for
  deep-linking a sub-heading once real content exists.
- **Tauri window**: window *creation* is exactly as simple as first sketched — like the
  existing presentation/identify windows, `openHelp()` (in `src/adapters/tauri/index.ts`)
  creates the window entirely from the frontend via `new WebviewWindow(...)`, no Rust command
  needed for that part. Needed an explicit `.show()`/`.setFocus()` on the `tauri://created`
  event — `focus: true` in `WebviewWindowOptions` alone wasn't enough to reliably reach the
  foreground.
  - **Reuse went through several designs before landing on one that actually works.** First
    attempt: close any existing help window, then create fresh, on every click (no real
    "navigate an existing window" involved at all) — unreliable, the window sometimes wouldn't
    close. Second attempt, once `WebviewWindow::navigate` was found on the Rust side: create
    *and* navigate the window entirely from a `#[tauri::command]`, for one consistent code
    path — the window it built never finished loading (confirmed live, across several further
    fixes: the URL had to use `WebviewUrl::External` on Windows rather than `CustomProtocol`
    since the platform's own form of the URL is syntactically `http://`, not a genuinely custom
    scheme; window creation also had to be dispatched onto the main thread via
    `AppHandle::run_on_main_thread`, since — unlike every previous window in this app, all
    created from the frontend, where Tauri's IPC layer already marshals this — this was the
    first place the app built a window directly from a command handler). Neither fix was
    enough; the window still never loaded. Landed on a **hybrid**: creation stays in the
    frontend (the one path actually proven to load real content), and only *navigating an
    already-open* window goes through Rust (`commands::help::navigate_help_window` — there's no
    JS-side `WebviewWindow.navigate`). Existence is tracked via a closure variable updated by a
    `tauri://destroyed` listener on the window this code itself created, not by asking Tauri's
    backend whether a window labeled `"help"` currently exists — that backend registry check
    turned out unreliable too: after closing the window in an automated test, the backend kept
    reporting it present and successfully navigable with no visible window behind it at all.
  - **But *serving* the site needed a Rust addition after all.** The first attempt used
    `resolveResource()`/`convertFileSrc()` (Tauri's generic asset protocol) to point the window
    straight at the built `services.html` etc. That loads fine as a single file, but
    `convertFileSrc` percent-encodes the *entire* absolute path as one opaque blob — even `/`
    becomes `%2F` — so the resulting URL has no real directory structure for the browser to
    resolve the site's own relative CSS/JS/font references against. Confirmed live: every one
    404'd, landing back at the origin root. That's a hard limit of the generic asset protocol
    for a multi-file bundle, not something fixable by adjusting VitePress's own `base` config.
    The fix: `src-tauri/src/lib.rs` embeds the built site at compile time (`RustEmbed`, the
    same pattern `remote_server.rs`'s `RemoteAssets` already used for the Remote Control
    bundle) and registers a `help` URI scheme (`register_uri_scheme_protocol`) that serves it
    by ordinary `/`-delimited path — `openHelp()` now just does
    `convertFileSrc(`${slug}.html`, 'help')`, and the browser's normal relative-URL resolution
    handles everything else. `guess_asset_content_type` (`remote_server.rs`) is now `pub(crate)`
    and shared between both embedded bundles rather than duplicated.
  - **A second, unrelated landmine turned up right after: VitePress's `cleanUrls` and `base`
    config only make sense for a real HTTP server.** `cleanUrls: true` (extensionless
    permalinks) needs a server that rewrites `/services` → `services.html`; loading the
    `.html` file directly made VitePress's own client-side router treat it as an unrecognized
    route and render its 404 page over the real content (confirmed by reading
    `document.title`, which said "404 | ..." even though the page's own CSS/JS had all loaded
    correctly by then). Turned off (VitePress's default). Separately, a *relative* `base`
    (`./`, tried first to route around the asset-protocol bug above) breaks the same
    client-side router a different way — it uses `base` to strip the site's root prefix off
    `location.pathname` when matching a route, and a relative value doesn't behave like an
    absolute prefix for that comparison. Once the `help` protocol serves the whole site at a
    fixed root (`http://help.localhost/`), the default absolute `base` (`/`) is exactly right
    and both problems disappear together. GitHub Pages deployment will need its own `base`
    matching whatever subpath it's served from — a second build invocation with that
    overridden, not a change to this default (see Open items).
- **GitHub Pages**: wired up. `release.yml`'s `deploy-pages` job now builds *both* the VitePress
  site (`VITEPRESS_BASE_PATH=/WorshipStudio/`) and the static browser demo
  (`VITE_BASE_PATH=/WorshipStudio/app/`), copies them into one staging directory (help site at
  the root, demo under `app/`), and uploads that combined directory as the single Pages
  artifact — Pages only accepts one artifact per deploy, so this replaced the old demo-only
  `pnpm build` → `upload-pages-artifact` step rather than adding a second one. `docs/index.md`'s
  hero is now the project's public landing page (dark-mode logo, "Try the Web Demo" button)
  as well as the in-app help home page — the same build, same file, both destinations. See
  `notes/release-process.md`'s "GitHub Pages site structure" section for the full breakdown.
  One accepted rough edge: the "Try the Web Demo" hero button (`link: /app/`, `target: _self`
  so VitePress's client-side router doesn't try to intercept it as an internal page — see
  `router.js`'s click handler, which skips any `<a>` carrying a `target` attribute at all) is a
  dead end when clicked from *inside* the desktop app's help window, since no `/app/` exists in
  the bundled `help://` site. Not worth branching hero content over for a rarely-clicked link.
- **Screenshots**: a separate, manually-triggered extension of the existing WebdriverIO e2e
  harness (`e2e/`) that drives the built debug app through canonical states and saves images
  into the VitePress project's `public/` folder, referenced by the markdown pages. Kept out
  of the CI-facing e2e suite deliberately — screenshots need visual review before landing,
  and only need regenerating when the UI they capture actually changes.

## Related existing context

`notes/architecture-plan.md`'s CI/CD section already anticipated something like this: it
lists "static demo → GitHub Pages" as a goal and notes the e2e scripts were written to
"double as demo-video/docs-site source." This help system is essentially a concrete,
user-facing realization of that original idea, rather than a brand-new direction.

## Open items for the help-docs system

- Topic list (17 now — 15 originally, grouped by workflow in the sidebar rather than mirroring
  the app's own left-nav layout, plus Sync and Installation added later): Installation (solo,
  the only topic with no in-app screen behind it — covers getting the app itself, ahead of
  Getting Started's in-app setup wizard) · Getting Started (solo) · Running a Service: Services,
  Assignments, Bulletin, Announcements · Your Library: Songs, Slides, Media, Presentation Themes,
  Service Templates · People & Teams: People, Roles · Reports & Settings: Reports, Library Health,
  Settings, Sync. Assignments and Bulletin were split out from a single "Services" topic
  specifically so F1 from those two screens doesn't land on the same page as the main
  order-of-worship workspace.
- ~~Write the actual help content~~ — done: every topic page has real content and screenshots
  (`e2e/docs-screenshots/capture.js` drives the app through ~17 documented screens and captures
  each one, converted to WebP via `scripts/convert-doc-screenshots.mjs`).
- The Help button/F1 shortcut are still hidden entirely in the mock/browser build
  (`hasDesktopBackend` check in `App.vue`, `HelpPort.open` absent from
  `src/adapters/mock/index.ts`) — unrelated to the Pages deploy now existing, since that hides
  a native window affordance that has nothing to open in a browser tab. Worth revisiting once
  real content exists: the demo could link out to the now-live Pages help site instead of
  hiding the entry point outright.

---

## Automated video tutorials

Same underlying idea, extended: reuse scripted automation (the same WebdriverIO harness
`e2e/` already has, per the architecture-plan.md note above) to record short screen-capture
videos of the app, narrated by TTS from a script we write ahead of time, destined for the
author's own YouTube channel (and probably embedded on the corresponding help-doc page too).

### TTS engine — decided: `edge-tts`

Investigated in order:

1. **ElevenLabs**, including voice cloning — good quality, but paid/cloud and not needed
   once a good free option turned up. Voice choice (cloned vs. stock) is just a config value
   either way, not an architectural decision, so this stays an option to revisit later if
   `edge-tts` ever feels limiting.
2. **Windows' own voices** — checked directly on this machine:
   - Classic voices (Microsoft David, Zira, Mark) — always available via the standard SAPI
     API, but the older/robotic tier.
   - **Microsoft Andrew (Natural HD)** (and similar "(Natural)" voices, added via Settings →
     Time & Language → Speech → Manage voices) sound noticeably better, but **turned out to
     be inaccessible to any script or third-party app**. Confirmed by checking every place a
     TTS engine would normally register itself: the classic `System.Speech` (SAPI5) API only
     lists David/Zira; the WinRT `Windows.Media.SpeechSynthesis.SpeechSynthesizer.AllVoices`
     API only lists David/Zira/Mark; and the underlying registry locations
     (`HKLM\SOFTWARE\Microsoft\Speech(_OneCore)\Voices\Tokens`, including the WOW6432Node
     view) have no entry for Andrew at all. Conclusion: the Natural HD voices are wired
     directly into Narrator's own internal pipeline, not exposed as a general-purpose TTS
     engine — great for accessibility, useless for automation. **Do not spend more time
     trying to reach these voices programmatically** unless Windows changes this.
3. **`edge-tts`** (a free, open-source CLI/library — `pip install edge-tts`) — landed here.
   It calls the same Azure neural voice catalog Microsoft Edge's "Read Aloud" uses, needs no
   account or API key, and is built to be called from scripts (unlike the Narrator-only
   Natural voices above). Tested live with the `en-US-AndrewNeural` voice — almost certainly
   the same underlying model as Windows' "Andrew (Natural HD)" — and it sounds just as good.
   No cost, no network dependency beyond Microsoft's own TTS endpoint, no credentials.

### Pipeline design — three phases

The key ordering insight (from the discussion, better than an earlier draft of this idea
that had it backwards): **generate the narration audio first, measure its real duration,
then pace the app automation to match** — not the other way around.

1. **Generate narration.** Write the script ahead of time as one short line of narration per
   discrete step ("click Add Item", "choose Countdown", etc.) — not one long continuous
   narration track. Run each line through `edge-tts` to get an audio clip, and measure its
   exact duration (`ffprobe`, or edge-tts's own timing output — see subtitles below).
   Per-step granularity keeps the pacing math trivial (pause length = that step's clip
   duration + a small fixed buffer so it doesn't feel rushed) and lets a single step be
   re-recorded or re-worded later without touching the rest.
2. **Drive the app and record video.** Run the WebdriverIO automation for a whole
   section/chapter (e.g. "Creating your first service") continuously, pausing after each
   action for that step's measured duration, while a screen recorder captures the whole
   section as **one continuous video** — not a separate recording per step. Starting/
   stopping the recorder per step would risk visual hiccups at every boundary and gain
   nothing, since the app itself just keeps running across steps regardless.
3. **Mux.** Overlay the pre-generated per-step audio clips onto that continuous video at
   their computed offsets (cumulative sum of prior steps' durations + buffers).

Short audio clips, continuous video, sectioned by tutorial/chapter rather than by
individual step.

### Closed captions — essentially free

`edge-tts` has a built-in `--write-subtitles` flag that emits a real `.srt` file, timed from
the actual synthesis word-boundary events (verified live — timestamps matched real speech,
not an estimate). Since narration is already written and generated per step, each step's
`.srt` can be timestamp-shifted by that step's offset in the final video and concatenated
into one master subtitle track for the whole tutorial — synced captions with no separate
captioning effort, authored entirely from the same script text.

The default grouping is per-sentence/clause (what you want for readable captions), but the
underlying data is word-level, so finer sync (e.g. triggering an action on a specific word
mid-sentence) is possible later if ever wanted — not something to design around now.

### Video length & YouTube organization

No one wants a 30-minute tutorial. Fix this at the source rather than after the fact: **do
not concatenate sections into one long video — publish each section as its own short,
focused video** (a minute or two, one task each). This reuses the exact same per-topic
structure already planned for the help docs — "Creating a Service," "Adding Songs,"
"Presenting Live," etc. become both a help-doc page *and* a standalone video, and a topic's
help page could eventually embed that topic's YouTube video alongside the written docs.

On YouTube specifically:

- A **playlist** ("Worship Studio Tutorials"), ordered the way someone learning the app
  would actually want to go through it.
- **End-screen cards** linking to the next video in the series, so a video found via search
  still nudges viewers into the rest of the series.
- **In-video chapters** (YouTube auto-generates a scrubber from timestamps in the
  description) as a fallback only for the rare topic that genuinely needs to run long — not
  the default structure.

### Proof of concept: automated overview video (in progress)

A first, small-scale build of this pipeline lives in `e2e/video/` — a single ~5-beat "very
high level overview" video, not a full tutorial. It reuses `e2e/wdio.conf.js`'s isolated
e2e sandbox (fresh `appDataDir`, the debug binary via `verifyE2eBinaryIdentifier`) so it
never touches a real church's library, and seeds realistic-looking content first via the
app's own Settings → Library & Sync "Load Sample Data"/"Add Stock Backgrounds" tools (the
same sequence `e2e/specs/settings-library-sync.spec.js` already exercises) before `ffmpeg`
(`-f gdigrab`, targeting the fixed 1920x1080 "Worship Studio" window) starts capturing.
`edge-tts` (`en-US-AndrewNeural`) generates the narration and `.srt` captions per beat;
`webdriverio`'s programmatic `remote()` drives the app between beats, pausing for each
beat's measured audio duration plus a fixed ~800ms buffer; a final `ffmpeg` pass muxes
narration + captions onto the captured video. This validates every piece of the design
above at small scale before deciding whether the full multi-topic tutorial series is worth
building the same way.

### Open items for the video pipeline

- `edge-tts` is a Python dependency (`pip install edge-tts`), invoked from the Node
  orchestration script as a plain CLI subprocess — kept as the project's only Python
  dependency, not a broader Python tool chain. Revisit only if `edge-tts` itself becomes a
  problem.
- Decide the actual list of tutorial topics/sections for the full series (probably mirrors
  the help-docs topic list) once the POC above is reviewed and judged worth extending.
- Decide the buffer length between narration end and next action for the full series (the
  POC uses a fixed ~800ms as a starting point, not yet validated by ear).
- Revisit ElevenLabs (or a cloned voice) later if `edge-tts` ever feels limiting — nothing
  above forecloses that.
