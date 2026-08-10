import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildAuthorizeUrl,
  codeChallengeFromVerifier,
  disconnect,
  exchangeCodeForTokens,
  generateCodeVerifier,
  getValidAccessToken,
} from '../dropboxAuth'
import type { DropboxTokens } from '../dropboxAuthStorage'

const { loadDropboxTokens, saveDropboxTokens, clearDropboxTokens } = vi.hoisted(() => ({
  loadDropboxTokens: vi.fn(),
  saveDropboxTokens: vi.fn(),
  clearDropboxTokens: vi.fn(),
}))
vi.mock('../dropboxAuthStorage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../dropboxAuthStorage')>()),
  loadDropboxTokens,
  saveDropboxTokens,
  clearDropboxTokens,
}))

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, text: async () => JSON.stringify(body), json: async () => body } as Response
}

beforeEach(() => {
  loadDropboxTokens.mockReset()
  saveDropboxTokens.mockReset()
  clearDropboxTokens.mockReset()
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PKCE', () => {
  it('generates a verifier in the RFC 7636 length/charset range', () => {
    const verifier = generateCodeVerifier()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier.length).toBeLessThanOrEqual(128)
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/)
  })

  // RFC 7636 Appendix B's own worked example — verifies the challenge derivation against a
  // known-correct value, not just "produces some string".
  it('derives the code challenge matching the RFC 7636 test vector', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    await expect(codeChallengeFromVerifier(verifier)).resolves.toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })
})

describe('buildAuthorizeUrl', () => {
  it('includes every required param, requesting offline access', () => {
    const url = new URL(
      buildAuthorizeUrl({
        appKey: 'app-key-1',
        redirectUri: 'https://example.com/',
        state: 'state-1',
        codeChallenge: 'challenge-1',
      }),
    )
    expect(url.origin + url.pathname).toBe('https://www.dropbox.com/oauth2/authorize')
    expect(url.searchParams.get('client_id')).toBe('app-key-1')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('code_challenge')).toBe('challenge-1')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('redirect_uri')).toBe('https://example.com/')
    expect(url.searchParams.get('state')).toBe('state-1')
    expect(url.searchParams.get('token_access_type')).toBe('offline')
  })
})

describe('exchangeCodeForTokens', () => {
  it('posts the PKCE exchange with no client secret and saves the resulting tokens', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_in: 14400,
        account_id: 'account-1',
      }),
    )

    const tokens = await exchangeCodeForTokens({
      appKey: 'app-key-1',
      redirectUri: 'https://example.com/',
      code: 'code-1',
      codeVerifier: 'verifier-1',
    })

    const [url, init] = vi.mocked(fetch).mock.calls[0]!
    expect(url).toBe('https://api.dropboxapi.com/oauth2/token')
    const body = new URLSearchParams(init!.body as string)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('code-1')
    expect(body.get('client_id')).toBe('app-key-1')
    expect(body.get('code_verifier')).toBe('verifier-1')
    expect(body.has('client_secret')).toBe(false)
    expect(tokens.accessToken).toBe('access-1')
    expect(tokens.refreshToken).toBe('refresh-1')
    expect(saveDropboxTokens).toHaveBeenCalledWith(tokens)
  })

  it('throws if Dropbox omits the refresh token, without saving anything', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ access_token: 'access-1', expires_in: 14400, account_id: 'account-1' }),
    )

    await expect(
      exchangeCodeForTokens({
        appKey: 'app-key-1',
        redirectUri: 'https://example.com/',
        code: 'code-1',
        codeVerifier: 'verifier-1',
      }),
    ).rejects.toThrow(/refresh token/)
    expect(saveDropboxTokens).not.toHaveBeenCalled()
  })
})

describe('getValidAccessToken', () => {
  const farFromExpiry: DropboxTokens = {
    accessToken: 'still-good',
    refreshToken: 'refresh-1',
    expiresAt: Date.now() + 60 * 60 * 1000,
    accountId: 'account-1',
  }

  it('returns undefined when this device has never connected', async () => {
    loadDropboxTokens.mockResolvedValue(undefined)
    await expect(getValidAccessToken('app-key-1')).resolves.toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns the cached access token without refreshing when far from expiry', async () => {
    loadDropboxTokens.mockResolvedValue(farFromExpiry)
    await expect(getValidAccessToken('app-key-1')).resolves.toBe('still-good')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('silently refreshes within 60s of expiry, keeping the same refresh token', async () => {
    const almostExpired: DropboxTokens = { ...farFromExpiry, expiresAt: Date.now() + 30_000 }
    loadDropboxTokens.mockResolvedValue(almostExpired)
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ access_token: 'refreshed-access', expires_in: 14400 }),
    )

    const token = await getValidAccessToken('app-key-1')

    expect(token).toBe('refreshed-access')
    const [, init] = vi.mocked(fetch).mock.calls[0]!
    const body = new URLSearchParams(init!.body as string)
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('refresh-1')
    expect(body.has('client_secret')).toBe(false)
    expect(saveDropboxTokens).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'refreshed-access', refreshToken: 'refresh-1' }),
    )
  })
})

describe('disconnect', () => {
  it('revokes the token and clears local storage', async () => {
    loadDropboxTokens.mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: Date.now() + 1000,
      accountId: 'account-1',
    })
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}))

    await disconnect()

    const [url, init] = vi.mocked(fetch).mock.calls[0]!
    expect(url).toBe('https://api.dropboxapi.com/2/auth/token/revoke')
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer access-1')
    expect(clearDropboxTokens).toHaveBeenCalled()
  })

  it('still clears local storage even if the revoke request fails', async () => {
    loadDropboxTokens.mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: Date.now() + 1000,
      accountId: 'account-1',
    })
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network down'))

    await disconnect()

    expect(clearDropboxTokens).toHaveBeenCalled()
  })
})
