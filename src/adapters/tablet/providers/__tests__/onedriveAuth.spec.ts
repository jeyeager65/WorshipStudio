import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  attemptSilentReauth,
  buildAuthorizeUrl,
  codeChallengeFromVerifier,
  disconnect,
  exchangeCodeForTokens,
  generateCodeVerifier,
  generateState,
  getValidAccessToken,
  isConnected,
} from '../onedriveAuth'
import {
  clearOneDriveTokens,
  loadOneDriveTokens,
  saveOneDriveTokens,
  type OneDriveTokens,
} from '../onedriveAuthStorage'

vi.mock('../onedriveAuthStorage', () => ({
  loadOneDriveTokens: vi.fn(),
  saveOneDriveTokens: vi.fn(),
  clearOneDriveTokens: vi.fn(),
}))

const fetchMock = vi.fn()

beforeEach(() => {
  vi.mocked(loadOneDriveTokens).mockReset()
  vi.mocked(saveOneDriveTokens).mockReset()
  vi.mocked(clearOneDriveTokens).mockReset()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function tokens(overrides: Partial<OneDriveTokens> = {}): OneDriveTokens {
  return {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: Date.now() + 60 * 60 * 1000,
    refreshTokenExpiresAt: Date.now() + 23 * 60 * 60 * 1000,
    accountId: 'account-1',
    ...overrides,
  }
}

describe('PKCE math', () => {
  it('generates a verifier of RFC 7636-valid length', () => {
    const verifier = generateCodeVerifier()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier.length).toBeLessThanOrEqual(128)
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/)
  })

  it('matches the RFC 7636 Appendix B worked example', async () => {
    const challenge = await codeChallengeFromVerifier('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('generates a state value', () => {
    expect(generateState().length).toBeGreaterThan(0)
  })
})

describe('buildAuthorizeUrl', () => {
  it('includes client_id, scope, PKCE params, and offline access via scope', () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: 'client-1',
        redirectUri: 'https://app.example/',
        state: 'state-1',
        codeChallenge: 'challenge-1',
      }),
    )
    expect(url.searchParams.get('client_id')).toBe('client-1')
    expect(url.searchParams.get('code_challenge')).toBe('challenge-1')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')).toContain('offline_access')
    expect(url.searchParams.get('prompt')).toBeNull()
  })

  it('sets prompt=none when requested', () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: 'client-1',
        redirectUri: 'https://app.example/',
        state: 'state-1',
        codeChallenge: 'challenge-1',
        prompt: 'none',
      }),
    )
    expect(url.searchParams.get('prompt')).toBe('none')
  })
})

describe('exchangeCodeForTokens', () => {
  it('saves tokens with a refresh-token expiry ~24h out', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'a1', refresh_token: 'r1', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'account-1' }) })

    const result = await exchangeCodeForTokens({
      clientId: 'client-1',
      redirectUri: 'https://app.example/',
      code: 'code-1',
      codeVerifier: 'verifier-1',
    })

    expect(result.refreshTokenExpiresAt).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000)
    expect(result.refreshTokenExpiresAt).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60 * 1000)
    expect(saveOneDriveTokens).toHaveBeenCalledWith(result)
  })

  it('throws if Microsoft does not return a refresh token', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'a1', expires_in: 3600 }),
    })

    await expect(
      exchangeCodeForTokens({
        clientId: 'client-1',
        redirectUri: 'https://app.example/',
        code: 'code-1',
        codeVerifier: 'verifier-1',
      }),
    ).rejects.toThrow('did not return a refresh token')
  })
})

describe('getValidAccessToken', () => {
  it('returns undefined when this device has never connected', async () => {
    vi.mocked(loadOneDriveTokens).mockResolvedValueOnce(undefined)
    await expect(getValidAccessToken('client-1')).resolves.toBeUndefined()
  })

  it('returns the cached access token when still valid', async () => {
    vi.mocked(loadOneDriveTokens).mockResolvedValueOnce(tokens())
    await expect(getValidAccessToken('client-1')).resolves.toBe('access-1')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refreshes when the access token is near expiry but the refresh token is still valid', async () => {
    vi.mocked(loadOneDriveTokens).mockResolvedValueOnce(
      tokens({ expiresAt: Date.now() + 10_000 }),
    )
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'a2', refresh_token: 'r2', expires_in: 3600 }),
    })

    const result = await getValidAccessToken('client-1')

    expect(result).toBe('a2')
    expect(saveOneDriveTokens).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'a2', refreshToken: 'r2' }),
    )
  })

  it("does not reset the refresh token's own 24h expiry on an ordinary refresh", async () => {
    const original = tokens({ expiresAt: Date.now() + 10_000 })
    vi.mocked(loadOneDriveTokens).mockResolvedValueOnce(original)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'a2', refresh_token: 'r2', expires_in: 3600 }),
    })

    await getValidAccessToken('client-1')

    expect(saveOneDriveTokens).toHaveBeenCalledWith(
      expect.objectContaining({ refreshTokenExpiresAt: original.refreshTokenExpiresAt }),
    )
  })

})

describe('attemptSilentReauth', () => {
  it('resolves undefined outside a browser environment (no document)', async () => {
    const originalDocument = globalThis.document
    // @ts-expect-error -- simulating a non-browser environment for this one assertion
    delete globalThis.document
    try {
      await expect(attemptSilentReauth('client-1')).resolves.toBeUndefined()
    } finally {
      globalThis.document = originalDocument
    }
  })
})


describe('isConnected / disconnect', () => {
  it('isConnected reflects whether tokens exist', async () => {
    vi.mocked(loadOneDriveTokens).mockResolvedValueOnce(tokens())
    await expect(isConnected()).resolves.toBe(true)
    vi.mocked(loadOneDriveTokens).mockResolvedValueOnce(undefined)
    await expect(isConnected()).resolves.toBe(false)
  })

  it('disconnect clears local tokens without a remote revoke call', async () => {
    await disconnect()
    expect(clearOneDriveTokens).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
