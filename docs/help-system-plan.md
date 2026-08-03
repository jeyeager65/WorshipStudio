# In-App Help System & Video Tutorials — Design Notes (paused, not started)

Status: discussion only as of 2026-08-03. Nothing has been implemented — no VitePress
project exists yet, no router changes, no Tauri window, no video pipeline scripts. This
file exists so the conversation isn't lost; pick it back up whenever you're ready.

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
   upfront wiring (bundling the built site as a Tauri resource, asset-protocol config) than
   a plain "open in browser" link would have needed.
4. **Per-page help via route metadata.** Each route can declare a help topic (e.g.
   `meta.helpTopic: 'service-workspace'`) matching a VitePress page. The in-app "Help"
   button resolves the current route to its topic and opens that specific page, falling
   back to the docs homepage for routes that don't have a topic yet.
5. **Doc content gets written collaboratively**, not auto-scaffolded from the codebase.
   When this resumes, the plan is to draft the actual help text together, page by page,
   rather than me generating placeholder content from route/component names for you to
   fix up afterward.

## Architecture sketch (as discussed — not yet built, not yet validated against real Tauri APIs)

- **New VitePress subproject**, using its own convention (`<dir>/.vitepress/config.ts`,
  `<dir>/index.md`, `<dir>/pages/*.md`), independently buildable from the main Vite app.
  - **Open naming conflict**: this repo already has a top-level `docs/` folder for internal
    engineering documents (`architecture-plan.md`, `canva-setup.md`, `completion-audit.md`,
    `release-process.md`). VitePress's own default source directory is also `docs/`. When
    this resumes, either the VitePress project needs a different folder name (e.g. `help/`,
    `docs-site/`, `userguide/`) or VitePress's `srcDir` config needs pointing elsewhere — a
    distinct folder name is probably simpler and avoids confusing the two "docs" concepts.
- **Route → topic mapping** via `meta.helpTopic` on each route in `src/router/index.ts`.
- **Tauri window**: bundle the VitePress `dist` output as a Tauri resource; a Rust command
  opens (or focuses, if already open) a singleton `WebviewWindow` pointed at the bundled
  site via Tauri's asset protocol, with the resolved page path appended. Reuse-a-window
  behavior should mirror however the existing presentation-window code handles that today
  (worth re-reading before implementing, not assumed here).
- **GitHub Pages**: a GitHub Actions workflow builds the same VitePress output and
  publishes it — the bundled copy and the public site are always the same build, shipped to
  two destinations, not maintained separately.
- **Screenshots**: a separate, manually-triggered extension of the existing WebdriverIO e2e
  harness (`e2e/`) that drives the built debug app through canonical states and saves images
  into the VitePress project's `public/` folder, referenced by the markdown pages. Kept out
  of the CI-facing e2e suite deliberately — screenshots need visual review before landing,
  and only need regenerating when the UI they capture actually changes.

## Related existing context

`docs/architecture-plan.md`'s CI/CD section already anticipated something like this: it
lists "static demo → GitHub Pages" as a goal and notes the e2e scripts were written to
"double as demo-video/docs-site source." This help system is essentially a concrete,
user-facing realization of that original idea, rather than a brand-new direction.

## Open items for the help-docs system

- Resolve the `docs/` naming collision (pick the VitePress project's folder name).
- Decide the actual list of help topics / page structure — likely one page per major view
  (Service Workspace, Song Library, Slide Library, Media Library, Themes, Settings,
  Assignments, Planning Ahead, etc.), but not enumerated or committed to yet.
- Decide the in-app "Help" entry point's exact UI (app-bar icon, keyboard shortcut, both).
- Validate the Tauri asset-protocol/bundled-resource approach against the actual installed
  Tauri version's APIs before committing to the window-reuse design above.
- Write the actual help content, page by page, together.
- Nail down the screenshot-capture workflow specifics: which states need capturing, and how
  captures get refreshed/versioned as the UI evolves.

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

### Open items for the video pipeline

- `edge-tts` is a Python dependency (`pip install edge-tts`) — this project otherwise has no
  Python tooling (Node/Vite frontend, Rust/Tauri backend). Worth deciding deliberately later
  whether that's fine as a docs/video-generation-only tool, or whether an equivalent
  JS-callable option should be found instead, before wiring it into any committed script.
- No script/automation code has been written yet — this is still "we validated the pieces
  work," not "there's a pipeline." The three-phase design above is the plan, not yet a
  reality.
- Decide the actual list of tutorial topics/sections (probably mirrors the help-docs topic
  list once that's decided).
- Decide screen-recording tooling specifics (ffmpeg capture command for a specific Tauri
  window on Windows hasn't been tried yet).
- Decide the buffer length between narration end and next action (a small fixed pause was
  discussed, no specific value chosen).
- Revisit ElevenLabs (or a cloned voice) later if `edge-tts` ever feels limiting — nothing
  above forecloses that.
