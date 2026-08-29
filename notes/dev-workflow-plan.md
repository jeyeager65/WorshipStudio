# Development workflow plan

Three related changes, agreed and built on 2026-08-27, ahead of 0.9.0 — the release that first
puts Worship Studio in front of people other than the author:

1. **Release notes** — a user-facing account of what changed, which does not exist today.
2. **Branching** — feature branches and pull requests, with `dev` as an integration branch.
3. **A dev deployment** — somewhere to test the web/tablet build without touching what the
   church runs.

They interlock. PR-based merges are what make GitHub's generated release notes useful (grouped by
PR rather than a flat commit list), and the `dev` branch only earns its keep because something
deploys from it.

All three are in place; each section's own "Built" list records what was actually done, and the
reasoning above it is kept because it is the part that would otherwise be lost. See
[release-process.md](release-process.md) for the release flow these changed.

---

## 1. Release notes

### The problem

Everything shipped so far has been seen only by the author, so "what changed" has never needed
saying. From 0.9.0 that stops being true.

What exists today:

- `generateReleaseNotes: true` in `.github/workflows/release.yml` produces GitHub's automatic
  notes — a flat commit list while the project is on direct-to-main commits. For 0.9.0 that would
  be ~90 entries reading like `Reserve the real header and footer space when sizing slide text`.
  Accurate, and useless to a volunteer.
- `releaseBody` prepends the static SmartScreen/certificate paragraph.
- `releaseDraft: true` — **releases are created as drafts**, so there is already a human step
  before anything is published. That is where notes belong; no new process is needed.
- **The updater already receives release notes and throws them away.**
  `@tauri-apps/plugin-updater`'s `Update` object carries `version`, `date` and `body`;
  `src/stores/tauriUpdate.ts` keeps only a boolean `updateAvailable`. So the prompt can say that
  an update exists but never what is in it.

### Decisions

**No developer changelog.** Git is already that, and `generateReleaseNotes` links the compare view
for anyone who wants it. A hand-maintained `CHANGELOG.md` duplicating commit history would rot.

**A user-facing account is a different document** and is the thing that's missing. One source,
three surfaces:

| Surface | What it holds |
| --- | --- |
| `docs/whats-new.md` | The canonical cumulative list, newest first. Versioned with the code, ships as offline in-app help, linkable. |
| GitHub release body | That version's entry, plus the existing certificate boilerplate. |
| In-app update prompt | Version number and a one-line summary, linking to What's New. The only one most people will ever see. |

**Written at release time, from the commit range.** The publish flow already runs CI, bumps the
version and tags; drafting the entry becomes one more step in it, reviewed before it ships. The
commit bodies in this repo are unusually rich — they explain *why* — which is exactly what a
user-facing note needs and what a generator cannot produce.

**Not Conventional Commits / release-please.** They would mean rewriting how commits are written
to serve a generator whose output is developer-facing anyway.

### The editorial rule

Write what changed **for the person using it**, not what changed in the code. Most commits produce
no user-visible change and belong nowhere. Group as **New / Improved / Fixed** so someone can
decide in seconds whether an update matters to them.

Worked example — the docs refresh in v0.8.64 was ~15 commits and reduces to about two lines:

> - New guide for connecting a tablet or Mac to OneDrive.
> - Screenshots and guides updated to match the current setup flow.

### 0.9.0 is not a changelog entry

Nobody has seen 0.1 through 0.8, so "what changed since 0.8.65" means nothing to a first-time
reader. **0.9.0 needs a launch note**: what the app is, what it does, how to install it, where the
docs are. The running changelog starts at 0.9.1.

### Built

- [x] `docs/whats-new.md`, top-level in the sidebar — it is what someone opens after being told an
      update exists.
- [x] The 0.9.0 entry, written as an introduction rather than a changelog.
- [x] The desktop update prompt names the version, and both prompts link to What's New.
      `Update.body` is deliberately *not* shown: it is the GitHub release body, which opens with
      the certificate explanation and continues into a generated commit list.
- [x] `releaseBody` keeps only the certificate boilerplate; the per-release entry is pasted into
      the draft by hand, since it is written per release anyway.

---

## 2. Branching

Moving off direct-to-main (see the post-1.0 note in this repo's history — this brings that
forward). The author is experienced with this model; this section is a record of *which* variant
was chosen, not an explanation of the model.

### Branches

| Branch | Role |
| --- | --- |
| `main` | What churches are running. Protected: CI required, no direct pushes. Tags are cut here. |
| `dev` | Integration. Auto-deploys to the dev environment (section 3). |
| `feature/*` | One change. PRs into `dev`. |
| `flyup/*` | Urgent fix straight to `main` (this project's term for a hotfix). |

### Flow

- Feature branch → PR → `dev`.
- Release: PR `dev` → `main`, then tag `main`. Tags only ever on `main`.
- **The version bump belongs in the release PR**, not on feature branches, so `dev` never carries
  a half-claimed version.
- **Flyup:** branch from `main`, PR into `main`, tag, then merge `main` back into `dev` so the fix
  isn't lost on the next release. Worth having written down before it's needed at 10:40 on a
  Sunday morning.

### Merge strategy

**Merge commits, not squash.** Commits here are individually substantial and explain their own
reasoning; squashing several into one PR commit throws that away. PR titles are what release notes
group by — the commits underneath stay intact and readable.

### What this actually buys, solo

Not review — there is no second reviewer. It buys **branch protection making CI a gate rather than
a notification**: today a red build lands on `main` and is discovered afterwards. Plus a diff to
read before merging, and PR-grouped release notes.

### Built

- [x] `dev` created from `main`.
- [x] Branch protection on `main`: pull request required, `frontend` and `rust` must pass, no
      force pushes. `enforce_admins` deliberately off — the protection is there to stop routine
      mistakes, not to lock the maintainer out mid-service.
- [x] `ci.yml` runs on pushes to `dev` as well, or every commit between releases would go
      unchecked until the release pull request.
- [x] `release.yml` refuses a tag that is not an ancestor of `main`. Tags are not branch-scoped,
      so nothing else stopped a tag on `dev` publishing a release.
- [x] Folded into [release-process.md](release-process.md) rather than a separate file — that is
      where someone cutting a release already looks.

---

## 3. Dev deployment (Cloudflare Pages)

### Why not a subpath on GitHub Pages

The obvious option was `jeyeager65.github.io/WorshipStudioDev` alongside `/WorshipStudio`. Both
base paths are already parameterized (`VITE_BASE_PATH`, `VITEPRESS_BASE_PATH`), so it looks cheap.

**It is unsafe.** An origin is scheme + host + port — *the path is not part of it*. Every project
Pages site under one account shares the host `jeyeager65.github.io`, so a dev build there shares
`localStorage`, IndexedDB and OPFS with the real app. Concretely, it would share the
OneDrive/Dropbox token storage, the settings singleton, and the tablet build's OPFS copy of the
library: a dev build signing in or out would move production's tokens.

Two things that sound like they help and don't:

- **Storage partitioning** partitions embedded third-party contexts by top-level site, not
  same-host paths.
- **`github.io` being on the Public Suffix List** scopes *cookies*; it does not split the origin
  for storage.

A second GitHub repo doesn't help either, for the same reason — it is still a path under the same
host. Getting a separate origin on GitHub Pages requires a custom domain or a GitHub organization
(`orgname.github.io` being a different host).

### The decision

**Cloudflare Pages**, giving a `*.pages.dev` host — a genuinely different origin, and therefore
separate storage, a separate PWA install and a separate service worker. Free, no domain required,
auto-deploys per branch (so a feature branch can get its own testable build), and it leaves the
existing GitHub Pages release deploy untouched.

### Testing on a real tablet needs HTTPS, always

Confirmed the hard way on 2026-08-27: serving the dev build over plain `http://<LAN-IP>` and
opening it on an iPad fails immediately — `crypto.randomUUID is not a function`. It is
secure-context-only, and the app calls it in 67 places including the mock adapter's own id
generator, so even the demo cannot create a record. Songs error, services hang on the spinner.

So there is no "just point the iPad at the dev server" shortcut. Any tablet testing needs a real
HTTPS origin: a Cloudflare quick tunnel (`cloudflared tunnel --url http://localhost:5174`) for a
one-off, or the dev deployment below for anything ongoing. This is a large part of what makes the
dev deployment worth building rather than a nicety.

### Consequences to handle

- **Register the dev origin's redirect URI in Entra** as a second SPA entry on the same app
  registration — exact match, trailing slash included. Without it, OAuth fails on dev. See
  `docs/cloud-setup.md`.
- **Point dev at a copy of the library, never the real folder.** The origin isolation protects
  browser storage; it does nothing to protect the OneDrive folder a dev build is told to sync.
- **Base path differs** from the GitHub Pages build. The release workflow uses
  `VITE_BASE_PATH=/WorshipStudio/app/`; a Cloudflare project serving the app at its root wants
  `/` (or its own subpath if the docs site is served alongside).
- **Decide what dev serves.** The release deploy assembles the docs site at `/` with the app at
  `/app/`. Simplest is for dev to mirror that exactly, so the only difference between environments
  is the origin.

### Built

Live at **https://worshipstudio.jeyeager.workers.dev** — help site at the root, app at `/app/`.

- [x] Built and deployed by GitHub Actions rather than by Cloudflare's own Git integration: the
      same build already runs in `ci.yml`, and a second build configuration would only be
      something else to keep in step. `deploy-dev` needs both check jobs, so a dev URL never
      serves a build that does not compile.
- [x] `pnpm build:pages` (scripts/build-pages.mjs) assembles the combined site; `wrangler.jsonc`
      declares a static-assets-only Worker over it.
- [x] `WS_APP_URL` repoints the help site's links to the app at this origin, so a tester following
      "Try the Web Demo" stays on the build they came to test. Rewritten before compilation —
      doing it after rendering left the production URL in the page's JS chunk, and hydration put
      it back.
- [x] Redirect URI added in Entra, under the **SPA** platform.

---

## Order

1. **Release notes** — approved, self-contained, and needed for 0.9.0 regardless.
2. **Branching** — do it between pieces of work rather than mid-stream, since moving to PRs while
   files are in flight is needless friction.
3. **Dev deployment** — independent; needs the Cloudflare project to exist first.
