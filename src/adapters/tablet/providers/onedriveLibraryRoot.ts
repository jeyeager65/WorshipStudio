/**
 * Resolves the configured library folder to a concrete Microsoft Graph anchor, so the rest of the
 * OneDrive provider can address files without caring whose drive they actually live in.
 *
 * Why this exists: Graph's colon-path addressing (`/me/drive/root:/Some/Path:`) resolves only
 * within a *single* drive. A folder shared from another account is not really in the signed-in
 * user's drive — "Add shortcut to My files" leaves a `remoteItem` shortcut pointing into the
 * owner's drive — so path traversal stops dead at the shortcut. Confirmed against a real shared
 * library: `GET /me/drive/root:/Worship Studio/Library:/delta` returned 404 with a perfectly valid
 * token. See notes/tablet-onboarding-and-account-model.md.
 *
 * That mattered far beyond one folder: *whoever does not own the library* hits it, so multi-person
 * use was impossible no matter which account held the files. Anchoring on `{driveId, itemId}`
 * instead makes the owned and shared cases identical, since both end up addressed as
 * `/drives/{driveId}/items/{itemId}`.
 */

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

export interface OneDriveLibraryRoot {
  /** Graph URL segment addressing the library folder itself, e.g.
   *  `/drives/b!abc/items/01XYZ`. Append `:/relative/path:` to reach anything inside it. */
  base: string
  /** The folder's own path as its *owning* drive reports it, e.g.
   *  `/drives/b!abc/root:/Worship Studio/Library`. Delta entries describe their parents in the
   *  owner's terms, so this is the prefix that has to come off to get a library-relative path —
   *  it is not necessarily what the signed-in user sees, and for a shared folder it usually isn't. */
  ownerPathPrefix: string
}

interface ResolvedItem {
  id?: string
  name?: string
  parentReference?: { driveId?: string; path?: string }
}

interface SharedItem {
  name?: string
  remoteItem?: { id?: string; parentReference?: { driveId?: string } }
}

function encodePath(path: string): string {
  return path.split('/').filter(Boolean).map(encodeURIComponent).join('/')
}

async function getJson<T>(token: string, url: string): Promise<T | undefined> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) return undefined
  return (await response.json()) as T
}

function rootFrom(item: ResolvedItem): OneDriveLibraryRoot | undefined {
  const driveId = item.parentReference?.driveId
  const parentPath = item.parentReference?.path
  if (!item.id || !driveId || !item.name || !parentPath) return undefined
  return {
    base: `/drives/${driveId}/items/${item.id}`,
    // parentReference.path already carries the `/drives/{id}/root:` prefix, so appending the
    // folder's own name yields the full owner-side path of the library folder itself.
    ownerPathPrefix: `${parentPath}/${item.name}`,
  }
}

const ITEM_SELECT = '$select=id,name,parentReference'

/** Resolves straight from a folder the operator picked, which already carries its own coordinates.
 *
 *  The one metadata read is for `ownerPathPrefix`: delta entries describe their parent in the
 *  owning drive's terms, and only the item itself can say what that is. Preferred over the
 *  path-based route below — picking cannot be misspelled, and a folder that is later renamed or
 *  moved keeps working, because ids do not change when paths do. */
export async function resolvePickedLibraryRoot(
  token: string,
  driveId: string,
  itemId: string,
): Promise<OneDriveLibraryRoot> {
  const item = await getJson<ResolvedItem>(
    token,
    `${GRAPH_BASE}/drives/${driveId}/items/${itemId}?${ITEM_SELECT}`,
  )
  const root = item && rootFrom(item)
  if (!root) {
    throw new Error(
      'That library folder could not be opened. It may have been deleted, or no longer shared with this account.',
    )
  }
  return root
}

/**
 * Finds the library folder from a typed path, trying the cheap case first.
 *
 * The fallback for connections made before folders were picked from a list, and for anything that
 * still supplies a path. An empty path is rejected rather than defaulting to the drive root: a
 * library at the root of an account can never be shared with anyone — OneDrive shares folders, not
 * whole drives — so accepting it would strand whoever later tried to add a second person.
 */
export async function resolveLibraryRoot(
  token: string,
  libraryFolderPath: string,
): Promise<OneDriveLibraryRoot> {
  const path = libraryFolderPath.trim().replace(/^\/+|\/+$/g, '')
  if (!path) {
    throw new Error(
      'A library folder is required — OneDrive cannot share the root of an account, so a library there could never be reached by anyone else.',
    )
  }

  // 1. The signed-in account owns it. One request, and the common case for whoever set it up.
  const owned = await getJson<ResolvedItem>(
    token,
    `${GRAPH_BASE}/me/drive/root:/${encodePath(path)}?${ITEM_SELECT}`,
  )
  const ownedRoot = owned && rootFrom(owned)
  if (ownedRoot) return ownedRoot

  // 2. Otherwise it is shared with them. Only the *first* segment can be the shared entry point —
  //    that is the folder the owner actually shared — so match it against sharedWithMe by name and
  //    traverse whatever remains inside the owner's drive.
  const segments = path.split('/').filter(Boolean)
  const [shareName, ...rest] = segments
  const shared = await getJson<{ value?: SharedItem[] }>(
    token,
    `${GRAPH_BASE}/me/drive/sharedWithMe`,
  )
  const match = shared?.value?.find((item) => item.name === shareName)
  const driveId = match?.remoteItem?.parentReference?.driveId
  const itemId = match?.remoteItem?.id
  if (!driveId || !itemId) {
    throw new Error(
      `Could not find a OneDrive folder named "${shareName}". Check the folder path, and if it belongs to someone else make sure it is still shared with you.`,
    )
  }

  const target = rest.length
    ? await getJson<ResolvedItem>(
        token,
        `${GRAPH_BASE}/drives/${driveId}/items/${itemId}:/${encodePath(rest.join('/'))}?${ITEM_SELECT}`,
      )
    : await getJson<ResolvedItem>(
        token,
        `${GRAPH_BASE}/drives/${driveId}/items/${itemId}?${ITEM_SELECT}`,
      )

  const root = target && rootFrom(target)
  if (!root) {
    throw new Error(
      `Found the shared folder "${shareName}", but not "${path}" inside it. Check the rest of the folder path.`,
    )
  }
  return root
}

/** One folder offered by the picker. `driveId`/`itemId` are the same coordinates
 *  resolvePickedLibraryRoot takes, so choosing an entry needs no further lookup. */
export interface OneDriveFolderEntry {
  name: string
  driveId: string
  itemId: string
  /** Shared from another account rather than owned by the signed-in one — worth showing, since
   *  it is usually how a volunteer reaches the church's library. */
  shared: boolean
}

interface ChildItem {
  id?: string
  name?: string
  folder?: unknown
  parentReference?: { driveId?: string }
  remoteItem?: {
    id?: string
    parentReference?: { driveId?: string }
    folder?: unknown
    /** Identifies which account's storage the remote item really lives in — the only reliable
     *  same-owner signal in the payloads Graph actually returns here. */
    sharepointIds?: { siteUrl?: string }
  }
}

/** Personal Vault sits in a different drive from the rest of the account, so it arrives carrying a
 *  `remoteItem` exactly like a genuinely shared folder. It can never hold a library — it stays
 *  sealed and Graph cannot read through it — so it is dropped rather than shown.
 *
 *  Detected by *owner*, not by facet. A real payload confirmed the vault carries no `specialFolder`
 *  facet and no `remoteItem.shared` (two earlier attempts keyed off those and could never have
 *  fired). What it does carry is `remoteItem.sharepointIds.siteUrl` ending in the account's own
 *  drive id — the vault is a different drive belonging to the *same* person, which is precisely
 *  what a share is not. */
function isSameOwnerRemote(item: ChildItem): boolean {
  const ownDriveId = item.parentReference?.driveId?.toLowerCase()
  const siteUrl = item.remoteItem?.sharepointIds?.siteUrl?.toLowerCase()
  if (!ownDriveId || !siteUrl) return false
  return siteUrl.includes(`/personal/${ownDriveId}`)
}

function toFolderEntry(item: ChildItem, sharedKeys: Set<string>): OneDriveFolderEntry | undefined {
  if (isSameOwnerRemote(item)) return undefined

  // A shared entry describes the real folder under `remoteItem`, pointing into the owner's drive;
  // the wrapper item's own id belongs to the shortcut and cannot be addressed for content.
  const remote = item.remoteItem
  if (remote) {
    if (!remote.folder || !remote.id || !remote.parentReference?.driveId || !item.name)
      return undefined
    const driveId = remote.parentReference.driveId
    return {
      name: item.name,
      driveId,
      itemId: remote.id,
      // sharedWithMe is the authority on what is actually shared — the item's own facets are not
      // dependable here, and this endpoint exists precisely to answer this question.
      shared: sharedKeys.has(`${driveId}/${remote.id}`),
    }
  }
  if (!item.folder || !item.id || !item.parentReference?.driveId || !item.name) return undefined
  return { name: item.name, driveId: item.parentReference.driveId, itemId: item.id, shared: false }
}

/** `{driveId}/{itemId}` for everything sharedWithMe reports, which is what makes the "Shared with
 *  you" label trustworthy regardless of which listing an entry came from. */
function sharedKeysFrom(shared: ChildItem[]): Set<string> {
  const keys = new Set<string>()
  for (const item of shared) {
    const driveId = item.remoteItem?.parentReference?.driveId
    const itemId = item.remoteItem?.id
    if (driveId && itemId) keys.add(`${driveId}/${itemId}`)
  }
  return keys
}

/** Deliberately no `$select` on the two listing calls below.
 *
 *  Narrowing it stripped the very facets the picker depends on: `specialFolder` (what identifies
 *  Personal Vault) and `remoteItem.shared` (what identifies a real share) both came back absent,
 *  so nothing was filtered and nothing was labelled. Graph is unreliable about nested facets under
 *  `$select`, and folder listings are small, so taking the full default payload is both simpler and
 *  correct. */
const CHILD_QUERY = ''

async function collectPages(token: string, firstUrl: string): Promise<ChildItem[]> {
  const items: ChildItem[] = []
  interface Page {
    value?: ChildItem[]
    '@odata.nextLink'?: string
  }
  let url: string | undefined = firstUrl
  while (url) {
    const body: Page | undefined = await getJson<Page>(token, url)
    if (!body) break
    items.push(...(body.value ?? []))
    url = body['@odata.nextLink']
  }
  return items
}

/** The picker's top level: the account's own root folders, plus everything shared with it.
 *
 *  Two sources because they are addressed differently and neither alone is sufficient — the owner
 *  of the library sees it in the first, everyone else in the second. Merged and sorted so the
 *  operator does not have to know which they are. */
export async function listLibraryFolderChoices(token: string): Promise<OneDriveFolderEntry[]> {
  const [own, shared] = await Promise.all([
    collectPages(token, `${GRAPH_BASE}/me/drive/root/children${CHILD_QUERY}`),
    collectPages(token, `${GRAPH_BASE}/me/drive/sharedWithMe`),
  ])
  const sharedKeys = sharedKeysFrom(shared)
  const entries = [...own, ...shared]
    .map((item) => toFolderEntry(item, sharedKeys))
    .filter((entry): entry is OneDriveFolderEntry => Boolean(entry))
  // sharedWithMe can repeat something already visible as an "Add shortcut to My files" entry in
  // the account's own root — same folder, same coordinates, listed twice.
  const seen = new Set<string>()
  return entries
    .filter((entry) => {
      const key = `${entry.driveId}/${entry.itemId}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Folders inside one already-listed folder, for drilling down. Stays within the same drive, which
 *  is what makes a shared folder browsable at all — its children are the owner's, not the
 *  signed-in account's. */
export async function listChildFolders(
  token: string,
  driveId: string,
  itemId: string,
): Promise<OneDriveFolderEntry[]> {
  const items = await collectPages(
    token,
    `${GRAPH_BASE}/drives/${driveId}/items/${itemId}/children${CHILD_QUERY}`,
  )
  // Children of an already-opened folder are all in that same drive, so none of them is a "share"
  // in its own right — the sharing happened at the folder above.
  return items
    .map((item) => toFolderEntry(item, new Set()))
    .filter((entry): entry is OneDriveFolderEntry => Boolean(entry))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Whether a folder looks like a Worship Studio library, for warning before a wrong pick is
 *  committed to. Mirrors the Setup Wizard's own "does this folder contain a library" check. */
export async function looksLikeLibrary(
  token: string,
  driveId: string,
  itemId: string,
): Promise<boolean> {
  const item = await getJson<{ id?: string }>(
    token,
    `${GRAPH_BASE}/drives/${driveId}/items/${itemId}:/library-settings.json?$select=id`,
  )
  return Boolean(item?.id)
}
