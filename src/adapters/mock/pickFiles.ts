/** Same extensions Tauri's native dialog filter restricts its picker to
 *  (adapters/tauri/index.ts's pickFilesToImport) — kept in sync manually since one side is a
 *  Rust-facing dialog filter and the other an HTML `accept` attribute, not something a shared
 *  constant could span across the Rust/TS boundary. */
const ACCEPTED_MEDIA_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov', 'webm', 'm4v']

function hasAcceptedExtension(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase()
  return !!ext && ACCEPTED_MEDIA_EXTENSIONS.includes(ext)
}

/** Browser-native multi-file picker — the demo/mock adapter's equivalent of Tauri's dialog
 *  plugin's own filtered picker. `accept` narrows what the OS file dialog shows/allows, mirroring
 *  Tauri's `filters`, but some browsers/OSes still let a user override it to "All Files" — the
 *  post-selection filter below is what actually enforces it, same end result as Tauri's dialog
 *  simply never surfacing a non-matching file to select in the first place. */
export function pickFilesInBrowser(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = ACCEPTED_MEDIA_EXTENSIONS.map((ext) => `.${ext}`).join(',')
    input.style.display = 'none'
    input.addEventListener(
      'change',
      () => {
        const files = input.files ? Array.from(input.files) : []
        resolve(files.filter((file) => hasAcceptedExtension(file.name)))
        input.remove()
      },
      { once: true },
    )
    // No native "cancel" event on <input type=file>; if the picker is dismissed without a
    // selection, the change listener above never fires and the promise simply never resolves
    // for that call — acceptable for this v1 (the caller is a manual "Import" button click,
    // not a flow anything else is blocked on).
    document.body.appendChild(input)
    input.click()
  })
}
