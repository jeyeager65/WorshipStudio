import { describe, expect, it } from 'vitest'
import { parseConnectLink } from '../connectLink'

const ORIGIN = 'https://church.example.com'
const PATHNAME = '/app/'

describe('parseConnectLink', () => {
  it('returns the search params for a valid connect link matching this app', () => {
    const params = parseConnectLink(
      `${ORIGIN}${PATHNAME}?connect=dropbox&key=abc123&path=%2FChurch%2FLibrary`,
      ORIGIN,
      PATHNAME,
    )
    expect(params?.get('connect')).toBe('dropbox')
    expect(params?.get('key')).toBe('abc123')
    expect(params?.get('path')).toBe('/Church/Library')
  })

  it('rejects a link from a different origin', () => {
    const params = parseConnectLink(
      `https://not-this-church.example.com${PATHNAME}?connect=dropbox&key=abc123`,
      ORIGIN,
      PATHNAME,
    )
    expect(params).toBeUndefined()
  })

  it('rejects a link with a different path on the same origin', () => {
    const params = parseConnectLink(
      `${ORIGIN}/some-other-page?connect=dropbox&key=abc123`,
      ORIGIN,
      PATHNAME,
    )
    expect(params).toBeUndefined()
  })

  it('rejects a same-origin link with no connect param — e.g. a Remote Control pairing QR', () => {
    const params = parseConnectLink(
      `${ORIGIN}${PATHNAME}?remoteControl=1&token=xyz`,
      ORIGIN,
      PATHNAME,
    )
    expect(params).toBeUndefined()
  })

  it('rejects text that is not a URL at all', () => {
    expect(parseConnectLink('not a url', ORIGIN, PATHNAME)).toBeUndefined()
    expect(parseConnectLink('', ORIGIN, PATHNAME)).toBeUndefined()
    expect(parseConnectLink('random scanned text 12345', ORIGIN, PATHNAME)).toBeUndefined()
  })

  it('rejects a well-formed URL to an entirely different site', () => {
    const params = parseConnectLink('https://example.com/', ORIGIN, PATHNAME)
    expect(params).toBeUndefined()
  })
})
