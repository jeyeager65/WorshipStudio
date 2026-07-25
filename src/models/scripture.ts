export interface BibleBookRef {
  name: string
  abbr: string
  /** Verse count per chapter — index 0 is chapter 1. */
  chapters: number[]
}

export interface ScriptureReference {
  book: string
  startChapter: number
  startVerse: number
  endChapter: number
  endVerse: number
}
