/**
 * Shared "begin a full top-level OAuth redirect to Dropbox/OneDrive, remembering enough in
 * sessionStorage to finish the exchange when the browser navigates back" — used by both
 * BootGate.vue's own connect form (first-device / manual client-ID setup, and the OAuth-redirect
 * handler that completes it) and LibrarySyncSection.vue's Reconnect action (an already-connected
 * device recovering from a ProviderReauthRequiredError without needing to Disconnect and
 * re-enter anything first). A popup would be unreliable on mobile Safari and in installed PWAs,
 * so the whole app gets torn down and rebuilt on the way back — sessionStorage (not a
 * component-local variable) is what survives that.
 */
import * as dropbox from '@/adapters/tablet/providers/dropboxAuth'
import * as onedrive from '@/adapters/tablet/providers/onedriveAuth'

export type CloudProviderId = 'dropbox' | 'onedrive'

export const CLOUD_OAUTH_PENDING_KEY = 'worship-studio:cloud-oauth-pending'

export interface PendingCloudAuth {
  codeVerifier: string
  state: string
  provider: CloudProviderId
  clientId: string
  libraryFolderPath: string
  /** OneDrive's picked folder, carried across the redirect alongside the path.
   *
   *  A shared folder lives in someone else's drive, so a path alone cannot address it — that is
   *  the whole reason these two exist. Reconnecting used to send only the path, so returning from
   *  the provider left BootGate unable to resolve the library: it fell back to asking for a folder
   *  again and, worse, wrote `undefined` over the stored ids on the way through. Invisible on a
   *  folder in your own drive, where the path is enough; guaranteed on a shared one. */
  libraryDriveId?: string
  libraryItemId?: string
  redirectUri: string
}

/** Both provider auth modules export identically-named functions with slightly different
 *  parameter shapes (Dropbox's `appKey` vs. OneDrive's `clientId`) — this adapts each to one
 *  shared shape so every call site can stay provider-agnostic, the same way adapters/tablet/'s
 *  own CloudSyncProvider interface does for the sync engine itself. */
interface CloudAuth {
  generateCodeVerifier: () => string
  codeChallengeFromVerifier: (verifier: string) => Promise<string>
  generateState: () => string
  buildAuthorizeUrl: (p: {
    clientId: string
    redirectUri: string
    state: string
    codeChallenge: string
  }) => string
  exchangeCodeForTokens: (p: {
    clientId: string
    redirectUri: string
    code: string
    codeVerifier: string
  }) => Promise<unknown>
  isConnected: () => Promise<boolean>
}

const dropboxAuth: CloudAuth = {
  generateCodeVerifier: dropbox.generateCodeVerifier,
  codeChallengeFromVerifier: dropbox.codeChallengeFromVerifier,
  generateState: dropbox.generateState,
  buildAuthorizeUrl: ({ clientId, redirectUri, state, codeChallenge }) =>
    dropbox.buildAuthorizeUrl({ appKey: clientId, redirectUri, state, codeChallenge }),
  exchangeCodeForTokens: ({ clientId, redirectUri, code, codeVerifier }) =>
    dropbox.exchangeCodeForTokens({ appKey: clientId, redirectUri, code, codeVerifier }),
  isConnected: dropbox.isConnected,
}

const oneDriveAuth: CloudAuth = {
  generateCodeVerifier: onedrive.generateCodeVerifier,
  codeChallengeFromVerifier: onedrive.codeChallengeFromVerifier,
  generateState: onedrive.generateState,
  buildAuthorizeUrl: onedrive.buildAuthorizeUrl,
  exchangeCodeForTokens: onedrive.exchangeCodeForTokens,
  isConnected: onedrive.isConnected,
}

export function authFor(provider: CloudProviderId): CloudAuth {
  return provider === 'onedrive' ? oneDriveAuth : dropboxAuth
}

/** Generates fresh PKCE params, remembers them in sessionStorage under CLOUD_OAUTH_PENDING_KEY,
 *  and redirects the whole page to the provider's own sign-in — BootGate.vue's own onMounted is
 *  what picks the pending state back up once the browser returns with a `code`/`state`, whatever
 *  page in the app actually initiated this call. */
export async function beginCloudOAuthRedirect(
  provider: CloudProviderId,
  clientId: string,
  libraryFolderPath: string,
  picked?: { driveId: string; itemId: string },
): Promise<void> {
  const auth = authFor(provider)
  const codeVerifier = auth.generateCodeVerifier()
  const codeChallenge = await auth.codeChallengeFromVerifier(codeVerifier)
  const state = auth.generateState()
  // The redirect the provider sends the browser back to has to exactly match what's registered
  // in that provider's app console — computed from the current origin/path rather than
  // hardcoded so this works unchanged across local dev and every real deployment.
  const redirectUri = `${window.location.origin}${window.location.pathname}`
  const pending: PendingCloudAuth = {
    codeVerifier,
    state,
    provider,
    clientId,
    libraryFolderPath,
    libraryDriveId: picked?.driveId,
    libraryItemId: picked?.itemId,
    redirectUri,
  }
  sessionStorage.setItem(CLOUD_OAUTH_PENDING_KEY, JSON.stringify(pending))
  window.location.assign(auth.buildAuthorizeUrl({ clientId, redirectUri, state, codeChallenge }))
}
