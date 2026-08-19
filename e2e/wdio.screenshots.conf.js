import {
  verifyE2eBinaryIdentifier,
  resetAppDataDir,
  startDevServer,
  stopDevServer,
  tauriServiceEntry,
  tauriCapabilities,
} from './helpers/harness.js'

// Same harness as wdio.conf.js/wdio.record.conf.js (see those files and helpers/harness.js), but
// a different spec: docs-screenshots/capture.js drives the app and saves docs screenshots
// instead of asserting anything or recording video — see that file's own doc comment and
// notes/help-system-plan.md's "Screenshots" section. Deliberately not named "screenshots/" —
// that directory is gitignored (see e2e/.gitignore), reserved for wdio.conf.js/
// wdio.record.conf.js's own afterTest failure-diagnostic dumps, not for source files that need
// to be committed.

let viteDevServer

export const config = {
  runner: 'local',
  specs: ['./docs-screenshots/capture.js'],
  maxInstances: 1,
  maxInstancesPerCapability: 1,

  onPrepare: async function () {
    verifyE2eBinaryIdentifier()
    resetAppDataDir()
    viteDevServer = await startDevServer()
  },

  services: [tauriServiceEntry()],

  capabilities: [tauriCapabilities],

  logLevel: 'info',
  bail: 0,
  waitforTimeout: 10000,
  connectionRetryTimeout: 90000,
  connectionRetryCount: 3,

  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    // Seeding (Load Sample Data, Add Stock Backgrounds) is the slow part — comfortably longer
    // than the real test suite's default, well short of the video recording's 420000.
    timeout: 120000,
  },
  reporters: ['spec'],

  onComplete: function () {
    stopDevServer(viteDevServer)
  },
}
