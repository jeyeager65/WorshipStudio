import { describe, expect, it } from 'vitest'
import { pickFilesInBrowser } from '../pickFiles'

// jsdom doesn't implement DataTransfer, so a real FileList can't be constructed — the code
// under test only ever does Array.from(input.files), which a plain array satisfies just as well.
function makeFileList(files: File[]): FileList {
  return files as unknown as FileList
}

describe('pickFilesInBrowser', () => {
  it('restricts the native picker to the same image/video extensions Tauri filters to', () => {
    void pickFilesInBrowser()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.accept).toBe('.jpg,.jpeg,.png,.gif,.webp,.mp4,.mov,.webm,.m4v')
    input.remove()
  })

  it('resolves only files with an accepted extension, silently dropping the rest', async () => {
    const resultPromise = pickFilesInBrowser()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const files = [
      new File(['a'], 'photo.jpg'),
      new File(['b'], 'notes.pdf'),
      new File(['c'], 'clip.MP4'),
    ]
    Object.defineProperty(input, 'files', { value: makeFileList(files), configurable: true })
    input.dispatchEvent(new Event('change'))

    const result = await resultPromise
    expect(result.map((f) => f.name)).toEqual(['photo.jpg', 'clip.MP4'])
  })

  it('restricts to a caller-supplied extension list instead, e.g. for an External App profile', () => {
    void pickFilesInBrowser(['pptx', 'ppt'])
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.accept).toBe('.pptx,.ppt')
    input.remove()
  })

  it('imposes no restriction at all when given an explicitly empty extension list', async () => {
    const resultPromise = pickFilesInBrowser([])
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.accept).toBe('')
    const files = [new File(['a'], 'deck.pptx'), new File(['b'], 'notes.pdf')]
    Object.defineProperty(input, 'files', { value: makeFileList(files), configurable: true })
    input.dispatchEvent(new Event('change'))

    const result = await resultPromise
    expect(result.map((f) => f.name)).toEqual(['deck.pptx', 'notes.pdf'])
  })
})
