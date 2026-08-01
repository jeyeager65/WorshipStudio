import { describe, expect, it } from 'vitest'
import { diagnosticBundleFilename, formatDiagnosticSummary } from '@/utils/diagnostics'

describe('diagnostics helpers', () => {
  it('formats only the allowlisted diagnostic fields', () => {
    const text = formatDiagnosticSummary({
      generatedAt: '2026-08-01T12:00:00Z',
      appVersion: '0.5.0',
      buildProfile: 'release',
      platform: 'windows',
      architecture: 'x86_64',
      installationMode: 'portable',
      setupComplete: true,
      libraryReadable: true,
      libraryItems: { songs: 10, services: 4, slides: 3, media: 8, themes: 2, people: 12 },
      syncConflictCount: 1,
      recoveryIssueCount: 0,
      displayAssignmentCount: 2,
      remotePortMode: 'automatic',
      lastRemotePort: 47820,
      canvaCallbackPort: 47824,
      logFileCount: 2,
      logBytes: 4096,
    })

    expect(text).toContain('Version: 0.5.0')
    expect(text).toContain('Installation: portable')
    expect(text).toContain('4 services, 10 songs')
    expect(text).toContain('Remote Control port: automatic (47820)')
    expect(text).not.toContain('token')
    expect(text).not.toContain('libraryPath')
  })

  it('creates a stable timestamped JSON filename', () => {
    expect(diagnosticBundleFilename(new Date('2026-08-01T12:34:56.789Z'))).toBe(
      'worship-studio-diagnostics-20260801T123456Z.json',
    )
  })
})
