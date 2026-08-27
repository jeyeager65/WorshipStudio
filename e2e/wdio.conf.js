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

let viteDevServer

export const config = {
  runner: 'local',
  specs: ['./specs/**/*.spec.js'],
  maxInstances: 1,
  maxInstancesPerCapability: 1,

  // See helpers/harness.js for what each step below actually does (isolated app-data wipe,
  // e2e-binary identifier check, dev server startup) — shared with wdio.record.conf.js so the
  // two never drift on the parts that matter for safety.
  onPrepare: async function () {
    // First, before anything else — see verifyE2eBinaryIdentifier's own comment for why this
    // has to be the very first thing that runs, ahead of even the appDataDir wipe below.
    verifyE2eBinaryIdentifier()
    resetAppDataDir()
    viteDevServer = await startDevServer()
  },

  // Again before every spec file, not just once per run. onPrepare alone left all 32 specs
  // sharing one app-data directory, so whatever each one created stayed for the rest — and specs
  // that assume a clean library passed alone and failed in the suite, which reads as flakiness
  // rather than the order dependency it is. Four specs were failing this way
  // (external-apps, external-app-live, external-app-trigger-key, remote-control), each of them
  // passing on its own.
  //
  // beforeSession runs before the app launches for that spec, which is the only moment the wipe
  // is safe: the app reads this directory at startup and holds it open afterwards.
  beforeSession: function () {
    resetAppDataDir()
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

  onComplete: function () {
    stopDevServer(viteDevServer)
  },
}
