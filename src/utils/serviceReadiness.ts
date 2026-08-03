import type { ExternalAppProfile } from '@/adapters/types'
import type { MediaItem, Person, SlideLibraryItem, Theme } from '@/models/library'
import type { Service, ServiceItem } from '@/models/service'
import type { Song } from '@/models/song'
import { personDisplayName } from '@/models/library'
import { findRoleConflicts, isDateUnavailable } from '@/utils/rosterConflicts'
import {
  presentationThemeTargetForItem,
  resolvePresentationTheme,
} from '@/utils/presentationTheme'

export type ReadinessSeverity = 'blocker' | 'warning'
export type ReadinessAction = 'service-item' | 'assignments' | 'display' | 'library-health'

export interface ReadinessIssue {
  id: string
  severity: ReadinessSeverity
  title: string
  detail: string
  action: ReadinessAction
  itemId?: string
}

export interface ServiceReadinessContext {
  songs: Map<string, Song>
  slides: Map<string, SlideLibraryItem>
  media: Map<string, MediaItem>
  themes: Theme[]
  people: Map<string, Person>
  externalApps: Map<string, ExternalAppProfile>
  resolvedScriptureKeys: Set<string>
  scriptureErrorKeys: Set<string>
  resolvedMediaIds: Set<string>
  mediaErrorIds: Set<string>
  mediaAvailabilityChecked: boolean
  verifiedExternalAppItemIds: Set<string>
  externalAppErrors: Map<string, string>
  externalAppVerificationAvailable: boolean
  libraryConflictLabels: Map<string, string>
  audienceDisplayAvailable: boolean
}

export interface ServiceReadinessResult {
  issues: ReadinessIssue[]
  blockers: ReadinessIssue[]
  warnings: ReadinessIssue[]
  ready: boolean
}

function serviceItemLabel(item: ServiceItem, context: ServiceReadinessContext): string {
  if (item.type === 'song') return context.songs.get(item.songId)?.title ?? 'Song'
  if (item.type === 'slide-ref') return context.slides.get(item.slideId)?.label ?? 'Presentation'
  if (item.type === 'media' || item.type === 'video' || item.type === 'audio')
    return context.media.get(item.mediaId)?.title ?? 'Media'
  if (item.type === 'scripture') return item.reference || 'Scripture'
  if (item.type === 'sermon') return item.title || 'Sermon'
  if (item.type === 'placeholder') return item.label || 'Placeholder'
  if (item.type === 'external-app')
    return context.externalApps.get(item.profileId)?.name ?? 'External application'
  if (item.type === 'text-slide') return 'Text slides'
  return item.bulletinLabel || item.type
}

function sceneMediaIds(slideItem: SlideLibraryItem): Set<string> {
  const ids = new Set<string>()
  for (const slide of slideItem.slides) {
    if (slide.source.type === 'canva') ids.add(slide.source.renderedMediaId)
    if (slide.scene.background.mediaId) ids.add(slide.scene.background.mediaId)
    for (const element of slide.scene.elements) {
      if (element.type === 'image') ids.add(element.mediaId)
    }
  }
  return ids
}

export function evaluateServiceReadiness(
  service: Service,
  context: ServiceReadinessContext,
): ServiceReadinessResult {
  const issues: ReadinessIssue[] = []
  const reportedConflicts = new Set<string>()

  function add(
    severity: ReadinessSeverity,
    code: string,
    title: string,
    detail: string,
    action: ReadinessAction,
    itemId?: string,
  ) {
    issues.push({
      id: `${code}:${itemId ?? action}:${issues.length}`,
      severity,
      title,
      detail,
      action,
      itemId,
    })
  }

  function checkMedia(mediaId: string, label: string, itemId: string) {
    checkLibraryConflict('media', mediaId, itemId)
    const media = context.media.get(mediaId)
    if (!media) {
      add('blocker', 'missing-media', `${label} is missing`, 'Choose an available media item.', 'service-item', itemId)
      return
    }
    if (context.mediaErrorIds.has(mediaId)) {
      add(
        'blocker',
        'unavailable-media',
        `${media.title} is unavailable`,
        'The media record exists, but its file could not be opened on this computer.',
        'service-item',
        itemId,
      )
    } else if (
      context.mediaAvailabilityChecked &&
      !context.resolvedMediaIds.has(mediaId)
    ) {
      add(
        'blocker',
        'checking-media',
        `${media.title} is still being checked`,
        'Wait for media verification to finish before presenting.',
        'service-item',
        itemId,
      )
    }
  }

  function checkLibraryConflict(kind: string, id: string, itemId?: string) {
    const key = `${kind}:${id}`
    if (reportedConflicts.has(key)) return
    const label = context.libraryConflictLabels.get(key)
    if (!label) return
    reportedConflicts.add(key)
    add(
      'warning',
      'library-conflict',
      `${label} has another synced version`,
      'Review the two versions in Library Health before the service.',
      'library-health',
      itemId,
    )
  }

  if (!context.audienceDisplayAvailable) {
    add(
      'blocker',
      'audience-display',
      'No audience display is ready',
      'Connect or choose the projector or audience monitor.',
      'display',
    )
  }

  checkLibraryConflict('service', service.id)

  for (const item of service.items) {
    const label = serviceItemLabel(item, context)

    if (item.type === 'placeholder') {
      add(
        'blocker',
        'placeholder',
        `${label} still needs content`,
        'Replace the template placeholder with the planned service item.',
        'service-item',
        item.id,
      )
      continue
    }

    if (item.themeId && !context.themes.some((theme) => theme.id === item.themeId)) {
      add(
        'blocker',
        'missing-theme',
        `${label} references a missing theme`,
        'Choose another presentation theme or return to the default.',
        'service-item',
        item.id,
      )
    }
    const target = presentationThemeTargetForItem(item)
    const theme = resolvePresentationTheme(item, target, context.themes)
    if (theme) checkLibraryConflict('theme', theme.id, item.id)
    if (
      theme?.backgroundId &&
      theme.backgroundId !== 'brand-primary' &&
      theme.backgroundId !== 'brand-secondary'
    )
      checkMedia(theme.backgroundId, `${theme.name} background`, item.id)

    if (item.type === 'song') {
      checkLibraryConflict('song', item.songId, item.id)
      const song = context.songs.get(item.songId)
      if (!song) {
        add('blocker', 'missing-song', 'A referenced song is missing', 'Choose another song for this service item.', 'service-item', item.id)
        continue
      }
      if (!item.arrangement.sequence.length) {
        add('blocker', 'empty-arrangement', `${song.title} has an empty arrangement`, 'Add at least one song section to its service arrangement.', 'service-item', item.id)
      }
      const missingBlocks = [
        ...new Set(
          item.arrangement.sequence.filter(
            (blockId) => !song.blocks.some((block) => block.id === blockId),
          ),
        ),
      ]
      if (missingBlocks.length) {
        add('blocker', 'missing-song-block', `${song.title} has missing song sections`, `${missingBlocks.length} arrangement ${missingBlocks.length === 1 ? 'entry no longer matches' : 'entries no longer match'} the song.`, 'service-item', item.id)
      }
    } else if (item.type === 'slide-ref') {
      checkLibraryConflict('slide', item.slideId, item.id)
      const presentation = context.slides.get(item.slideId)
      if (!presentation) {
        add('blocker', 'missing-slides', 'A referenced presentation is missing', 'Choose another presentation.', 'service-item', item.id)
        continue
      }
      if (!presentation.slides.length) {
        add('blocker', 'empty-slides', `${presentation.label} has no slides`, 'Add at least one slide before presenting.', 'service-item', item.id)
      }
      for (const mediaId of sceneMediaIds(presentation))
        checkMedia(mediaId, `${presentation.label} media`, item.id)
    } else if (item.type === 'media' || item.type === 'video' || item.type === 'audio') {
      checkMedia(item.mediaId, label, item.id)
      if (item.type === 'audio') {
        add('blocker', 'unsupported-audio', 'Audio presentation is not implemented', 'Remove this item or replace it with supported content.', 'service-item', item.id)
      }
    } else if (item.type === 'scripture') {
      if (!item.reference.trim() || !item.translation.trim()) {
        add('blocker', 'invalid-scripture', 'Scripture details are incomplete', 'Enter a reference and translation.', 'service-item', item.id)
      } else if (item.displayMode === 'full') {
        if (context.scriptureErrorKeys.has(item.id))
          add('blocker', 'scripture-error', `${item.reference} could not be resolved`, 'Check the reference, translation, and Bible API connection.', 'service-item', item.id)
        else if (!context.resolvedScriptureKeys.has(item.id))
          add('blocker', 'scripture-pending', `${item.reference} is still being resolved`, 'Wait for the passage text to finish loading.', 'service-item', item.id)
      }
    } else if (item.type === 'sermon') {
      if (!item.passages.length) {
        add('blocker', 'empty-sermon', `${label} has no scripture passages`, 'Add at least one sermon passage.', 'service-item', item.id)
      }
      for (const passage of item.passages) {
        const key = `${item.id}:${passage.id}`
        if (!passage.reference.trim() || !passage.translation.trim()) {
          add('blocker', 'invalid-sermon-passage', `${label} has an incomplete passage`, 'Enter a reference and translation.', 'service-item', item.id)
        } else if (passage.displayMode === 'full') {
          if (context.scriptureErrorKeys.has(key))
            add('blocker', 'sermon-passage-error', `${passage.reference} could not be resolved`, 'Check the reference, translation, and Bible API connection.', 'service-item', item.id)
          else if (!context.resolvedScriptureKeys.has(key))
            add('blocker', 'sermon-passage-pending', `${passage.reference} is still being resolved`, 'Wait for the passage text to finish loading.', 'service-item', item.id)
        }
      }
      if (item.mainPassageId && !item.passages.some((passage) => passage.id === item.mainPassageId)) {
        add('warning', 'missing-main-passage', `${label} has no valid main passage`, 'Choose which passage should appear in reports and the bulletin.', 'service-item', item.id)
      }
    } else if (item.type === 'text-slide') {
      if (!item.slides.length) {
        add('blocker', 'empty-text-slides', 'A text-slide item has no slides', 'Add at least one text slide.', 'service-item', item.id)
      } else if (item.slides.some((slide) => !slide.text.trim())) {
        add('warning', 'blank-text-slide', 'A text slide is blank', 'Add text or remove the blank slide.', 'service-item', item.id)
      }
    } else if (item.type === 'external-app') {
      const profile = context.externalApps.get(item.profileId)
      if (!profile) {
        add('blocker', 'missing-external-app', 'An external application profile is missing', 'Choose or configure the application again.', 'service-item', item.id)
      } else {
        if (profile.launchMode === 'launch-automatically' && !profile.executablePath?.trim())
          add('blocker', 'missing-executable', `${profile.name} has no executable`, 'Configure its executable in Settings.', 'service-item', item.id)
        if (profile.parameterFormat?.includes('{file}') && !item.file?.trim())
          add('blocker', 'missing-external-file', `${profile.name} needs a service file`, 'Choose the file this service item should open.', 'service-item', item.id)
        const verificationError = context.externalAppErrors.get(item.id)
        if (verificationError)
          add('blocker', 'external-app-error', `${profile.name} is not ready`, verificationError, 'service-item', item.id)
        else if (
          context.externalAppVerificationAvailable &&
          !context.verifiedExternalAppItemIds.has(item.id)
        )
          add('blocker', 'external-app-pending', `${profile.name} is still being checked`, 'Wait for executable and file verification to finish.', 'service-item', item.id)
      }
    }
  }

  const assignments = service.assignments ?? []
  const warnedRoles = new Set<string>()
  for (const assignment of assignments) {
    if (!assignment.personId) {
      if (!warnedRoles.has(assignment.role)) {
        warnedRoles.add(assignment.role)
        add('warning', 'unassigned-role', `${assignment.role} is unassigned`, 'Complete the service roster or confirm that the role is not needed.', 'assignments')
      }
      continue
    }
    const person = context.people.get(assignment.personId)
    checkLibraryConflict('person', assignment.personId)
    if (!person) {
      add('blocker', 'missing-person', `${assignment.role} references a missing person`, 'Choose another person for this assignment.', 'assignments')
    } else if (isDateUnavailable(service.date, person.unavailableDateRanges)) {
      add('warning', 'unavailable-person', `${personDisplayName(person)} is marked unavailable`, `Review the ${assignment.role} assignment for this service date.`, 'assignments')
    }
  }
  for (const conflict of findRoleConflicts(assignments)) {
    const person = context.people.get(conflict.personId)
    add('warning', 'role-conflict', `${person ? personDisplayName(person) : 'A person'} has multiple roles`, conflict.roles.join(', '), 'assignments')
  }

  const blockers = issues.filter((issue) => issue.severity === 'blocker')
  const warnings = issues.filter((issue) => issue.severity === 'warning')
  return { issues, blockers, warnings, ready: blockers.length === 0 }
}
