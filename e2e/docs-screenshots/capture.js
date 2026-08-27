import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { seedSampleData } from '../helpers/seedSampleData.js'
import { appDataDir } from '../helpers/appDataDir.js'

// Generates the screenshots the VitePress docs (../../docs) embed — see
// notes/help-system-plan.md's "Screenshots" section. Deliberately not part of the CI-facing e2e
// suite (wdio.conf.js): these need visual review before landing (a UI change can shift layout in
// ways worth a second look before publishing), and only need regenerating when the UI a given
// shot covers actually changes, not on every push. Run with `npm run capture:screenshots` (see
// e2e/README.md) after `npm run build:app`.
//
// WebDriver's screenshot command only ever produces PNG, so capture() stages one here — that
// PNG is never itself the committed artifact. `npm run capture:screenshots` chains a second step
// (../scripts/convert-doc-screenshots.mjs, run from the repo root, sharp already a root
// devDependency) that converts each staged PNG to lossless WebP in docs/public/screenshots/ and
// deletes the staged PNG — same tool and reasoning as scripts/optimize-stock-backgrounds.mjs's
// PNG->WebP conversion for stock background images, just lossless here instead of quality:80,
// since these are crisp UI/text screenshots rather than photos (a photographic lossy setting
// visibly blurs text edges; WebP's lossless mode still comfortably beats PNG on these because of
// the same large flat-color regions that make PNG small in the first place).
//
// Adding a new screenshot: add a `capture('name')` call at the point in this walkthrough (or a
// new one) where the screen you want is on-screen and settled, then reference
// `/screenshots/name.webp` from the relevant docs/*.md page (see docs/roles.md, docs/services.md
// for the established pattern — root-absolute path, resolved against docs/public/ the same way
// docs/index.md's hero logos already are).

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const stagingDir = path.resolve(__dirname, '.captured')

// A `waitForExist` on the destination screen's own heading only confirms Vue Router has
// navigated and the new view mounted — it says nothing about the sidebar's own selected-item
// styling, which is a separate, CSS-transitioned/rippled Vuetify element that keeps animating
// in parallel. Without this, a capture landed mid-transition shows *two* nav items
// highlighted at once (the outgoing one still fading, the incoming one still animating in) —
// confirmed visually on a real run. 500ms comfortably covers Vuetify's default selection/ripple
// timings (typically 200-400ms) with margin.
const NAV_SETTLE_MS = 500

async function capture(name) {
  await browser.pause(NAV_SETTLE_MS)
  fs.mkdirSync(stagingDir, { recursive: true })
  const file = path.join(stagingDir, `${name}.png`)
  await browser.saveScreenshot(file)
  console.log(`Captured ${file}`)
}

// router/index.ts's global beforeEach guard intercepts *any* navigation while
// unsavedChangesStore.isDirty is true, anywhere in the app — not just Settings (already handled
// separately right after seeding below), but also e.g. a genuinely new, still-unsaved Slide,
// whose isDirty apparently goes true immediately on creation. "Leave Without Saving" (discard),
// not "Save & Leave" — this walkthrough never intends to actually persist anything it merely
// opened to screenshot.
async function dismissUnsavedChangesGuardIfShown() {
  const leaveBtn = await $('button*=Leave Without Saving')
  if (await leaveBtn.waitForExist({ timeout: 2000 }).catch(() => false)) {
    await leaveBtn.click()
  }
}

// Navigate via a sidebar link, wait for the destination screen to settle, then capture it —
// most of this walkthrough's beats are exactly this. `name` is optional so a plain "navigate and
// wait" step (e.g. reaching Settings before a deeper flow) can reuse it too, without capturing.
async function navigateAndCapture(navSelector, waitSelector, name) {
  const nav = await $(navSelector)
  await nav.waitForClickable({ timeout: 10000 })
  await nav.click()
  await dismissUnsavedChangesGuardIfShown()
  const settled = await $(waitSelector)
  await settled.waitForExist({ timeout: 10000 })
  if (name) await capture(name)
}

describe('Documentation screenshots (capture, not a test)', () => {
  it('seeds sample data, then captures each documented screen', async () => {
    // A consistent, docs-friendly size — WebDriver's screenshot command captures the webview's
    // own content at whatever size it currently is, not the physical desktop (unlike
    // video/overview.record.js's ffmpeg desktop capture, which does need exact physical
    // pixel/DPI handling — screenshots don't), so a plain setWindowSize is enough here.
    await browser.setWindowSize(1440, 900)

    // --- Seed real-looking content first. ---
    const { servicesNav, serviceCard } = await seedSampleData()

    // --- docs/services.md: the Services landing page (Schedule tab), already the current screen
    // right after seeding. ---
    const servicesHeading = await $('h1*=Services')
    await servicesHeading.waitForExist({ timeout: 10000 })
    await capture('services-schedule')

    // --- docs/services.md: the Service Plan view, reached via a service card's own "Plan"
    // button (ServiceCard.vue's openPlan) rather than opening the full workspace. Scoped to
    // '.service-actions' rather than a plain 'button*=Plan' — the bare text match hits the
    // "Plan Ahead" tab button first (it comes earlier in DOM order), never navigating anywhere,
    // confirmed on a real run. navigateAndCapture only takes a single selector string, so this
    // one needs the explicit chained lookup instead. ---
    const serviceActions = await $('.service-actions')
    const planBtn = await serviceActions.$('button*=Plan')
    await planBtn.waitForClickable({ timeout: 10000 })
    await planBtn.click()
    const planHeader = await $('.plan-editor-header')
    await planHeader.waitForExist({ timeout: 10000 })
    await capture('service-plan')

    await servicesNav.click()
    await servicesHeading.waitForExist({ timeout: 10000 })

    // --- docs/services.md: an opened service's workspace (order of worship). '.service-item'
    // (an order-of-worship row) is the same settled-workspace signal overview.record.js's own
    // beat 16 waits on. ---
    await serviceCard.click()
    const firstServiceItem = await $('.service-item')
    await firstServiceItem.waitForExist({ timeout: 10000 })
    await capture('service-workspace')

    // --- docs/roles.md: the role-category/role catalog management screen. Back out to Services
    // first rather than clicking straight from the workspace — ServiceWorkspaceView forces the
    // nav rail into its collapsed, icon-only mode (see App.vue's navCollapseRequested), and
    // capturing right after that collapsed->expanded transition caught a leftover Vuetify
    // tooltip (only active in collapsed mode — see App.vue's `v-tooltip:end="navigationCollapsed
    // ? '...' : false"` on every nav item) still fading out, confirmed visually on a real run.
    // Every other page below is reached from an already-expanded sidebar, so none of them need
    // this same detour. ---
    await servicesNav.click()
    await servicesHeading.waitForExist({ timeout: 10000 })
    const rolesNav = await $('a[href="#/roles"]')
    await rolesNav.waitForClickable({ timeout: 10000 })
    await rolesNav.click()
    const rolesHeading = await $('h1*=Roles')
    await rolesHeading.waitForExist({ timeout: 10000 })
    await capture('roles')

    // --- A straight tour of the remaining top-level library/settings areas via the sidebar —
    // same nav idiom (and the same proven selectors) as video/overview.record.js's beats 5-14.
    // Each library with its own editor/detail screen gets a second capture of that too, opened
    // via its list's own card (same class-per-card-type convention across these views) — the
    // sidebar stays in its normal expanded state on every one of these (unlike the Service
    // Workspace above), so none of them need the Roles capture's same back-out detour. ---
    await navigateAndCapture('a[href="#/library/songs"]', 'h1*=Songs', 'songs')
    await navigateAndCapture('.song-card', '.song-editor-page', 'song-editor')

    await navigateAndCapture('a[href="#/library/slides"]', 'h1*=Slides', 'slides')
    // Sample data now seeds a real pre-service announcement loop, so this opens that rather than
    // the blank New Presentation it used to — the editor shot shows actual composed slides on the
    // canvas instead of an empty one, which is the whole point of a screenshot of an editor.
    await navigateAndCapture('.presentation-card', 'div*=Slide Editor', 'slide-editor')

    await navigateAndCapture('a[href="#/library/media"]', 'h1*=Media', 'media')
    await navigateAndCapture('.media-card', 'h2*=Media Details', 'media-details')
    const closeMediaDetailsBtn = await $('[aria-label="Close Media Details"]')
    await closeMediaDetailsBtn.waitForClickable({ timeout: 10000 })
    await closeMediaDetailsBtn.click()

    await navigateAndCapture('a[href="#/library/themes"]', 'h1*=Presentation Themes', 'themes')
    await navigateAndCapture('.theme-card', '.theme-editor', 'theme-editor')

    await navigateAndCapture('a[href="#/people"]', 'h1*=People', 'people')
    await navigateAndCapture('.person-card', '.person-editor-page', 'person-editor')

    await navigateAndCapture('a[href="#/announcements"]', 'h1*=Announcements', 'announcements')
    await navigateAndCapture(
      'a[href="#/library/service-templates"]',
      'h1*=Service Templates',
      'service-templates',
    )
    await navigateAndCapture('.template-card', '.template-editor-page', 'service-template-editor')

    // --- docs/reports.md: both report types, reached from the Reports landing page. ---
    const reportsNav = await $('a[href="#/reports"]')
    await reportsNav.waitForClickable({ timeout: 10000 })
    await reportsNav.click()

    const ccliLink = await $('a*=Song Usage')
    await ccliLink.waitForClickable({ timeout: 10000 })
    await ccliLink.click()
    const ccliHeading = await $('h1*=Song Usage')
    await ccliHeading.waitForExist({ timeout: 10000 })
    await capture('reports-song-usage')

    await reportsNav.click()
    const planningLink = await $('a*=Multi-Week Plan')
    await planningLink.waitForClickable({ timeout: 10000 })
    await planningLink.click()
    const planningHeading = await $('h1*=Multi-Week Plan')
    await planningHeading.waitForExist({ timeout: 10000 })
    await capture('reports-multi-week-plan')

    // --- docs/settings.md: the Settings landing page — "This Computer" is the default section,
    // already active on arrival (see settings-general.spec.js's identical comment). ---
    await navigateAndCapture('a[href="#/settings"]', 'label*=Computer name', 'settings')

    // --- docs/sync.md: the desktop "Library folder" panel (LibrarySyncSection.vue) — captured
    // early, before the library-health conflict further down ever gets fabricated, so the
    // app-bar has no "N library issue(s)" badge in it. The tablet-only "Cloud connection" panel
    // (adapterKind === 'tablet') isn't reachable from this desktop e2e binary at all — sync.md's
    // description of that side is necessarily screenshot-free. ---
    await navigateAndCapture('.v-list-item*=Library & Sync', 'div*=Library folder', 'sync-settings')

    // --- docs/getting-started.md: the setup wizard's welcome step, reached the same way
    // settings-general.spec.js's "Run Setup Wizard" test does. Back to "This Computer" first —
    // the sync-settings capture above left the page on "Library & Sync", and "Run Setup Wizard"
    // only lives under "This Computer" (the e2e sandbox pre-seeds hasCompletedSetup: true — see
    // helpers/harness.js's resetAppDataDir — so the wizard never shows up on its own the way it
    // would for a genuinely first launch). Re-clicking 'a[href="#/settings"]' alone doesn't do
    // this — already being on the /settings route, that's a same-route no-op that leaves
    // whichever section (Library & Sync) already showing untouched; switching sections is a
    // client-side thing within the page, done by clicking that section's own list item, the
    // same way the sync-settings capture above switched *to* Library & Sync in the first place.
    // ---
    await navigateAndCapture('.v-list-item*=This Computer', 'label*=Computer name', undefined)
    const wizardBtn = await $('button*=Run Setup Wizard')
    await wizardBtn.waitForClickable({ timeout: 10000 })
    await wizardBtn.click()
    const welcomeHeading = await $('h1*=Set up Worship Studio')
    await welcomeHeading.waitForExist({ timeout: 10000 })
    await capture('getting-started')

    // Exit the wizard the same way setup-wizard.spec.js's "Skip for Now" test does, so the
    // remaining beats below start from a normal, fully-settled app state again.
    const skipWizardBtn = await $('button*=Skip for Now')
    await skipWizardBtn.waitForClickable({ timeout: 10000 })
    await skipWizardBtn.click()
    await servicesHeading.waitForExist({ timeout: 10000 })

    // --- docs/assignments.md and docs/bulletin.md: both reached from an opened service's own
    // top bar (see the "service-workspace" capture above and overview.record.js's beat 17). Two
    // separate service-opens rather than hopping sideways from one to the other, so neither
    // capture depends on assuming what the other view's own top bar exposes. Deliberately
    // captured *before* the library-health conflict below is fabricated — the app-bar "N library
    // issue(s)" badge (visible in the library-health capture itself) would otherwise bleed into
    // every capture taken after it, since this walkthrough never actually resolves the
    // fabricated conflict until the very end. ---
    await servicesNav.click()
    await serviceCard.click()
    await firstServiceItem.waitForExist({ timeout: 10000 })
    const assignmentsLink = await $('a*=Assignments')
    await assignmentsLink.waitForClickable({ timeout: 10000 })
    await assignmentsLink.click()
    const assignmentsHeading = await $('h1*=Assignments')
    await assignmentsHeading.waitForExist({ timeout: 10000 })
    await capture('assignments')

    await servicesNav.click()
    await serviceCard.click()
    await firstServiceItem.waitForExist({ timeout: 10000 })
    const bulletinLink = await $('a*=Bulletin')
    await bulletinLink.waitForClickable({ timeout: 10000 })
    await bulletinLink.click()
    const bulletinHeading = await $('h1*=Bulletin')
    await bulletinHeading.waitForExist({ timeout: 10000 })
    await capture('bulletin')

    // --- docs/library-health.md: a resolvable sync conflict. There's no in-app way to create one
    // (it only ever originates from the sync client itself) — fabricated directly on disk the
    // same way e2e/specs/sync-conflicts.spec.js does, under an id that can't collide with
    // anything Load Sample Data seeded. Last in this walkthrough on purpose — see the comment
    // above the assignments/bulletin captures. ---
    const songsDir = path.join(appDataDir, 'Library', 'songs')
    fs.mkdirSync(songsDir, { recursive: true })
    const conflictId = 'song-e2e-docs-library-health'
    const original = {
      id: conflictId,
      title: 'Great Is Thy Faithfulness',
      author: 'Thomas Chisholm',
      collections: [],
      tags: [],
      blocks: [{ id: 'v1', label: 'Verse 1', text: 'Great is Thy faithfulness, O God my Father.' }],
      defaultArrangement: { sequence: ['v1'] },
      usage: { usesPastYear: 0 },
      updatedAt: '2026-07-25T16:00:00Z',
      updatedByDevice: 'Front Desk PC',
    }
    fs.writeFileSync(path.join(songsDir, `${conflictId}.json`), JSON.stringify(original, null, 2))
    const conflicted = { ...original, author: 'Thomas Chisholm, Public Domain', updatedByDevice: "Pastor's Laptop" }
    fs.writeFileSync(
      path.join(songsDir, `${conflictId} (Pastor's Laptop's conflicted copy 2026-07-25).json`),
      JSON.stringify(conflicted, null, 2),
    )

    await navigateAndCapture('a[href="#/settings"]', 'label*=Computer name', undefined)
    const syncSection = await $('.v-list-item*=Library & Sync')
    await syncSection.waitForExist({ timeout: 10000 })
    await syncSection.click()
    const checkNowBtn = await $('button*=Check Now')
    await checkNowBtn.waitForClickable({ timeout: 10000 })
    await checkNowBtn.click()
    const reviewIssueLink = await $('a*=Review 1 Library Issue')
    await reviewIssueLink.waitForExist({ timeout: 10000 })
    await reviewIssueLink.click()
    const libraryHealthHeading = await $('h1*=Library Health')
    await libraryHealthHeading.waitForExist({ timeout: 10000 })
    await capture('library-health')

    // Resolve it too, defensively — belt-and-suspenders alongside being last in the walkthrough,
    // in case a future edit ever appends another capture after this one.
    const keepThisComputerBtn = await $('button*=Keep This Computer')
    await keepThisComputerBtn.waitForClickable({ timeout: 10000 })
    await keepThisComputerBtn.click()
  })
})
