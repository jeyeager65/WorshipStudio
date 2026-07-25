/** Browser-native multi-file picker — the demo/mock adapter's equivalent of Tauri's dialog plugin. */
export function pickFilesInBrowser(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.style.display = 'none'
    input.addEventListener(
      'change',
      () => {
        resolve(input.files ? Array.from(input.files) : [])
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
