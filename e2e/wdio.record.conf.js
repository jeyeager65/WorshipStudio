import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  verifyE2eBinaryIdentifier,
  resetAppDataDir,
  startDevServer,
  stopDevServer,
  tauriServiceEntry,
  tauriCapabilities,
} from './helpers/harness.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// Same harness as wdio.conf.js (see that file and helpers/harness.js), but a different spec:
// video/overview.record.js drives the app and records it instead of asserting anything.
// notes/help-system-plan.md's video-pipeline proof of concept.

let viteDevServer

export const config = {
  runner: 'local',
  specs: ['./video/overview.record.js'],
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
    // The recording drives several beats with real narration-length pauses between them —
    // comfortably longer than the 60s the real test suite's mochaOpts.timeout uses — the
    // overview video itself now runs to several minutes (18 narrated beats), plus seeding.
    timeout: 420000,
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

  onComplete: function () {
    stopDevServer(viteDevServer)
  },
}
