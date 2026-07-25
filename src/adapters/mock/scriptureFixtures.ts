/**
 * Sample public-domain (KJV) verse text for a handful of well-known passages — enough to
 * demo real reference resolution (auto-fit, live display, Next/Prev through verses)
 * without bundling/importing an entire Bible translation. Real translation import (spec
 * section 1, "local-file import") is a later slice; until then, resolve() falls back to a
 * "not available in demo build" error for anything outside this set.
 */
export interface AvailableTranslation {
  code: string
  name: string
}

export const availableTranslations: AvailableTranslation[] = [{ code: 'KJV', name: 'King James Version' }]

type VersesByChapter = Record<number, Record<number, string>>

export const kjvSample: Record<string, VersesByChapter> = {
  John: {
    3: {
      16: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.',
      17: 'For God sent not his Son into the world to condemn the world; but that the world through him might be saved.',
    },
  },
  Matthew: {
    6: {
      9: 'After this manner therefore pray ye: Our Father which art in heaven, Hallowed be thy name.',
      10: 'Thy kingdom come, Thy will be done in earth, as it is in heaven.',
      11: 'Give us this day our daily bread.',
      12: 'And forgive us our debts, as we forgive our debtors.',
      13: 'And lead us not into temptation, but deliver us from evil: For thine is the kingdom, and the power, and the glory, for ever. Amen.',
    },
  },
  Psalm: {
    23: {
      1: 'The LORD is my shepherd; I shall not want.',
      2: 'He maketh me to lie down in green pastures: he leadeth me beside the still waters.',
      3: "He restoreth my soul: he leadeth me in the paths of righteousness for his name's sake.",
      4: 'Yea, though I walk through the valley of the shadow of death, I will fear no evil: for thou art with me; thy rod and thy staff they comfort me.',
      5: 'Thou preparest a table before me in the presence of mine enemies: thou anointest my head with oil; my cup runneth over.',
      6: 'Surely goodness and mercy shall follow me all the days of my life: and I will dwell in the house of the LORD for ever.',
    },
  },
}
