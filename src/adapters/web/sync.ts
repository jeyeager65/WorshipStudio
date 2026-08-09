/**
 * Conflict detection, recovery, and quarantine for a File System Access-backed web build —
 * a TypeScript port of src-tauri/src/domain/sync.rs's equivalent functions, kept close enough
 * to a straight translation that the two should be read side by side when either changes.
 *
 * fsaStorage.ts's writeJsonFile gives the web build's own writes the same backup-on-write
 * behavior as Rust's write_json_file (August 2026), so recoverFromBackup/quarantineDamagedFile
 * below work the same regardless of which app (desktop or browser) most recently wrote a file.
 *
 * Also lighter than the Rust version in one place: validateLibraryJson only checks for a
 * present `id` field per kind rather than fully deserializing against each model's real shape
 * (no runtime schema-validation library is in use here). That still catches the real-world
 * failure mode this exists for — an interrupted write leaving truncated/garbage JSON — just not
 * "valid JSON with the wrong shape," which is rare enough in practice not to justify hand-rolled
 * per-model validators that would drift from the real TypeScript models over time.
 */

import type { ConflictedItem, RecoveryIssue } from '@/adapters/types'
import {
  backupPath,
  joinPath,
  listEntries,
  readFileText,
  readJsonFile,
  removeFile,
  renameFile,
  writeJsonFile,
} from './fsaStorage'

/** Matches Dropbox's "conflicted copy" filename convention — mirrors the Rust CONFLICT_PATTERN
 *  regex exactly (case-insensitive, tolerant of the wording varying by client version). */
const CONFLICT_PATTERN = /^(?<stem>.+) \([^)]*conflicted copy[^)]*\)(?<ext>\.[^./]+)?$/i

function labelFor(kind: string, value: Record<string, unknown>): string {
  const str = (key: string): string | undefined =>
    typeof value[key] === 'string' ? (value[key] as string) : undefined

  switch (kind) {
    case 'song':
      return str('title') ?? 'Untitled'
    case 'service': {
      const date = str('date') ?? ''
      const serviceType = str('type') ?? ''
      return `${date} — ${serviceType}`
    }
    case 'slide':
      return str('label') ?? 'Untitled'
    case 'media':
      return str('filename') ?? ''
    case 'theme':
      return str('name') ?? 'Untitled'
    case 'person': {
      const name = str('preferredName') ?? str('firstName')
      if (name === undefined) return ''
      const last = str('lastName') ?? ''
      return `${name} ${last}`.trim()
    }
    default:
      return str('id') ?? ''
  }
}

async function scanDirForConflicts(
  root: FileSystemDirectoryHandle,
  relativeDir: string,
  kind: string,
  out: ConflictedItem[],
): Promise<void> {
  const entries = await listEntries(root, relativeDir)
  for (const entry of entries) {
    if (entry.kind !== 'file') continue
    const match = CONFLICT_PATTERN.exec(entry.name)
    if (!match?.groups) continue
    const { stem, ext = '' } = match.groups
    const originalPath = joinPath(relativeDir, `${stem}${ext}`)
    const conflictPath = joinPath(relativeDir, entry.name)

    // The original may already be gone (deleted, or a previous conflict resolution) — nothing
    // meaningful to compare against, so this artifact is silently skipped rather than surfaced
    // as an unresolvable conflict. Same behavior as the Rust version.
    const thisVersion = await readJsonFile<Record<string, unknown>>(root, originalPath)
    if (thisVersion === null) continue
    const otherVersion = await readJsonFile<Record<string, unknown>>(root, conflictPath)
    if (otherVersion === null) continue

    const id = typeof thisVersion.id === 'string' ? thisVersion.id : stem
    const otherDevice =
      typeof otherVersion.updatedByDevice === 'string'
        ? otherVersion.updatedByDevice
        : 'Unknown device'
    const otherUpdatedAt = typeof otherVersion.updatedAt === 'string' ? otherVersion.updatedAt : ''

    out.push({
      kind,
      id,
      label: labelFor(kind, thisVersion),
      thisVersion,
      otherVersion,
      otherDevice,
      otherUpdatedAt,
      conflictFilePath: conflictPath,
    })
  }
}

/** Scans every per-item content folder for Dropbox conflict artifacts. Non-recursive per folder
 *  except services, which needs one extra level for its year subfolders — matches the real
 *  on-disk layout each domain module already uses. */
export async function detectConflicts(root: FileSystemDirectoryHandle): Promise<ConflictedItem[]> {
  const out: ConflictedItem[] = []
  await scanDirForConflicts(root, 'songs', 'song', out)
  await scanDirForConflicts(root, 'slides', 'slide', out)
  await scanDirForConflicts(root, 'media-items', 'media', out)
  await scanDirForConflicts(root, 'themes', 'theme', out)
  await scanDirForConflicts(root, 'people', 'person', out)

  for (const yearEntry of await listEntries(root, 'services')) {
    if (yearEntry.kind === 'directory') {
      await scanDirForConflicts(root, joinPath('services', yearEntry.name), 'service', out)
    }
  }
  return out
}

/** `keep: 'theirs'` overwrites the original with the conflicted copy's content; `'mine'` leaves
 *  the original untouched. Either way the conflicted-copy artifact itself is removed afterward,
 *  so it stops appearing in the list — self-clearing, per feature-spec.md's Sync section. */
export async function resolveConflict(
  root: FileSystemDirectoryHandle,
  conflictFilePath: string,
  keep: 'mine' | 'theirs',
): Promise<void> {
  if (keep === 'theirs') {
    const filename = conflictFilePath.split('/').pop() ?? ''
    const match = CONFLICT_PATTERN.exec(filename)
    if (!match?.groups) throw new Error('Not a recognized conflicted-copy filename')
    const { stem, ext = '' } = match.groups
    const dir = conflictFilePath.slice(0, conflictFilePath.length - filename.length)
    const originalPath = joinPath(dir, `${stem}${ext}`)
    const selected = await readJsonFile<unknown>(root, conflictFilePath)
    if (selected === null) throw new Error(`Missing conflict file: ${conflictFilePath}`)
    await writeJsonFile(root, originalPath, selected)
  }
  await removeFile(root, conflictFilePath)
}

/** Per-kind top-level folder → lightweight validity check. See the module doc comment for why
 *  this is an `id`-presence check rather than full model validation. */
function validateLibraryJson(
  relativePath: string,
  text: string,
): { valid: boolean; error?: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : String(error) }
  }

  const topLevel = relativePath.split('/')[0]
  const recordLike =
    topLevel !== undefined &&
    ['songs', 'services', 'slides', 'media-items', 'themes', 'people'].includes(topLevel)
  if (recordLike) {
    const hasId =
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { id?: unknown }).id === 'string'
    if (!hasId) return { valid: false, error: 'Missing or invalid "id" field' }
  }
  // library-settings.json and anything else: valid JSON is enough (no per-kind shape expected).
  return { valid: true }
}

async function scanRecoveryDir(
  root: FileSystemDirectoryHandle,
  relativeDir: string,
  issues: RecoveryIssue[],
): Promise<void> {
  for (const entry of await listEntries(root, relativeDir)) {
    const entryPath = joinPath(relativeDir, entry.name)
    if (entry.kind === 'directory') {
      await scanRecoveryDir(root, entryPath, issues)
      continue
    }
    if (!entry.name.endsWith('.json') || entry.name.endsWith('.backup')) continue

    const text = await readFileText(root, entryPath)
    if (text === null) continue
    const result = validateLibraryJson(entryPath, text)
    if (result.valid) continue

    const backupText = await readFileText(root, backupPath(entryPath))
    const backupAvailable = backupText !== null && validateLibraryJson(entryPath, backupText).valid

    issues.push({
      relativePath: entryPath,
      filePath: entryPath,
      error: result.error ?? 'Invalid JSON',
      backupAvailable,
    })
  }
}

export async function detectRecoveryIssues(
  root: FileSystemDirectoryHandle,
): Promise<RecoveryIssue[]> {
  const issues: RecoveryIssue[] = []
  await scanRecoveryDir(root, '', issues)
  issues.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  return issues
}

function checkedLibraryPath(filePath: string): void {
  if (!filePath.endsWith('.json') || filePath.startsWith('/') || filePath.includes('..')) {
    throw new Error('Recovery is limited to JSON files inside the active library.')
  }
}

export async function recoverFromBackup(
  root: FileSystemDirectoryHandle,
  filePath: string,
): Promise<void> {
  checkedLibraryPath(filePath)
  const backupText = await readFileText(root, backupPath(filePath))
  if (backupText === null) throw new Error(`No backup is available for ${filePath}.`)
  const result = validateLibraryJson(filePath, backupText)
  if (!result.valid) {
    throw new Error(`The backup at ${backupPath(filePath)} is also invalid: ${result.error}`)
  }
  await writeJsonFile(root, filePath, JSON.parse(backupText))
}

export async function quarantineDamagedFile(
  root: FileSystemDirectoryHandle,
  filePath: string,
): Promise<string> {
  checkedLibraryPath(filePath)
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  const quarantinePath = `${filePath}.damaged-${stamp}`
  await renameFile(root, filePath, quarantinePath)
  return quarantinePath
}
