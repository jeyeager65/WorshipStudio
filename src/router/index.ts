import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'landing', component: () => import('@/views/LandingView.vue') },
    { path: '/service/:id', name: 'service-workspace', component: () => import('@/views/ServiceWorkspaceView.vue') },
    { path: '/library/songs', name: 'song-library', component: () => import('@/views/SongLibraryView.vue') },
    { path: '/settings', name: 'settings', component: () => import('@/views/SettingsView.vue') },
  ],
})

export default router
