import { createRouter, createWebHistory } from 'vue-router'
import { useLiveSessionStore } from '@/stores/liveSession'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'landing', component: () => import('@/views/LandingView.vue') },
    { path: '/create-service', name: 'create-service', component: () => import('@/views/CreateServiceView.vue') },
    { path: '/service/:id', name: 'service-workspace', component: () => import('@/views/ServiceWorkspaceView.vue') },
    { path: '/library/songs', name: 'song-library', component: () => import('@/views/SongLibraryView.vue') },
    { path: '/library/songs/:id', name: 'song-editor', component: () => import('@/views/SongEditorView.vue') },
    { path: '/settings', name: 'settings', component: () => import('@/views/SettingsView.vue') },
  ],
})

/**
 * Pure decision logic, exported separately so it's testable without simulating a live
 * navigation. Leaving the workspace mid-presentation would blank the audience display
 * unexpectedly, so it's blocked — but only actually leaving the workspace (not moving
 * around within it) and only while presenting.
 */
export function shouldBlockLeavingWorkspace(fromName: unknown, toName: unknown, isPresenting: boolean): boolean {
  if (fromName !== 'service-workspace' || toName === 'service-workspace') return false
  return isPresenting
}

// The operator should always be able to get back to Home — except mid-presentation (see
// shouldBlockLeavingWorkspace above). Global guard rather than only disabling the header's
// Home button, so it also catches browser back/forward and any other link away from the
// workspace, not just that one button.
router.beforeEach((to, from) => {
  const liveSession = useLiveSessionStore()
  if (shouldBlockLeavingWorkspace(from.name, to.name, liveSession.isPresenting)) {
    liveSession.blockedMessage = 'Stop presenting before leaving this screen.'
    return false
  }
  return true
})

export default router
