// A minimal stand-in for the main app's real getAdapter() (src/adapters/index.ts) — this bundle
// reuses SlideContentRenderer.vue/SlideSceneRenderer.vue directly rather than hand-porting a
// copy, and those two components have exactly two getAdapter() call sites between them
// (media.getPreviewUrl for scene image elements, slides.generateQrCode for scene QR elements).
// Satisfying just those two lets the real components run completely unmodified. Vite's own
// config for this build (vite.remote.config.ts) aliases '@/adapters' to this file, so nothing in
// the reused components needs to change — they still just call `getAdapter()`.
export function getAdapter() {
  return {
    media: {
      async getPreviewUrl(id: string): Promise<string> {
        return `/api/media/${encodeURIComponent(id)}`
      },
    },
    slides: {
      async generateQrCode(text: string): Promise<string> {
        const res = await fetch(`/api/qr?text=${encodeURIComponent(text)}`)
        if (!res.ok) throw new Error('QR generation failed')
        const { dataUrl } = (await res.json()) as { dataUrl: string }
        return dataUrl
      },
    },
  }
}
