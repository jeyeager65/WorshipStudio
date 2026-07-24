import type { Arrangement, SongBlock } from './song'

export type ServiceItemContent =
  | { type: 'song'; songId: string; arrangement: Arrangement }
  | {
      type: 'scripture'
      reference: string
      translation: string
      displayMode: 'full' | 'reference-only'
    }
  | { type: 'slide-ref'; slideId: string }
  /** Ad hoc, service-only slides (e.g. sermon notes) — never saved to the Slide Library. */
  | { type: 'text-slide'; slides: SongBlock[] }
  | { type: 'media'; mediaId: string; fit: 'cover' | 'contain' }
  | { type: 'video'; mediaId: string }
  | { type: 'audio'; mediaId: string }
  | { type: 'external-app'; profileId: string; file?: string }
  | { type: 'countdown'; targetTime: string; text?: string }
  | { type: 'qr'; url: string; caption?: string }

export type ServiceItem = ServiceItemContent & {
  id: string
  /** Who's doing this part (Elder leading prayer, scripture reader, etc.) — distinct from the service-level preacher. */
  person?: string
}

export interface RoleAssignment {
  role: string
  volunteerId?: string
  tentative: boolean
}

export interface Service {
  id: string
  date: string
  type: string
  preacher?: string
  sermonTitle?: string
  keyPassage?: string
  items: ServiceItem[]
  /** Operator-only notes, keyed by service item id. */
  presenterNotes?: Record<string, string>
  volunteerRoster?: RoleAssignment[]
  updatedAt: string
  updatedByDevice: string
}
