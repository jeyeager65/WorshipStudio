/// <reference types="vite/client" />

declare module 'pdfmake/build/pdfmake' {
  import * as pdfMake from 'pdfmake'
  export default pdfMake
}

declare module 'pdfmake/build/vfs_fonts' {
  import type { TVirtualFileSystem } from 'pdfmake/interfaces'
  const vfs: TVirtualFileSystem
  export default vfs
}
