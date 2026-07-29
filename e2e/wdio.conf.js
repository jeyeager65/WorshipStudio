import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { appDataDir } from './helpers/appDataDir.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// Points at the debug binary produced by `pnpm --filter e2e run build:app` (a plain
// `tauri build --debug --no-bundle`, run separately rather than on every test invocation —
// this suite is re-run often while iterating, and a full rebuild every time is unnecessary
// overhead when the app hasn't changed since the last build).
const appBinaryPath = path.resolve(__dirname, '../src-tauri/target/debug/worship-studio.exe')

export const config = {
  runner: 'local',
  specs: ['./specs/**/*.spec.js'],
  maxInstances: 1,
  maxInstancesPerCapability: 1,

  // Wipes the isolated E2E app-data directory before every run — see helpers/appDataDir.js
  // for why this is safe (never the real dev profile) and why it matters (guarantees every
  // spec starts from the exact same clean slate, rather than accumulating leftover services/
  // people/themes from whatever ran before it).
  //
  // Pre-seeding hasCompletedSetup: true here (rather than leaving it for App.vue's own
  // first-run default) matters more than it looks: every spec's "skip setup if it's showing"
  // guard is a point-in-time isExisting() check, not a wait, so it only works if the wizard's
  // own redirect either has already happened or never happens at all — a real race either
  // way. Against the old shared, long-since-onboarded dev profile that redirect never fired,
  // so the race never mattered; against a genuinely fresh directory it fires on every single
  // spec, not just the ones that mean to test it. setup-wizard.spec.js reaches the wizard via
  // Settings' "Run First-Time Setup Wizard" regardless of this flag, so it's unaffected.
  onPrepare: function () {
    fs.rmSync(appDataDir, { recursive: true, force: true })
    fs.mkdirSync(appDataDir, { recursive: true })
    fs.writeFileSync(
      path.join(appDataDir, 'machine-settings.json'),
      JSON.stringify(
        {
          thisComputerName: 'E2E Test Machine',
          darkMode: true,
          libraryPath: path.join(appDataDir, 'Library'),
          hasCompletedSetup: true,
          localMediaPath: path.join(appDataDir, 'LocalMedia'),
          displayRoles: {},
        },
        null,
        2,
      ),
    )
  },

  services: [
    [
      '@wdio/tauri-service',
      {
        appBinaryPath,
        // 'external' matches docs/architecture-plan.md's tauri-driver choice and needs no
        // test-only plugin added to the shipped app's own Cargo.toml/lib.rs (the 'embedded'
        // default would require that). tauri-driver itself is `cargo install`ed separately
        // (see e2e/README.md), not managed per-run.
        driverProvider: 'external',
        autoDownloadEdgeDriver: true,
        captureBackendLogs: true,
        captureFrontendLogs: true,
      },
    ],
  ],

  capabilities: [
    {
      browserName: 'tauri',
      // The app is a client-side-routed SPA (vue-router, History API pushState) — no real
      // navigation/load event ever fires after the first load, so the default 'normal'
      // pageLoadStrategy's wait-for-load-complete blocks findElement indefinitely after any
      // in-app navigation.
      pageLoadStrategy: 'none',
      'tauri:options': {
        application: appBinaryPath,
      },
    },
  ],

  logLevel: 'info',
  bail: 0,
  waitforTimeout: 10000,
  connectionRetryTimeout: 90000,
  connectionRetryCount: 3,

  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },
  reporters: ['spec'],

  afterTest: async function (test, context, { passed }) {
    if (!passed) {
      const dir = path.resolve(__dirname, 'screenshots')
      await import('node:fs').then((fs) => fs.mkdirSync(dir, { recursive: true }))
      const file = path.join(dir, `${test.parent} - ${test.title}`.replace(/[^a-z0-9-_ ]/gi, '_') + '.png')
      await browser.saveScreenshot(file)
      console.log(`Screenshot saved: ${file}`)
    }
  },

  // @wdio/tauri-service's own teardown (driverPool.stopAll()) doesn't reliably kill the
  // external tauri-driver.exe process on Windows, nor its own msedgedriver.exe child — every
  // run was silently leaking one of each, which piled up into dozens of orphaned processes
  // over a long session and eventually caused new runs to fail outright (a stale tauri-driver
  // squatting on the port a fresh run tries to bind). Best-effort and platform-guarded since
  // this is cleaning up after a dependency bug, not something core to the test run itself.
  onComplete: function () {
    if (process.platform !== 'win32') return
    for (const image of ['tauri-driver.exe', 'msedgedriver.exe']) {
      try {
        execFileSync('taskkill', ['/F', '/IM', image, '/T'], { stdio: 'ignore' })
      } catch {
        // Not running — fine.
      }
    }
  },
}
