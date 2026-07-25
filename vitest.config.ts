import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      exclude: [...configDefaults.exclude, 'e2e/**'],
      root: fileURLToPath(new URL('./', import.meta.url)),
      server: {
        // Vuetify components import their own .css as a side effect; Vitest externalizes
        // node_modules from its transform pipeline by default, which hits Node's raw
        // `require` on those .css files instead of Vite's CSS loader. Inlining it routes
        // those imports through Vite's transform instead.
        deps: {
          inline: ['vuetify'],
        },
      },
    },
  }),
)
