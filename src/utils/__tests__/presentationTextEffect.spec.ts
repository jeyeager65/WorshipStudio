import { describe, expect, it } from 'vitest'
import { presentationTextEffect, presentationTextShadow } from '@/utils/presentationTextEffect'

describe('presentation text effects', () => {
  it('migrates the legacy outline switch to the configurable default outline', () => {
    expect(presentationTextEffect({ outline: true }).type).toBe('outline')
    expect(presentationTextEffect({ outline: false }).type).toBe('none')
  })

  it('preserves a configured effect instead of the legacy switch', () => {
    const effect = presentationTextEffect({
      outline: true,
      textEffect: { type: 'glow', color: '#3366FF', size: 8 },
    })
    expect(effect).toMatchObject({ type: 'glow', color: '#3366FF', size: 8 })
  })

  it('renders shadow offsets and turns off a none effect', () => {
    expect(
      presentationTextShadow({
        type: 'shadow',
        color: '#112233',
        size: 5,
        offsetX: -2,
        offsetY: 7,
      }),
    ).toBe('-2px 7px 5px #112233')
    expect(presentationTextShadow({ type: 'none', color: '#000000', size: 4 })).toBe('none')
  })
})
