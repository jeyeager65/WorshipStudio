import { describe, expect, it } from 'vitest'
import { buildConnectCode, parseConnectCode } from '../connectCode'

describe('connectCode', () => {
  it('round-trips a built code back to the same fields', () => {
    const code = buildConnectCode({
      provider: 'dropbox',
      clientId: 'abc123',
      libraryFolderPath: '/Church/Library',
    })
    const parsed = parseConnectCode(code)
    expect(parsed).toEqual({
      provider: 'dropbox',
      clientId: 'abc123',
      libraryFolderPath: '/Church/Library',
    })
  })

  it('round-trips with an empty library folder path', () => {
    const code = buildConnectCode({ provider: 'onedrive', clientId: 'xyz', libraryFolderPath: '' })
    expect(parseConnectCode(code)).toEqual({
      provider: 'onedrive',
      clientId: 'xyz',
      libraryFolderPath: '',
    })
  })

  it('tolerates surrounding whitespace and extra blank lines from copy/paste', () => {
    const parsed = parseConnectCode('\n  WorshipStudioConnect/1  \n dropbox \n abc123 \n \n')
    expect(parsed).toEqual({ provider: 'dropbox', clientId: 'abc123', libraryFolderPath: '' })
  })

  it('rejects text missing the header — e.g. a Remote Control pairing code or random text', () => {
    expect(parseConnectCode('remoteControl:xyz')).toBeUndefined()
    expect(parseConnectCode('random scanned text 12345')).toBeUndefined()
    expect(parseConnectCode('')).toBeUndefined()
  })

  it('rejects an unrecognized provider', () => {
    expect(parseConnectCode('WorshipStudioConnect/1\ngoogledrive\nabc123')).toBeUndefined()
  })

  it('rejects a missing client ID', () => {
    expect(parseConnectCode('WorshipStudioConnect/1\ndropbox\n')).toBeUndefined()
  })
})
