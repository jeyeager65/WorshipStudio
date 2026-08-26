import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listLibraryFolderChoices, resolveLibraryRoot } from '../onedriveLibraryRoot'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

function json(body: unknown, status = 200) {
  return { ok: status < 300, status, json: async () => body } as Response
}

const notFound = () => json({ error: { code: 'itemNotFound' } }, 404)

describe('resolveLibraryRoot', () => {
  it('resolves a folder the signed-in account owns in a single request', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        id: 'item-1',
        name: 'Library',
        parentReference: { driveId: 'drive-me', path: '/drives/drive-me/root:/Worship Studio' },
      }),
    )

    const root = await resolveLibraryRoot('token', 'Worship Studio/Library')

    expect(root).toEqual({
      base: '/drives/drive-me/items/item-1',
      ownerPathPrefix: '/drives/drive-me/root:/Worship Studio/Library',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toContain(
      '/me/drive/root:/Worship%20Studio/Library?$select=',
    )
  })

  it('falls back to sharedWithMe and traverses the rest of the path', async () => {
    // The case the whole module exists for: "Worship Studio" is an Add-shortcut-to-My-files entry
    // pointing into the *owner's* drive, so path addressing from /me/drive/root 404s.
    fetchMock
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(
        json({
          value: [
            {
              name: 'Someone Else Folder',
              remoteItem: { id: 'x', parentReference: { driveId: 'd0' } },
            },
            {
              name: 'Worship Studio',
              remoteItem: { id: 'share-1', parentReference: { driveId: 'drive-pastor' } },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        json({
          id: 'item-lib',
          name: 'Library',
          parentReference: {
            driveId: 'drive-pastor',
            path: '/drives/drive-pastor/root:/Worship Studio',
          },
        }),
      )

    const root = await resolveLibraryRoot('token', 'Worship Studio/Library')

    expect(root).toEqual({
      base: '/drives/drive-pastor/items/item-lib',
      ownerPathPrefix: '/drives/drive-pastor/root:/Worship Studio/Library',
    })
    // The traversal addresses the remainder relative to the shared item, not from any drive root.
    expect(fetchMock.mock.calls[2]![0]).toContain('/drives/drive-pastor/items/share-1:/Library?')
  })

  it('handles a shared folder that is itself the library, with nothing beneath it', async () => {
    fetchMock
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(
        json({
          value: [
            {
              name: 'Library',
              remoteItem: { id: 'share-2', parentReference: { driveId: 'drive-pastor' } },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        json({
          id: 'share-2',
          name: 'Library',
          parentReference: { driveId: 'drive-pastor', path: '/drives/drive-pastor/root:' },
        }),
      )

    const root = await resolveLibraryRoot('token', 'Library')

    expect(root.base).toBe('/drives/drive-pastor/items/share-2')
    expect(root.ownerPathPrefix).toBe('/drives/drive-pastor/root:/Library')
  })

  it('refuses an empty path rather than defaulting to the drive root', async () => {
    // A library at the account root can never be shared — OneDrive shares folders, not drives — so
    // accepting this would strand anyone who tried to add a second person later.
    await expect(resolveLibraryRoot('token', '')).rejects.toThrow(/library folder is required/i)
    await expect(resolveLibraryRoot('token', '  /  ')).rejects.toThrow(
      /library folder is required/i,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('names the folder it could not find when nothing matches', async () => {
    fetchMock.mockResolvedValueOnce(notFound()).mockResolvedValueOnce(json({ value: [] }))

    await expect(resolveLibraryRoot('token', 'Missing Folder/Library')).rejects.toThrow(
      /"Missing Folder"/,
    )
  })

  it('distinguishes "share found, inner path wrong" from "no such share"', async () => {
    fetchMock
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(
        json({
          value: [
            {
              name: 'Worship Studio',
              remoteItem: { id: 'share-1', parentReference: { driveId: 'd1' } },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(notFound())

    await expect(resolveLibraryRoot('token', 'Worship Studio/Nope')).rejects.toThrow(
      /Found the shared folder "Worship Studio", but not/,
    )
  })

  it('treats an item missing driveId or parentReference as unresolved rather than building a bad URL', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: 'item-1', name: 'Library' })) // no parentReference
      .mockResolvedValueOnce(json({ value: [] }))

    await expect(resolveLibraryRoot('token', 'Library')).rejects.toThrow()
  })
})

describe('listLibraryFolderChoices', () => {
  function pages(own: unknown[], shared: unknown[]) {
    fetchMock
      .mockResolvedValueOnce(json({ value: own }))
      .mockResolvedValueOnce(json({ value: shared }))
  }

  it('merges the account’s own folders with those shared with it, sorted by name', async () => {
    pages(
      [{ id: 'o1', name: 'Zed', folder: {}, parentReference: { driveId: 'mine' } }],
      [
        {
          name: 'Alpha',
          // Note the absence of any `shared` facet — real payloads don't carry one. Appearing in
          // sharedWithMe at all is what marks this as shared.
          remoteItem: {
            id: 's1',
            folder: {},
            parentReference: { driveId: 'theirs' },
          },
        },
      ],
    )

    const entries = await listLibraryFolderChoices('token')

    expect(entries).toEqual([
      { name: 'Alpha', driveId: 'theirs', itemId: 's1', shared: true },
      { name: 'Zed', driveId: 'mine', itemId: 'o1', shared: false },
    ])
  })

  it('drops Personal Vault, which carries a remoteItem facet but is not a shared folder', async () => {
    // It is its own protected drive, so it looks exactly like a share to naive detection — it was
    // listed as "Shared with you" before this. It can never hold a library.
    pages(
      [
        {
          id: 'v1',
          name: 'Personal Vault',
          folder: {},
          parentReference: { driveId: 'MINE' },
          remoteItem: {
            id: 'v-remote',
            folder: {},
            parentReference: { driveId: 'vault-drive' },
            sharepointIds: { siteUrl: 'https://my.microsoftpersonalcontent.com/personal/mine' },
          },
        },
        { id: 'o1', name: 'Documents', folder: {}, parentReference: { driveId: 'mine' } },
      ],
      [],
    )

    const entries = await listLibraryFolderChoices('token')

    expect(entries.map((e) => e.name)).toEqual(['Documents'])
  })

  it('ignores files, keeping only folders', async () => {
    pages(
      [
        { id: 'f1', name: 'notes.txt', parentReference: { driveId: 'mine' } },
        { id: 'o1', name: 'Library', folder: {}, parentReference: { driveId: 'mine' } },
      ],
      [],
    )

    expect((await listLibraryFolderChoices('token')).map((e) => e.name)).toEqual(['Library'])
  })

  it('de-duplicates a shared folder that also appears as a shortcut in the account’s own root', async () => {
    const coords = { id: 'shared-1', folder: {}, parentReference: { driveId: 'theirs' } }
    pages(
      [{ name: 'Worship Studio', remoteItem: coords }],
      [{ name: 'Worship Studio', remoteItem: coords }],
    )

    expect(await listLibraryFolderChoices('token')).toHaveLength(1)
  })
})
