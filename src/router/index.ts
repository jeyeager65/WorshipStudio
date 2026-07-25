import { createRouter, createWebHistory } from 'vue-router'

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

export default router
