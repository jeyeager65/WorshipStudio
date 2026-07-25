<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useTheme } from 'vuetify'
import { useServicesStore } from '@/stores/services'
import ServiceCard from '@/components/ServiceCard.vue'
import logoDark from '@/assets/logo-dark.png'
import logoLight from '@/assets/logo-light.png'

const store = useServicesStore()
const theme = useTheme()
// The dark logo's white wordmark reads fine on the dark theme's near-black background but
// nearly disappears on the light theme's — swap for the light variant (navy wordmark)
// whenever the light theme is active.
const logoSrc = computed(() => (theme.global.current.value.dark ? logoDark : logoLight))

onMounted(() => {
  if (!store.loaded) store.load()
})

const tab = ref<'home' | 'browse'>('home')
const browseQuery = ref('')

const todayIso = () => new Date().toISOString().slice(0, 10)

const todayService = computed(() => store.services.find((service) => service.date === todayIso()))

const upcomingServices = computed(() =>
  store.services
    .filter((service) => service.date > todayIso())
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5),
)

const pastServices = computed(() =>
  store.services.filter((service) => service.date < todayIso()).sort((a, b) => b.date.localeCompare(a.date)),
)

const browseResults = computed(() => {
  const query = browseQuery.value.trim().toLowerCase()
  if (!query) return pastServices.value.slice(0, 10)
  return store.services.filter((service) =>
    [service.type, service.sermonTitle, service.preacher, service.keyPassage].some((field) =>
      field?.toLowerCase().includes(query),
    ),
  )
})
</script>

<template>
  <v-container class="py-8" style="max-width: 720px">
    <div class="text-center mb-6">
      <img :src="logoSrc" alt="Worship Studio" class="landing-logo mb-4" />
      <p class="text-medium-emphasis">Select a service to continue, or create a new one</p>
    </div>

    <v-tabs v-model="tab" class="mb-6">
      <v-tab value="home">Home</v-tab>
      <v-tab value="browse">Browse</v-tab>
    </v-tabs>

    <v-window v-model="tab">
      <v-window-item value="home" class="pt-2">
        <template v-if="todayService">
          <div class="text-overline text-medium-emphasis mb-2">Today</div>
          <ServiceCard :service="todayService" badge="TODAY" />
        </template>

        <div class="text-overline text-medium-emphasis mt-6 mb-2">Upcoming</div>
        <ServiceCard v-for="service in upcomingServices" :key="service.id" :service="service" />
        <p v-if="upcomingServices.length === 0" class="text-medium-emphasis text-body-2">No upcoming services yet.</p>

        <v-btn variant="flat" color="primary" size="large" block class="mt-6" prepend-icon="mdi-plus" to="/create-service">
          Create New Service
        </v-btn>
      </v-window-item>

      <v-window-item value="browse" class="pt-2">
        <v-text-field
          v-model="browseQuery"
          prepend-inner-icon="mdi-magnify"
          label="Search all services…"
          variant="outlined"
          density="comfortable"
          class="mb-6"
          clearable
        />
        <div class="text-overline text-medium-emphasis mb-2">{{ browseQuery ? 'Results' : 'Recent' }}</div>
        <ServiceCard v-for="service in browseResults" :key="service.id" :service="service" />
        <p v-if="browseResults.length === 0" class="text-medium-emphasis text-body-2">No services found.</p>
      </v-window-item>
    </v-window>
  </v-container>
</template>

<style scoped>
.landing-logo {
  height: 100px;
  width: auto;
}
</style>
