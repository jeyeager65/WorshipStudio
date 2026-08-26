/**
 * OneDrive (Microsoft Graph) OAuth2 with PKCE, using the `spa` app-registration platform type —
 * confirmed against Microsoft's own docs to need no client secret at all for the full
 * Authorization Code + PKCE flow, including refresh, with the token endpoint explicitly
 * supporting CORS from a browser origin. Same enabling fact that makes Dropbox's integration
 * possible (see dropboxAuth.ts), just a different provider's docs confirming it independently.
 *
 * One real difference from Dropbox: a refresh token issued to an `spa` redirect is capped at a
 * 24-hour lifetime *from the original interactive sign-in*, no matter how often it's used to
 * refresh — "additional refresh tokens acquired using the initial refresh token carr[y] over
 * that expiration time" (Microsoft's own wording). Past that point, getValidAccessToken() below
 * attempts one silent (`prompt=none`) reauth via a hidden iframe before giving up — the standard
 * technique browser OAuth libraries use for this, and the reason `attemptSilentReauth` is
 * exported separately: real cross-origin iframe navigation has no meaningful equivalent in the
 * jsdom test environment, so tests substitute a fake implementation for it rather than trying to
 * simulate a real Microsoft login redirect chain.
 *
 * Unlike Dropbox, this device's copy of the tokens is simply discarded on disconnect — Microsoft
 * doesn't expose a simple "revoke this one refresh token" REST endpoint the way Dropbox's
 * `/2/auth/token/revoke` does, so there's no remote call to make first.
 */

import {
  clearOneDriveTokens,
  loadOneDriveTokens,
  saveOneDriveTokens,
  type OneDriveTokens,
} from './onedriveAuthStorage'

// 'common' rather than a specific tenant so this works for both personal Microsoft accounts and
// work/school (Microsoft 365) accounts — a church could plausibly use either.
const TENANT = 'common'
const AUTHORIZE_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`
// Read+write to whatever the signed-in account can already reach (not just an app-created
// folder) is required to reach the church's *existing* synced library — same reasoning as
// Dropbox's Full Dropbox access scope. offline_access is what makes a refresh_token come back.
//
// `.All` rather than plain `Files.ReadWrite`, which covers only files in the signed-in user's *own*
// drive. A library shared from another account — the normal arrangement once more than one person
// uses it — lives in the owner's drive and is reached through /me/drive/sharedWithMe and
// /drives/{driveId}/…, neither of which plain Files.ReadWrite can touch. Confirmed the hard way:
// path addressing into a shared folder returned 404 on the narrower scope (see
// notes/tablet-onboarding-and-account-model.md).
//
// The cost is a broader consent prompt — "all files you have access to" rather than just your own.
// Unavoidable for shared-folder support, and still user-consentable on personal accounts; a
// work/school tenant may require an administrator to approve it.
const SCOPE = 'Files.ReadWrite.All offline_access'

// RFC 7636 requires the verifier be 43-128 characters from the unreserved character set
// [A-Za-z0-9-._~]. 32 random bytes, base64url-encoded, lands at 43 characters exactly. Deliberate
// duplication of dropboxAuth.ts's identical PKCE math rather than a shared import — these two
// provider modules are meant to stay independently swappable (and removable) from each other.
export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

export async function codeChallengeFromVerifier(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64UrlEncode(new Uint8Array(digest))
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function generateState(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

export function buildAuthorizeUrl(params: {
  clientId: string
  redirectUri: string
  state: string
  codeChallenge: string
  /** 'none' requests a silent attempt (no visible UI) — used only by attemptSilentReauth below. */
  prompt?: 'none'
}): string {
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('scope', SCOPE)
  url.searchParams.set('code_challenge', params.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', params.state)
  if (params.prompt) url.searchParams.set('prompt', params.prompt)
  return url.toString()
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
}

async function requestTokens(body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`OneDrive sign-in failed (${response.status}). ${detail}`.trim())
  }
  return response.json()
}

const REFRESH_TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000

/** Dropbox's token response carries `account_id` for free; Microsoft's does not, and the obvious
 *  substitute — `GET /me` — needs the `User.Read` scope this app deliberately never requests. So
 *  that call could only ever 401, silently returning 'unknown' while emitting an alarming console
 *  error on every single connection. It has been removed rather than fixed: nothing reads
 *  `accountId` for any decision, and adding `User.Read` would widen consent for a field no code
 *  consumes. The property stays for storage-shape symmetry with Dropbox. */
const ACCOUNT_ID_UNAVAILABLE = 'unknown'

export async function exchangeCodeForTokens(params: {
  clientId: string
  redirectUri: string
  code: string
  codeVerifier: string
}): Promise<OneDriveTokens> {
  const body = await requestTokens(
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: params.clientId,
      scope: SCOPE,
      code: params.code,
      redirect_uri: params.redirectUri,
      code_verifier: params.codeVerifier,
    }),
  )
  if (!body.refresh_token) {
    throw new Error('Microsoft did not return a refresh token — cannot stay connected long-term.')
  }
  const tokens: OneDriveTokens = {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + body.expires_in * 1000,
    // The 24h cap starts from this first interactive sign-in and carries over through every
    // later silent refresh — see this module's own doc comment.
    refreshTokenExpiresAt: Date.now() + REFRESH_TOKEN_LIFETIME_MS,
    accountId: ACCOUNT_ID_UNAVAILABLE,
  }
  await saveOneDriveTokens(tokens)
  return tokens
}

async function refreshAccessToken(
  clientId: string,
  current: OneDriveTokens,
): Promise<OneDriveTokens> {
  const body = await requestTokens(
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      scope: SCOPE,
      refresh_token: current.refreshToken,
    }),
  )
  const tokens: OneDriveTokens = {
    accessToken: body.access_token,
    // Microsoft rotates refresh tokens on every use (discard-the-old-one, per the OAuth spec) —
    // unlike Dropbox, which keeps issuing against the same refresh token indefinitely.
    refreshToken: body.refresh_token ?? current.refreshToken,
    expiresAt: Date.now() + body.expires_in * 1000,
    // Deliberately NOT reset — carries over from the original interactive sign-in.
    refreshTokenExpiresAt: current.refreshTokenExpiresAt,
    accountId: current.accountId,
  }
  await saveOneDriveTokens(tokens)
  return tokens
}

/** Silent (`prompt=none`) reauth via a hidden iframe — resolves the new tokens if the browser
 *  still allows the background frame to reach login.microsoftonline.com's session cookie,
 *  undefined otherwise (Safari, any third-party-cookie-blocking browser, or simply no active
 *  session). Never throws — a failed silent attempt is an expected, ordinary outcome here, not
 *  an error. */
export async function attemptSilentReauth(clientId: string): Promise<OneDriveTokens | undefined> {
  if (typeof document === 'undefined') return undefined
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await codeChallengeFromVerifier(codeVerifier)
  const state = generateState()
  const redirectUri = `${window.location.origin}${window.location.pathname}`
  const authorizeUrl = buildAuthorizeUrl({
    clientId,
    redirectUri,
    state,
    codeChallenge,
    prompt: 'none',
  })

  return new Promise((resolve) => {
    const iframe = document.createElement('iframe')
    iframe.style.display = 'none'
    let settled = false
    const finish = (result: OneDriveTokens | undefined) => {
      if (settled) return
      settled = true
      clearInterval(pollTimer)
      clearTimeout(giveUpTimer)
      iframe.remove()
      resolve(result)
    }
    const giveUpTimer = setTimeout(() => finish(undefined), 10_000)
    const pollTimer = setInterval(() => {
      let href: string
      try {
        href = iframe.contentWindow?.location.href ?? ''
      } catch {
        return // still cross-origin (on login.microsoftonline.com) — keep waiting
      }
      if (!href || !href.startsWith(redirectUri)) return
      const params = new URL(href).searchParams
      const code = params.get('code')
      if (!code || params.get('state') !== state) {
        finish(undefined)
        return
      }
      exchangeCodeForTokens({ clientId, redirectUri, code, codeVerifier })
        .then((tokens) => finish(tokens))
        .catch(() => finish(undefined))
    }, 200)
    iframe.src = authorizeUrl
    document.body.appendChild(iframe)
  })
}

const REFRESH_MARGIN_MS = 60_000

/** The current access token: silently refreshing first if it's within 60s of expiry (same margin
 *  as Dropbox's equivalent), or — once the 24h refresh-token cap has passed, or an ordinary
 *  refresh attempt itself fails — falling back to one silent reauth attempt. Returns undefined if
 *  this device has never connected, or if every fallback above was exhausted; the caller
 *  (providers/onedrive.ts) is what turns that into a distinguishable ProviderReauthRequiredError,
 *  mirroring how dropboxAuth.ts's identically-shaped return is handled by providers/dropbox.ts. */
export async function getValidAccessToken(clientId: string): Promise<string | undefined> {
  const tokens = await loadOneDriveTokens()
  if (!tokens) return undefined
  if (tokens.expiresAt > Date.now() + REFRESH_MARGIN_MS) return tokens.accessToken

  if (tokens.refreshTokenExpiresAt > Date.now()) {
    try {
      const refreshed = await refreshAccessToken(clientId, tokens)
      return refreshed.accessToken
    } catch {
      // Fall through to a silent reauth attempt below rather than failing outright — the refresh
      // token may simply have been revoked early, which a fresh sign-in can still recover from.
    }
  }

  const reauthed = await attemptSilentReauth(clientId)
  return reauthed?.accessToken
}

export async function isConnected(): Promise<boolean> {
  return (await loadOneDriveTokens()) !== undefined
}

export async function disconnect(): Promise<void> {
  await clearOneDriveTokens()
}
