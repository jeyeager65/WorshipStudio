import type { SlideCountdownElement, SlideScene, SlideTextElement } from '@/models/library'

export const DEFAULT_SLIDE_SIZE = { width: 1920, height: 1080 } as const

export function createTextElement(text = 'Double-click to edit'): SlideTextElement {
  return {
    id: `element-${crypto.randomUUID()}`,
    type: 'text',
    name: 'Text',
    x: 360,
    y: 390,
    width: 1200,
    height: 300,
    rotation: 0,
    opacity: 1,
    text,
    style: {
      fontFamily: 'Inter',
      fontSize: 72,
      fontWeight: 600,
      italic: false,
      underline: false,
      color: '#ffffff',
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.2,
      letterSpacing: 0,
      effect: { type: 'outline', color: '#000000', size: 4 },
    },
    autoFit: 'shrink',
  }
}

export function createCountdownElement(): SlideCountdownElement {
  return {
    id: `element-${crypto.randomUUID()}`,
    type: 'countdown',
    name: 'Countdown',
    mode: 'service',
    x: 360,
    y: 390,
    width: 1200,
    height: 300,
    rotation: 0,
    opacity: 1,
    style: {
      fontFamily: 'Inter',
      fontSize: 120,
      fontWeight: 700,
      color: '#ffffff',
      textAlign: 'center',
    },
  }
}

export function createBlankScene(): SlideScene {
  return {
    ...DEFAULT_SLIDE_SIZE,
    safeAreas: [
      { label: '16:10 SAFE', aspectRatio: 16 / 10, color: '#42a5f5' },
      { label: '4:3 SAFE', aspectRatio: 4 / 3, color: '#ffd740' },
    ],
    background: { color: '#000000', fit: 'cover', focalPoint: { x: 0.5, y: 0.5 } },
    elements: [],
  }
}

export function scenePlainText(scene: SlideScene): string {
  return scene.elements
    .filter((element): element is SlideTextElement => element.type === 'text' && !element.hidden)
    .map((element) => element.text)
    .join('\n')
}
