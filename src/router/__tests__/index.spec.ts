import { describe, expect, it } from 'vitest'
import { shouldBlockLeavingWorkspace, shouldConfirmUnsavedChanges } from '@/router'

describe('shouldBlockLeavingWorkspace', () => {
  it('blocks leaving the workspace while presenting', () => {
    expect(shouldBlockLeavingWorkspace('service-workspace', 'landing', true)).toBe(true)
  })

  it('allows leaving the workspace when not presenting', () => {
    expect(shouldBlockLeavingWorkspace('service-workspace', 'landing', false)).toBe(false)
  })

  it('allows navigating between two workspace instances (switching services) even while presenting', () => {
    // Same route name for both — e.g. /service/a -> /service/b — is still "service-workspace"
    // to "service-workspace"; this is a same-screen transition, not leaving the workspace.
    expect(shouldBlockLeavingWorkspace('service-workspace', 'service-workspace', true)).toBe(false)
  })

  it('does not block navigation that never touched the workspace', () => {
    expect(shouldBlockLeavingWorkspace('song-library', 'landing', true)).toBe(false)
  })

  it('does not block when not presenting, regardless of origin', () => {
    expect(shouldBlockLeavingWorkspace('song-library', 'service-workspace', false)).toBe(false)
  })
})

describe('shouldConfirmUnsavedChanges', () => {
  it('confirms when navigating to a different path with unsaved changes', () => {
    expect(shouldConfirmUnsavedChanges('/library/songs/a', '/library/songs', true)).toBe(true)
  })

  it('does not confirm when there are no unsaved changes', () => {
    expect(shouldConfirmUnsavedChanges('/library/songs/a', '/library/songs', false)).toBe(false)
  })

  it('does not confirm for a same-path navigation (e.g. a no-op link click)', () => {
    expect(shouldConfirmUnsavedChanges('/library/songs/a', '/library/songs/a', true)).toBe(false)
  })
})
