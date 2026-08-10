/**
 * Dropbox OAuth2 with PKCE — confirmed (notes/completion-audit.md's design discussion) to
 * support a "public client" flow with no client secret, for both the initial token exchange and
 * refresh calls, unlike this app's existing Canva integration (whose token exchange requires a
 * secret over HTTP Basic Auth and is CORS-blocked from a browser, forcing Canva to go through a
 * loopback-server + system-browser flow instead). That's what makes a pure client-side
 * integration possible here.
 *
 * A full top-level redirect (window.location.assign), not a popup — popups are unreliable on
 * mobile Safari and in installed PWAs. See BootGate.vue for where `state`/`code_verifier` get
 * stashed in sessionStorage before navigating away, and where the redirect back is handled.
 */

import {
  clearDropboxTokens,
  loadDropboxTokens,
  saveDropboxTokens,
  type DropboxTokens,
} from './dropboxAuthStorage'

const AUTHORIZE_URL = 'https://www.dropbox.com/oauth2/authorize'
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token'
const REVOKE_URL = 'https://api.dropboxapi.com/2/auth/token/revoke'

// RFC 7636 requires the verifier be 43-128 characters from the unreserved character set
// [A-Za-z0-9-._~]. 32 random bytes, base64url-encoded, lands at 43 characters exactly.
export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

// Same Web Crypto SHA-256 API adapters/web/media.ts already uses for content hashing.
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
  appKey: string
  redirectUri: string
  state: string
  codeChallenge: string
}): string {
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('client_id', params.appKey)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('code_challenge', params.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('state', params.state)
  // Without this, Dropbox only ever returns a short-lived access token — no refresh_token, which
  // would mean re-prompting the full consent screen every few hours.
  url.searchParams.set('token_access_type', 'offline')
  return url.toString()
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  account_id: string
}

async function requestTokens(body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Dropbox sign-in failed (${response.status}). ${detail}`.trim())
  }
  return response.json()
}

export async function exchangeCodeForTokens(params: {
  appKey: string
  redirectUri: string
  code: string
  codeVerifier: string
}): Promise<DropboxTokens> {
  const body = await requestTokens(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      client_id: params.appKey,
      redirect_uri: params.redirectUri,
      code_verifier: params.codeVerifier,
    }),
  )
  if (!body.refresh_token) {
    // Should be unreachable given token_access_type=offline above, but a refresh-less session
    // would silently stop syncing the moment the short-lived access token expires — fail loudly
    // now instead of leaving a confusing "sync just stopped working in a few hours" bug.
    throw new Error('Dropbox did not return a refresh token — cannot stay connected long-term.')
  }
  const tokens: DropboxTokens = {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + body.expires_in * 1000,
    accountId: body.account_id,
  }
  await saveDropboxTokens(tokens)
  return tokens
}

async function refreshAccessToken(appKey: string, current: DropboxTokens): Promise<DropboxTokens> {
  const body = await requestTokens(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
      client_id: appKey,
    }),
  )
  // A refresh call doesn't return a new refresh_token — the existing one keeps working.
  const tokens: DropboxTokens = {
    accessToken: body.access_token,
    refreshToken: current.refreshToken,
    expiresAt: Date.now() + body.expires_in * 1000,
    accountId: current.accountId,
  }
  await saveDropboxTokens(tokens)
  return tokens
}

const REFRESH_MARGIN_MS = 60_000

/** The current access token, silently refreshing first if it's within 60s of expiry — mirrors
 *  src-tauri/src/commands/canva.rs's access_token() exactly (`expires_at > now + 60`). Returns
 *  undefined if this device has never connected (or has been disconnected). */
export async function getValidAccessToken(appKey: string): Promise<string | undefined> {
  const tokens = await loadDropboxTokens()
  if (!tokens) return undefined
  if (tokens.expiresAt > Date.now() + REFRESH_MARGIN_MS) return tokens.accessToken
  const refreshed = await refreshAccessToken(appKey, tokens)
  return refreshed.accessToken
}

export async function isConnected(): Promise<boolean> {
  return (await loadDropboxTokens()) !== undefined
}

/** Best-effort revoke, then clears local state regardless — mirrors disconnect_canva's own
 *  "only deletes the token file" behavior. Doesn't touch the OPFS library cache at all. */
export async function disconnect(): Promise<void> {
  const tokens = await loadDropboxTokens()
  if (tokens) {
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    }).catch(() => {})
  }
  await clearDropboxTokens()
}
