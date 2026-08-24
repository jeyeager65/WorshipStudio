/** Same extensions Tauri's native dialog filter restricts its picker to
 *  (adapters/tauri/index.ts's pickFilesToImport) — kept in sync manually since one side is a
 *  Rust-facing dialog filter and the other an HTML `accept` attribute, not something a shared
 *  constant could span across the Rust/TS boundary. Used as the default when a caller doesn't
 *  pass its own `extensions` (e.g. External App Hand-off importing a document instead of media —
 *  see MediaPort.pickFilesToImport's own doc comment). An explicitly *empty* `extensions` array
 *  (as opposed to omitting the argument) means no restriction at all, same distinction the Tauri
 *  adapter's own picker makes. */
const ACCEPTED_MEDIA_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov', 'webm', 'm4v']

function hasAcceptedExtension(filename: string, extensions: string[]): boolean {
  if (extensions.length === 0) return true
  const ext = filename.split('.').pop()?.toLowerCase()
  return !!ext && extensions.includes(ext)
}

/** Browser-native multi-file picker — the demo/mock adapter's equivalent of Tauri's dialog
 *  plugin's own filtered picker. `accept` narrows what the OS file dialog shows/allows, mirroring
 *  Tauri's `filters`, but some browsers/OSes still let a user override it to "All Files" — the
 *  post-selection filter below is what actually enforces it, same end result as Tauri's dialog
 *  simply never surfacing a non-matching file to select in the first place. An empty `accept`
 *  (when `extensions` resolves to `[]`) imposes no restriction, same as leaving Tauri's `filters`
 *  unset. */
export function pickFilesInBrowser(extensions: string[] = ACCEPTED_MEDIA_EXTENSIONS): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = extensions.map((ext) => `.${ext}`).join(',')
    input.style.display = 'none'
    input.addEventListener(
      'change',
      () => {
        const files = input.files ? Array.from(input.files) : []
        resolve(files.filter((file) => hasAcceptedExtension(file.name, extensions)))
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
