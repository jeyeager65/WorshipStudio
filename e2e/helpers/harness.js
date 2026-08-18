import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { appDataDir } from './appDataDir.js'

// Shared between wdio.conf.js (the real spec suite) and wdio.record.conf.js (the video-POC
// "drive the app and record instead of testing" harness, see notes/help-system-plan.md) —
// factored out so the two never drift on the parts that matter for safety (verifying the
// e2e-sandboxed binary, isolating app data, cleaning up orphaned Windows processes), not just
// to avoid typing it twice.

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')

// Points at the debug binary produced by `npm run build:app` (see e2e/README.md) — not
// rebuilt automatically here for the same reason wdio.conf.js doesn't: both this and the test
// suite get re-run often while iterating, and a full rebuild every time is unnecessary
// overhead when the app hasn't changed since the last build.
export const appBinaryPath = path.resolve(repoRoot, 'src-tauri/target/debug/worship-studio.exe')

// A `--debug` Tauri build loads `build.devUrl` at runtime instead of the bundled dist/ assets —
// read the same URL those debug binaries were compiled against, from the same tauri.conf.json,
// rather than hardcoding it a second time.
const tauriConf = JSON.parse(fs.readFileSync(path.resolve(repoRoot, 'src-tauri/tauri.conf.json'), 'utf-8'))
export const devUrl = new URL(tauriConf.build.devUrl)

// build:app's own identifier override is what makes appDataDir an isolated sandbox instead of
// the operator's real profile — but it only takes effect on a build that actually passes
// `-c tauri.e2e.conf.json`. A later plain `cargo build`/`tauri dev` silently recompiles this
// exact binary path back to the real identifier, with no error of any kind. Reading the
// identifier string straight out of the compiled binary (rather than trusting the last build's
// *intent*) catches that before anything can touch real data.
const e2eIdentifier = JSON.parse(
  fs.readFileSync(path.resolve(repoRoot, 'src-tauri/tauri.e2e.conf.json'), 'utf-8'),
).identifier

export function verifyE2eBinaryIdentifier() {
  const buffer = fs.readFileSync(appBinaryPath)
  if (!buffer.includes(e2eIdentifier)) {
    throw new Error(
      `${appBinaryPath} was not built with the e2e identifier ("${e2eIdentifier}") — ` +
        `it would read and write your real production library instead of the isolated e2e ` +
        `sandbox. Rebuild it with "npm run build:app" (not a plain cargo/tauri build) before ` +
        `running this.`,
    )
  }
}

export function waitForPort(port, host, timeoutMs) {
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

// A prior run's teardown only fires on a normal exit — a hard interrupt (Ctrl+C, a killed
// terminal) leaves that run's own `pnpm dev` orphaned, still bound to devUrl's port. Reclaiming
// the port before spawning (and again on the way out) makes every run self-healing regardless
// of how the previous one died.
export function killProcessOnPort(port) {
  if (process.platform === 'win32') {
    let output
    try {
      output = execFileSync('netstat', ['-ano'], { encoding: 'utf-8' })
    } catch {
      return
    }
    const pids = new Set()
    for (const line of output.split('\n')) {
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

// Wipes the isolated E2E app-data directory and pre-seeds hasCompletedSetup: true (skips the
// first-run wizard redirect race — see wdio.conf.js's original onPrepare comment for why that
// matters) so every run starts from the exact same clean slate. machine-settings.json lives
// under a `Local` subfolder, not flat in app-data — see src-tauri/src/paths.rs's local_root.
export function resetAppDataDir() {
  fs.rmSync(appDataDir, { recursive: true, force: true })
  const localDir = path.join(appDataDir, 'Local')
  fs.mkdirSync(localDir, { recursive: true })
  fs.writeFileSync(
    path.join(localDir, 'machine-settings.json'),
    JSON.stringify(
      {
        thisComputerName: 'E2E Test Machine',
        darkMode: true,
        libraryPath: path.join(appDataDir, 'Library'),
        hasCompletedSetup: true,
        displayRoles: {},
      },
      null,
      2,
    ),
  )
}

// VITE_E2E_TEST_MODE must be set here, not just in build:app's `tauri build` step — App.vue
// reads it at runtime to skip the splash-window handshake and its timing floors, since the e2e
// Rust build deliberately creates no splash window for it to hear back from.
export async function startDevServer() {
  killProcessOnPort(Number(devUrl.port))
  const viteDevServer = spawn('pnpm', ['dev'], {
    cwd: repoRoot,
    env: { ...process.env, VITE_E2E_TEST_MODE: 'true' },
    stdio: 'ignore',
    shell: true,
  })
  await waitForPort(Number(devUrl.port), devUrl.hostname, 30000)
  return viteDevServer
}

// @wdio/tauri-service's own teardown doesn't reliably kill the external tauri-driver.exe
// process on Windows, nor its own msedgedriver.exe child — best-effort and platform-guarded
// since this is cleaning up after a dependency bug, not something core to the run itself.
export function stopDevServer(viteDevServer) {
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
  killProcessOnPort(Number(devUrl.port))

  if (process.platform !== 'win32') return
  for (const image of ['tauri-driver.exe', 'msedgedriver.exe']) {
    try {
      execFileSync('taskkill', ['/F', '/IM', image, '/T'], { stdio: 'ignore' })
    } catch {
      // Not running — fine.
    }
  }
}

// Shared `@wdio/tauri-service` options and capabilities — see wdio.conf.js's original comments
// for why 'external' (plain tauri-driver, no in-app plugin) and pageLoadStrategy: 'none' (this
// app is a client-side-routed SPA; the default load-complete wait blocks findElement forever
// after in-app navigation) are both deliberate.
export function tauriServiceEntry() {
  return [
    '@wdio/tauri-service',
    {
      appBinaryPath,
      driverProvider: 'external',
      autoDownloadEdgeDriver: true,
      captureBackendLogs: true,
      captureFrontendLogs: true,
    },
  ]
}

export const tauriCapabilities = {
  browserName: 'tauri',
  pageLoadStrategy: 'none',
  'tauri:options': {
    application: appBinaryPath,
  },
}
