import type { DiagnosticSummary } from '@/adapters/types'

export function formatDiagnosticSummary(summary: DiagnosticSummary): string {
  const items = summary.libraryItems
  return [
    'Worship Studio Diagnostic Summary',
    `Generated: ${summary.generatedAt}`,
    '',
    `Version: ${summary.appVersion}`,
    `Build: ${summary.buildProfile}`,
    `Platform: ${summary.platform} (${summary.architecture})`,
    `Installation: ${summary.installationMode}`,
    `Setup complete: ${summary.setupComplete ? 'yes' : 'no'}`,
    '',
    `Library readable: ${summary.libraryReadable ? 'yes' : 'no'}`,
    `Library items: ${items.services} services, ${items.songs} songs, ${items.slides} slides, ${items.media} media items, ${items.themes} themes, ${items.people} people`,
    `Last library change: ${summary.lastLibraryChangeAt ?? 'unavailable'}`,
    `Sync conflicts: ${summary.syncConflictCount}`,
    `Recovery issues: ${summary.recoveryIssueCount}`,
    '',
    `Display assignments: ${summary.displayAssignmentCount}`,
    `Remote Control port: ${summary.remotePortMode}${summary.lastRemotePort ? ` (${summary.lastRemotePort})` : ''}`,
    `Canva callback port: ${summary.canvaCallbackPort ?? 'unavailable'}`,
    `Log files: ${summary.logFileCount} (${summary.logBytes} bytes)`,
  ].join('\n')
}

export function diagnosticBundleFilename(generatedAt = new Date()): string {
  const stamp = generatedAt
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
  return `worship-studio-diagnostics-${stamp}.json`
}
