import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAdapter } from '@/adapters'
import { useAsyncStoreState } from '@/composables/useAsyncStoreState'
import type { Announcement } from '@/models/announcement'

export const useAnnouncementsStore = defineStore('announcements', () => {
  const announcements = ref<Announcement[]>([])
  const asyncState = useAsyncStoreState('announcements')

  async function load() {
    return asyncState.runLoad(async () => {
      announcements.value = await getAdapter().announcements.list()
    })
  }

  async function save(announcement: Announcement) {
    await asyncState.runMutation(() => getAdapter().announcements.save(announcement))
    await load()
  }

  async function remove(id: string) {
    await asyncState.runMutation(() => getAdapter().announcements.delete(id))
    await load()
  }

  return { announcements, ...asyncState, load, save, remove }
})
