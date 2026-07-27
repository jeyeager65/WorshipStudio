import path from 'node:path'

// The E2E build (build:app, via tauri.e2e.conf.json's identifier override) reads/writes an
// entirely separate app-data directory from the real dev profile (dev.yeager.worshipstudio) —
// specs that write fixtures directly to disk need to target this one, not the real profile,
// or the isolated E2E app instance would never see them. Single source of truth here rather
// than each spec hardcoding the identifier itself.
export const appDataDir = path.join(process.env.APPDATA, 'dev.yeager.worshipstudio.e2e')
