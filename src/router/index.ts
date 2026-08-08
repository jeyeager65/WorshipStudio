import { createRouter, createWebHashHistory } from 'vue-router'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import { useLiveSessionStore } from '@/stores/liveSession'
import { useUnsavedChangesStore } from '@/stores/unsavedChanges'

declare module 'vue-router' {
  interface RouteMeta {
    /** Shown in the app-bar (see App.vue) for top-level pages reachable from the sidebar —
     *  deeper/detail pages render their own in-content heading instead and leave this unset. */
    title?: string
  }
}

const router = createRouter({
  // Hash-based, not real browser history — the GitHub Pages static demo has no server-side
  // rewrite for a client-routed path, so a direct/shared/refreshed link like
  // /service/xxx/bulletin 404s at the host before Vue Router ever gets a chance to handle it.
  // Everything after the `#` never reaches the server as part of the request, so this works on
  // any static host with zero server config, at the cost of a `#` in the URL — a no-op for the
  // desktop app itself, which has no use for clean URLs (no SEO, no external links).
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'landing',
      component: () => import('@/views/LandingView.vue'),
      meta: { title: 'Services' },
    },
    {
      path: '/setup',
      name: 'setup-wizard',
      component: () => import('@/views/SetupWizardView.vue'),
    },
    {
      path: '/create-service',
      name: 'create-service',
      component: () => import('@/views/CreateServiceView.vue'),
    },
    {
      path: '/service/:id',
      name: 'service-workspace',
      component: () => import('@/views/ServiceWorkspaceView.vue'),
    },
    {
      path: '/service/:id/assignments',
      name: 'service-assignments',
      component: () => import('@/views/AssignmentsView.vue'),
    },
    {
      path: '/service/:id/bulletin',
      name: 'service-bulletin',
      component: () => import('@/views/BulletinView.vue'),
    },
    {
      path: '/service/:id/order-of-worship',
      name: 'order-of-worship',
      redirect: (to) => ({ name: 'service-bulletin', params: { id: to.params.id as string } }),
    },
    {
      path: '/library/songs',
      name: 'song-library',
      component: () => import('@/views/SongLibraryView.vue'),
      meta: { title: 'Songs' },
    },
    {
      path: '/library/songs/:id',
      name: 'song-editor',
      component: () => import('@/views/SongEditorView.vue'),
    },
    {
      path: '/library/slides',
      name: 'slide-library',
      component: () => import('@/views/SlideLibraryView.vue'),
      meta: { title: 'Slides' },
    },
    {
      path: '/library/slides/:id',
      name: 'slide-editor',
      component: () => import('@/views/SlideEditorView.vue'),
    },
    {
      path: '/library/media',
      name: 'media-library',
      component: () => import('@/views/MediaLibraryView.vue'),
      meta: { title: 'Media' },
    },
    {
      path: '/library/themes',
      name: 'theme-library',
      component: () => import('@/views/ThemeLibraryView.vue'),
      meta: { title: 'Presentation Themes' },
    },
    {
      path: '/library/themes/:id',
      name: 'theme-editor',
      component: () => import('@/views/ThemeEditorView.vue'),
    },
    {
      path: '/people',
      name: 'people',
      component: () => import('@/views/PeopleView.vue'),
      meta: { title: 'People' },
    },
    {
      path: '/people/:id',
      name: 'person-editor',
      component: () => import('@/views/PersonEditorView.vue'),
    },
    {
      path: '/roles',
      name: 'roles',
      component: () => import('@/views/RolesView.vue'),
      meta: { title: 'Roles' },
    },
    {
      path: '/announcements',
      name: 'announcements',
      component: () => import('@/views/AnnouncementsView.vue'),
      meta: { title: 'Announcements' },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/SettingsView.vue'),
      meta: { title: 'Settings' },
    },
    {
      path: '/library/service-templates',
      name: 'service-template-library',
      component: () => import('@/views/ServiceTemplateLibraryView.vue'),
      meta: { title: 'Service Templates' },
    },
    {
      path: '/library/service-templates/new',
      name: 'service-template-new',
      component: () => import('@/views/ServiceTemplateEditorView.vue'),
    },
    {
      path: '/library/service-templates/edit/:templateName',
      name: 'service-template-editor',
      component: () => import('@/views/ServiceTemplateEditorView.vue'),
    },
    {
      path: '/sync-conflicts',
      name: 'sync-conflicts',
      component: () => import('@/views/SyncConflictsView.vue'),
      meta: { title: 'Library Health' },
    },
    {
      path: '/reports',
      name: 'reports-home',
      component: () => import('@/views/ReportsHomeView.vue'),
      meta: { title: 'Reports' },
    },
    {
      path: '/reports/song-usage',
      name: 'song-usage-report',
      component: () => import('@/views/CcliReportView.vue'),
    },
    { path: '/reports/ccli', redirect: '/reports/song-usage' },
    {
      path: '/reports/planning',
      name: 'planning-report',
      component: () => import('@/views/PlanningReportView.vue'),
    },
    {
      path: '/planning-ahead',
      name: 'planning-ahead',
      component: () => import('@/views/PlanningAheadView.vue'),
    },
    {
      path: '/planning-ahead/:serviceId',
      name: 'service-plan',
      component: () => import('@/views/ServicePlanView.vue'),
    },
  ],
})

/**
 * Pure decision logic, exported separately so it's testable without simulating a live
 * navigation. Leaving the workspace mid-presentation would blank the audience display
 * unexpectedly, so it's blocked — but only actually leaving the workspace (not moving
 * around within it) and only while presenting.
 */
export function shouldBlockLeavingWorkspace(
  fromName: unknown,
  toName: unknown,
  isPresenting: boolean,
): boolean {
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

/**
 * Pure decision logic for the unsaved-changes prompt, same testability reasoning as
 * shouldBlockLeavingWorkspace above.
 */
export function shouldConfirmUnsavedChanges(
  fromPath: string,
  toPath: string,
  isDirty: boolean,
): boolean {
  return isDirty && fromPath !== toPath
}

// Song Editor and the workspace's arrangement/notes editing use an explicit Save button
// rather than auto-save (see stores/unsavedChanges.ts) — offer to save before leaving rather
// than just a discard-or-stay choice, since "leave without saving" was never actually what
// most people meant to pick here.
router.beforeEach(async (to, from) => {
  const unsavedChanges = useUnsavedChangesStore()
  if (!shouldConfirmUnsavedChanges(from.path, to.path, unsavedChanges.isDirty)) return true
  const result = await useConfirmDialogStore().confirmWithSave(
    'You have unsaved changes. Save before leaving?',
    'Leave Without Saving',
    'Save & Leave',
  )
  if (result === 'cancel') return false
  if (result === 'save') await unsavedChanges.saveHandler?.()
  unsavedChanges.isDirty = false
  return true
})

export default router
