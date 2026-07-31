import { describe, expect, it } from 'vitest'
import { createBlankScene, createTextElement, scenePlainText } from '@/utils/slideScene'

describe('slide scenes', () => {
  it('includes full-height 16:10 and 4:3 crop guides', () => {
    const scene = createBlankScene()

    expect(scene).toMatchObject({
      width: 1920,
      height: 1080,
      safeAreas: [
        { label: '16:10 SAFE', aspectRatio: 1.6, color: '#42a5f5' },
        { label: '4:3 SAFE', aspectRatio: 4 / 3, color: '#ffd740' },
      ],
    })
  })

  it('derives the legacy fallback from visible text layers in layer order', () => {
    const scene = createBlankScene()
    scene.elements = [
      createTextElement('First'),
      { ...createTextElement('Hidden'), hidden: true },
      createTextElement('Second'),
    ]

    expect(scenePlainText(scene)).toBe('First\nSecond')
  })
})
