import { describe, expect, it } from 'vitest'
import { sortTitle } from '@/utils/songSort'

describe('sortTitle', () => {
  it('strips a leading "The " for alphabetizing', () => {
    expect(sortTitle('The Old Rugged Cross')).toBe('Old Rugged Cross')
  })

  it('strips a leading "A " for alphabetizing', () => {
    expect(sortTitle('A Mighty Fortress')).toBe('Mighty Fortress')
  })

  it('is case-insensitive on the article', () => {
    expect(sortTitle('the lion and the lamb')).toBe('lion and the lamb')
  })

  it('leaves titles with no leading article untouched', () => {
    expect(sortTitle('Amazing Grace')).toBe('Amazing Grace')
  })

  it('does not strip "A"/"The" when they are not a standalone leading word', () => {
    expect(sortTitle('Alleluia')).toBe('Alleluia')
    expect(sortTitle('Thereafter We Sing')).toBe('Thereafter We Sing')
  })

  it('only strips one leading article, not a repeated one', () => {
    expect(sortTitle('The The Anthem')).toBe('The Anthem')
  })

  it('strips leading punctuation like an opening apostrophe or quote', () => {
    expect(sortTitle("'Tis So Sweet to Trust in Jesus")).toBe('Tis So Sweet to Trust in Jesus')
    expect(sortTitle('"Days of Elijah"')).toBe('Days of Elijah"')
  })

  it('leaves a leading digit alone', () => {
    expect(sortTitle('10,000 Reasons')).toBe('10,000 Reasons')
  })

  it('strips leading punctuation before checking for a leading article', () => {
    expect(sortTitle('"The Solid Rock')).toBe('Solid Rock')
  })
})
