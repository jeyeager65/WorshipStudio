/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/vue" />

// Injected by vite.config.ts's `define` from package.json's version — see AboutSection.vue/
// SplashScreen.vue for why the web/mock builds need this rather than relying solely on Tauri's
// own (Tauri-only) getVersion() API.
declare const __APP_VERSION__: string

declare module 'pdfmake/build/pdfmake' {
  import * as pdfMake from 'pdfmake'
  export default pdfMake
}

declare module 'pdfmake/build/vfs_fonts' {
  import type { TVirtualFileSystem } from 'pdfmake/interfaces'
  const vfs: TVirtualFileSystem
  export default vfs
}
