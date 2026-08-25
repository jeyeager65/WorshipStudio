import type { MediaItem } from '@/models/library'
import type { ExternalAppProfile } from '@/adapters/types'

/** Extension -> icon for the kinds of file that actually reach this library. Deliberately not
 *  exhaustive: anything unlisted falls back to the generic document glyph, which is no worse than
 *  what every document showed before. */
const ICON_BY_EXTENSION: Record<string, string> = {
  pdf: 'mdi-file-pdf-box',

  ppt: 'mdi-file-powerpoint-outline',
  pptx: 'mdi-file-powerpoint-outline',
  pps: 'mdi-file-powerpoint-outline',
  ppsx: 'mdi-file-powerpoint-outline',
  odp: 'mdi-file-powerpoint-outline',

  doc: 'mdi-file-word-outline',
  docx: 'mdi-file-word-outline',
  odt: 'mdi-file-word-outline',
  rtf: 'mdi-file-word-outline',

  xls: 'mdi-file-excel-outline',
  xlsx: 'mdi-file-excel-outline',
  csv: 'mdi-file-excel-outline',
  ods: 'mdi-file-excel-outline',

  mp3: 'mdi-file-music-outline',
  wav: 'mdi-file-music-outline',
  m4a: 'mdi-file-music-outline',
  aac: 'mdi-file-music-outline',
  flac: 'mdi-file-music-outline',
  ogg: 'mdi-file-music-outline',
}

export const GENERIC_DOCUMENT_ICON = 'mdi-file-document-outline'

/** The icon standing in for a media file wherever its own contents can't be shown — a document,
 *  or an image/video whose preview hasn't resolved (a missing file, or one still loading).
 *
 *  Images and videos keep their category glyph, since the thumbnail is the real identifier and
 *  the placeholder only appears while it's absent. Documents get one derived from the extension,
 *  because for them the icon *is* the identifier: `kind` alone only ever says "document", which
 *  rendered a PowerPoint deck, a PDF and a spreadsheet identically. */
export function mediaFileIcon(
  filename: string | undefined,
  kind: MediaItem['kind'],
  /** Optional. Lets a file type this list doesn't know still get a meaningful icon when the
   *  operator has configured an External App that claims its extension. */
  externalAppProfiles: ExternalAppProfile[] = [],
): string {
  if (kind === 'video') return 'mdi-movie-open-outline'
  if (kind === 'image') return 'mdi-image-outline'

  // Guarding on a trailing dot and on a name that is only an extension (".gitignore") — both
  // would otherwise "match" as an empty or whole-name extension.
  const parts = (filename ?? '').toLowerCase().split('.')
  const extension = parts.length > 1 ? (parts.pop() ?? '') : ''
  if (!extension) return GENERIC_DOCUMENT_ICON

  // Extension first, External App profile second, and in that order on purpose. A profile's
  // `kind` has only three values, so a PDF, a spreadsheet and a Word document configured for
  // hand-off would all come back "custom" and share one icon — coarser than the extension
  // already tells us. The profile earns its place on the file types this list has never heard
  // of, where it's the only thing that knows anything at all.
  const byExtension = ICON_BY_EXTENSION[extension]
  if (byExtension) return byExtension

  const claimed = externalAppProfiles.find((profile) =>
    profile.allowedExtensions?.some(
      (allowed) => allowed.toLowerCase().replace(/^\./, '') === extension,
    ),
  )
  if (claimed?.kind === 'presentation') return 'mdi-presentation'
  if (claimed?.kind === 'video') return 'mdi-movie-open-outline'
  if (claimed) return 'mdi-application-outline'

  return GENERIC_DOCUMENT_ICON
}
