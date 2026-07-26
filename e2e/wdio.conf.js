import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
}
