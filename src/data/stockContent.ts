import type { PresentationThemeTarget } from '@/models/library'

/** One of the 6 stock background images bundled with the app (see
 *  scripts/optimize-stock-backgrounds.mjs, which produces the matching .webp files under
 *  public/stock-backgrounds/ for the web build and src-tauri/resources/stock-backgrounds/ for
 *  the desktop bundle). Kept in sync by hand with the parallel list in
 *  src-tauri/src/domain/stock_content.rs — see plans/snoopy-wishing-cocke.md for why this isn't
 *  a shared generated manifest. */
export interface StockBackground {
  id: string
  filename: string
  title: string
}

export const stockBackgrounds: StockBackground[] = [
  {
    id: 'media-stock-golden-cross-over-misty-mountains',
    filename: 'golden-cross-over-misty-mountains.webp',
    title: 'Golden Cross Over Misty Mountains',
  },
  {
    id: 'media-stock-golden-mist-over-the-lake',
    filename: 'golden-mist-over-the-lake.webp',
    title: 'Golden Mist Over the Lake',
  },
  {
    id: 'media-stock-golden-sunrise-reading-vista',
    filename: 'golden-sunrise-reading-vista.webp',
    title: 'Golden Sunrise Reading Vista',
  },
  {
    id: 'media-stock-misty-lake-at-dawn',
    filename: 'misty-lake-at-dawn.webp',
    title: 'Misty Lake at Dawn',
  },
  {
    id: 'media-stock-misty-meadow-at-sunrise',
    filename: 'misty-meadow-at-sunrise.webp',
    title: 'Misty Meadow at Sunrise',
  },
  {
    id: 'media-stock-misty-woodland-creek',
    filename: 'misty-woodland-creek.webp',
    title: 'Misty Woodland Creek',
  },
]

/** One of the 2 starter themes backed by a stock background. `intendedDefaults` are claimed as
 *  this theme's `useAsDefaultFor` only if no existing theme already claims that target — see
 *  the mock adapter's `media.importStockBackgrounds()`. */
export interface StockTheme {
  id: string
  name: string
  backgroundMediaId: string
  font: string
  textColor: string
  intendedDefaults: PresentationThemeTarget[]
}

export const stockThemes: StockTheme[] = [
  {
    id: 'theme-stock-golden-cross',
    name: 'Golden Cross',
    backgroundMediaId: 'media-stock-golden-cross-over-misty-mountains',
    font: 'Montserrat',
    textColor: '#FFFFFF',
    intendedDefaults: ['songs', 'scripture', 'sermon'],
  },
  {
    id: 'theme-stock-misty-dawn',
    name: 'Misty Dawn',
    backgroundMediaId: 'media-stock-misty-lake-at-dawn',
    font: 'Montserrat',
    textColor: '#FFFFFF',
    intendedDefaults: ['text-slides'],
  },
]
