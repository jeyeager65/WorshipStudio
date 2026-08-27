import type { LibrarySlide, SlideLibraryItem, SlideScene } from '@/models/library'

/**
 * A sample slide presentation for the demo library and "Load Sample Data".
 *
 * The Slide Library was previously seeded empty, so the Slides page — and the whole native slide
 * editor behind it — demonstrated nothing at all. This is a pre-service announcement loop, which is
 * the most common real use of the feature: something to leave on screen before the service starts,
 * cycling on a timer without anyone touching it.
 *
 * Built from the scene primitives rather than hand-written JSON so the layout stays consistent
 * between slides and stays readable — a background, a rule, a heading, then either body text or the
 * countdown. The opening slide counts down in 'service' mode, which targets whatever service it is
 * shown in rather than a fixed time, so it can never go stale the way a hardcoded target would.
 *
 * Deliberately uses no `mediaId` anywhere: media is not seeded (the stock backgrounds are offered
 * rather than installed), so referencing one would leave the demo with slides pointing at an image
 * that does not exist.
 */

const device = 'sample-data'

const WIDTH = 1920
const HEIGHT = 1080

/** Matches LibrarySettings.branding.primaryColor/secondaryColor in the seeded demo, so the sample
 *  slides look like they belong to the same church as everything else. */
const INK = '#F5F7FA'
const ACCENT = '#C9A227'
const BACKDROP = '#1F3A5F'

function heading(text: string) {
  return {
    id: 'heading',
    type: 'text' as const,
    text,
    x: 160,
    y: 300,
    width: WIDTH - 320,
    height: 200,
    rotation: 0,
    opacity: 1,
    style: {
      fontFamily: 'Montserrat',
      fontSize: 96,
      fontWeight: 700,
      italic: false,
      underline: false,
      color: INK,
      textAlign: 'center' as const,
      verticalAlign: 'middle' as const,
      lineHeight: 1.1,
      letterSpacing: 0,
    },
    autoFit: 'shrink' as const,
  }
}

function body(text: string) {
  return {
    id: 'body',
    type: 'text' as const,
    text,
    x: 240,
    y: 560,
    width: WIDTH - 480,
    height: 260,
    rotation: 0,
    opacity: 1,
    style: {
      fontFamily: 'Montserrat',
      fontSize: 52,
      fontWeight: 400,
      italic: false,
      underline: false,
      color: INK,
      textAlign: 'center' as const,
      verticalAlign: 'top' as const,
      lineHeight: 1.35,
      letterSpacing: 0,
    },
    autoFit: 'shrink' as const,
  }
}

/** A short rule under the heading — enough to make the slides look composed rather than like a
 *  text dump, and it exercises shape elements alongside text. */
const RULE = {
  id: 'rule',
  type: 'shape' as const,
  shape: 'rectangle' as const,
  fill: ACCENT,
  x: WIDTH / 2 - 80,
  y: 500,
  width: 160,
  height: 6,
  rotation: 0,
  opacity: 1,
  cornerRadius: 3,
}

function scene(headingText: string, bodyText: string): SlideScene {
  return {
    width: WIDTH,
    height: HEIGHT,
    safeAreas: [],
    background: { color: BACKDROP, fit: 'cover' },
    elements: [RULE, heading(headingText), body(bodyText)],
  }
}

/** Counts down to this service's own start time, so it needs no target date and can never go
 *  stale — which is the whole reason 'service' mode exists rather than a fixed 'custom' target. */
const SERVICE_COUNTDOWN = {
  id: 'countdown',
  type: 'countdown' as const,
  mode: 'service' as const,
  label: 'The service begins in',
  x: 240,
  y: 540,
  width: WIDTH - 480,
  height: 260,
  rotation: 0,
  opacity: 1,
  style: {
    fontFamily: 'Montserrat',
    fontSize: 120,
    fontWeight: 700,
    color: ACCENT,
    textAlign: 'center' as const,
  },
}

function slide(id: string, label: string, headingText: string, bodyText: string): LibrarySlide {
  return { id, label, scene: scene(headingText, bodyText), source: { type: 'native' } }
}

export function buildSampleSlides(): SlideLibraryItem[] {
  const now = new Date().toISOString()
  return [
    {
      id: 'slide-sample-pre-service',
      label: 'Pre-Service Announcements',
      tags: ['Announcements', 'Pre-Service'],
      documentVersion: 2,
      slides: [
        {
          id: 'slide-welcome',
          label: 'Welcome',
          scene: {
            width: WIDTH,
            height: HEIGHT,
            safeAreas: [],
            background: { color: BACKDROP, fit: 'cover' },
            elements: [RULE, heading('Welcome'), SERVICE_COUNTDOWN],
          },
          source: { type: 'native' },
        },
        slide(
          'slide-potluck',
          'Potluck',
          'Fellowship Potluck',
          'Next Sunday, following the service.\nBring a dish to share — sign up at the welcome desk.',
        ),
        slide(
          'slide-vbs',
          'VBS',
          'Vacation Bible School',
          'Registration is now open for children\nentering kindergarten through grade 5.',
        ),
        slide(
          'slide-nursery',
          'Nursery',
          'Nursery Volunteers',
          'We are looking for two more volunteers\non the Sunday rotation.',
        ),
      ],
      // Cycles unattended before the service starts — the case the auto-advance default exists
      // for, and why `loop` is on here rather than playing through once.
      autoAdvance: { intervalSeconds: 10, loop: true },
      usage: {},
      updatedAt: now,
      updatedByDevice: device,
    },
  ]
}
