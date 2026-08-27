import type { TSESLint } from '@typescript-eslint/utils'
import pluginVue from 'eslint-plugin-vue'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'

const config: TSESLint.FlatConfig.Config[] = defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{ts,mts,tsx,vue}'],
  },
  {
    name: 'app/files-to-ignore',
    // '**/pages/**' is the combined static site scripts/build-pages.mjs assembles (help site +
    // app) for the hosting provider — build output like the dist folders above, and linting the
    // minified bundles in it fails on the minifier's own variable names.
    ignores: [
      '**/dist/**',
      '**/dist-ssr/**',
      '**/dist-remote/**',
      '**/pages/**',
      '**/coverage/**',
      '**/src-tauri/**',
    ],
  },
  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,
  skipFormatting,
)

export default config
