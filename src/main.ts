import { createApp } from 'vue'
import { createPinia } from 'pinia'

import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/montserrat/wght.css'
import '@fontsource-variable/oswald/wght.css'
import '@fontsource-variable/roboto-slab/wght.css'
import '@fontsource-variable/source-sans-3/wght.css'
import '@fontsource-variable/source-serif-4/wght.css'

import './assets/base.css'
import App from './App.vue'
import router from './router'
import vuetify from './plugins/vuetify'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(vuetify)

app.mount('#app')
