import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { appDataDir } from './helpers/appDataDir.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// Points at the debug binary produced by `pnpm --filter e2e run build:app` (a plain
// `tauri build --debug --no-bundle`, run separately rather than on every test invocation —
// this suite is re-run often while iterating, and a full rebuild every time is unnecessary
// overhead when the app hasn't changed since the last build).
const appBinaryPath = path.resolve(__dirname, '../src-tauri/target/debug/worship-studio.exe')

// A `--debug` Tauri build loads `build.devUrl` at runtime instead of the bundled dist/ assets
// (real Tauri behavior for debug builds, not a bug) — read the same URL those debug binaries
// were compiled against, from the same tauri.conf.json, rather than hardcoding it a second time.
const tauriConf = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../src-tauri/tauri.conf.json'), 'utf-8'),
)
const devUrl = new URL(tauriConf.build.devUrl)

// build:app's own identifier override (see e2e/README.md) is what makes appDataDir an isolated
// sandbox instead of the operator's real profile — but it only takes effect on a build that
// actually passes `-c tauri.e2e.conf.json`. A later plain `cargo build`/`tauri dev` (e.g.
// triggered by an editor's background rust-analyzer build, or just forgetting the right script)
// silently recompiles this exact binary path back to the real identifier, with no error of any
// kind — every spec below would then read and write the operator's actual production library
// instead of the sandbox. Reading the identifier string straight out of the compiled binary
// (rather than trusting the last build's *intent*) catches that before a single spec can touch
// real data, the same way the app itself resolves its own app-data path at runtime.
const e2eIdentifier = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../src-tauri/tauri.e2e.conf.json'), 'utf-8'),
).identifier

function verifyE2eBinaryIdentifier() {
  const buffer = fs.readFileSync(appBinaryPath)
  if (!buffer.includes(e2eIdentifier)) {
    throw new Error(
      `${appBinaryPath} was not built with the e2e identifier ("${e2eIdentifier}") — ` +
        `it would read and write your real production library instead of the isolated e2e ` +
        `sandbox. Rebuild it with "npm run build:app" (not a plain cargo/tauri build) before ` +
        `running this suite.`,
    )
  }
}

function waitForPort(port, host, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(port, host)
      socket.once('connect', () => {
        socket.end()
        resolve()
      })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() > deadline) reject(new Error(`Timed out waiting for ${host}:${port}`))
        else setTimeout(attempt, 200)
      })
    }
    attempt()
  })
}

// A prior run's onComplete only fires on a normal exit — a hard interrupt (a rejected tool call,
// a killed terminal, Ctrl+C) skips it entirely and leaves that run's own `pnpm dev`/vite server
// orphaned, still bound to devUrl's port. The next run's vite then silently drifts to the next
// free port (5174, 5175, ...) while the app keeps loading devUrl's hardcoded port and finds
// nothing there ("localhost refused to connect") — or worse, the app loads content from a stale,
// possibly-degraded leftover server instead of the fresh one this run just spawned. Reclaiming
// the port before spawning (and again on the way out, as a second line of defense alongside the
// PID-based kill below) makes every run self-healing regardless of how the previous one died.
function killProcessOnPort(port) {
  if (process.platform === 'win32') {
    let output
    try {
      output = execFileSync('netstat', ['-ano'], { encoding: 'utf-8' })
    } catch {
      return
    }
    const pids = new Set()
    for (const line of output.split('\n')) {
      // Anchor on the local-address column specifically — a bare `:PORT` match anywhere in the
      // line could false-positive on a remote address or a PID that happens to contain the port.
      const match = line.match(/^\s*TCP\s+\S*:(\d+)\s+\S+\s+LISTENING\s+(\d+)/)
      if (match && Number(match[1]) === port) pids.add(match[2])
    }
    for (const pid of pids) {
      try {
        execFileSync('taskkill', ['/F', '/T', '/PID', pid], { stdio: 'ignore' })
      } catch {
        // Already gone — fine.
      }
    }
    return
  }
  let output
  try {
    output = execFileSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf-8' })
  } catch {
    return
  }
  for (const pid of output.split('\n').filter(Boolean)) {
    try {
      process.kill(Number(pid), 'SIGKILL')
    } catch {
      // Already gone — fine.
    }
  }
}

let viteDevServer

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
  onPrepare: async function () {
    // First, before anything else — see verifyE2eBinaryIdentifier's own comment for why this
    // has to be the very first thing that runs, ahead of even the appDataDir wipe below.
    verifyE2eBinaryIdentifier()

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

    // Reclaim devUrl's port from any orphaned server a previous, hard-interrupted run left
    // behind — see killProcessOnPort's own comment — before spawning this run's own instance.
    killProcessOnPort(Number(devUrl.port))

    // The debug e2e binary needs `devUrl` actually serving — start it for the duration of the
    // suite rather than silently depending on some other dev server happening to already be
    // running (that was previously masking this exact dependency).
    //
    // VITE_E2E_TEST_MODE must be set here too, not just in build:app's `tauri build` step —
    // App.vue reads it at runtime (import.meta.env.VITE_E2E_TEST_MODE) to skip the splash-window
    // handshake and its MIN_SPLASH_MS/READY_DISPLAY_MS/MIN_STEP_MS floors, since the e2e Rust
    // build deliberately creates no splash window for it to hear back from. Without it here, the
    // frontend this dev server serves still waits on that dead handshake and those floors on
    // every single fresh app launch the suite does — a real, compounding source of timeouts.
    viteDevServer = spawn('pnpm', ['dev'], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, VITE_E2E_TEST_MODE: 'true' },
      stdio: 'ignore',
      shell: true,
    })
    await waitForPort(Number(devUrl.port), devUrl.hostname, 30000)
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
    if (viteDevServer?.pid) {
      try {
        if (process.platform === 'win32') {
          execFileSync('taskkill', ['/F', '/T', '/PID', String(viteDevServer.pid)], {
            stdio: 'ignore',
          })
        } else {
          process.kill(-viteDevServer.pid)
        }
      } catch {
        // Already gone — fine.
      }
    }
    // Second line of defense alongside the PID-based kill above — catches anything the tree-kill
    // missed (e.g. a grandchild vite spawned under pnpm's own `shell: true` wrapper).
    killProcessOnPort(Number(devUrl.port))

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
