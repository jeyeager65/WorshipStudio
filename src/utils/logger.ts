// One shared logger for the whole frontend, used by every adapter (Tauri/web/tablet/mock) alike
// -- until this existed, only the Rust side ever wrote to a persistent log, so anything that
// actually happens in the UI/adapter layer (which is where most of the app's real logic lives)
// left no trace once a tab or window closed. Call sites should stay sparse: this is for
// lifecycle milestones and genuine failures an operator or developer would want after the fact,
// not routine per-render/per-keystroke noise -- logging everything is as useless as logging
// nothing.
//
// On Tauri, entries are also forwarded to @tauri-apps/plugin-log, which writes them into the
// *same* rotating file the Rust backend's own log:: calls already use (see src-tauri/src/lib.rs)
// -- one unified log, no separate frontend log file to go looking for. On web/tablet, there's no
// writable OS log file to forward to at all, so entries are kept in an in-memory ring buffer
// instead and surfaced through the Diagnostics port's "Export Diagnostic Bundle" action
// (adapters/web/index.ts, adapters/tablet/index.ts) -- not persistent across a reload, but at
// least captures recent activity on demand instead of nothing.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  time: string
  level: LogLevel
  scope: string
  message: string
}

// Enough recent history to be useful in a bundle without growing unbounded in a long-running
// session -- this is a debugging aid, not an audit trail.
const RING_BUFFER_LIMIT = 300
const ring: LogEntry[] = []

// Deliberately not imported from '@/adapters' -- that barrel pulls in every adapter's factory
// module, and this file is imported *from* some of those adapters (see the diagnostics wiring in
// adapters/web/index.ts and adapters/tablet/index.ts) to surface the ring buffer, so importing
// back from '@/adapters' here would risk a module cycle for no real benefit over this same
// one-line check main.ts already uses independently. The ambient Window augmentation is declared
// locally too (not reused from adapters/index.ts's identical one) -- this file is also compiled
// standalone by tsconfig.remote.json (src-remote's build), which includes src/utils/**/*.ts but
// not adapters/index.ts, so that file's declare global wouldn't be visible here.
declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
  }
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__)
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

const consoleByLevel: Record<LogLevel, (...args: unknown[]) => void> = {
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error,
}

// Lazily imported -- most sessions on web/tablet never need this module at all, and even on
// Tauri it's only needed after the first log call, not at startup.
let tauriLogModule: typeof import('@tauri-apps/plugin-log') | undefined
let tauriLogModulePromise: Promise<typeof import('@tauri-apps/plugin-log')> | undefined

function forwardToTauriLog(level: LogLevel, line: string) {
  if (!isTauri()) return
  if (!tauriLogModulePromise) {
    tauriLogModulePromise = import('@tauri-apps/plugin-log').then((module) => {
      tauriLogModule = module
      return module
    })
  }
  const send = (module: typeof import('@tauri-apps/plugin-log')) => {
    const fn = level === 'debug' ? module.debug : module[level]
    void fn(line).catch(() => {
      // The log plugin itself failing to forward is not worth a second log call.
    })
  }
  if (tauriLogModule) send(tauriLogModule)
  else void tauriLogModulePromise.then(send)
}

function emit(level: LogLevel, scope: string, message: string) {
  ring.push({ time: new Date().toISOString(), level, scope, message })
  if (ring.length > RING_BUFFER_LIMIT) ring.shift()

  const line = `[${scope}] ${message}`
  consoleByLevel[level](line)
  forwardToTauriLog(level, line)
}

export const logger = {
  debug(scope: string, message: string) {
    emit('debug', scope, message)
  },
  info(scope: string, message: string) {
    emit('info', scope, message)
  },
  warn(scope: string, message: string, error?: unknown) {
    emit('warn', scope, error === undefined ? message : `${message}: ${formatError(error)}`)
  },
  error(scope: string, message: string, error?: unknown) {
    emit('error', scope, error === undefined ? message : `${message}: ${formatError(error)}`)
  },
  /** A snapshot of the most recent entries -- used by the web/tablet Diagnostics port, which has
   *  no log file of its own to read from (see this file's own top-of-file comment). */
  recent(): LogEntry[] {
    return [...ring]
  },
}
