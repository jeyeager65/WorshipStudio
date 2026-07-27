import fs from 'node:fs'
import path from 'node:path'
import { appDataDir } from '../helpers/appDataDir.js'

const PORT = 47823

describe('Remote Control confidence-monitor mirror', () => {
  it('serves live state and real media bytes over HTTP to a paired device', async () => {
    // These checks talk directly to the Rust HTTP server via Node's own fetch — not through
    // the WebdriverIO browser session at all, so there's no multi-window risk here (unlike
    // driving the presentation window). The app just needs to already be running, which it is
    // for the duration of this spec file.
    const remoteDevicesPath = path.join(appDataDir, 'remote-devices.json')
    const token = 'e2e-mirror-token'
    fs.writeFileSync(
      remoteDevicesPath,
      JSON.stringify(
        [
          {
            id: 'device-e2e-mirror',
            name: 'E2E Mirror Phone',
            accessLevel: 'full-control',
            token,
            updatedAt: '2026-07-26T00:00:00Z',
            updatedByDevice: 'e2e',
          },
        ],
        null,
        2,
      ),
    )

    // Self-contained media fixture — the isolated E2E app-data directory (see
    // helpers/appDataDir.js) starts empty on every run, so this can no longer borrow whatever
    // media file happened to already be in the library the way it once did against the real
    // profile. A real (if tiny) 1x1 PNG, not just arbitrary bytes, since the point of this
    // test is verifying an actual byte-for-byte file transfer over HTTP.
    const libraryDir = path.join(appDataDir, 'Library')
    const mediaDir = path.join(libraryDir, 'media')
    const mediaItemsDir = path.join(libraryDir, 'media-items')
    fs.mkdirSync(mediaDir, { recursive: true })
    fs.mkdirSync(mediaItemsDir, { recursive: true })

    const mediaFilename = 'e2e-mirror-fixture.png'
    const mediaFilePath = path.join(mediaDir, mediaFilename)
    const onePixelPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    )
    fs.writeFileSync(mediaFilePath, onePixelPng)

    const mediaId = 'media-e2e-mirror-fixture'
    const mediaItemPath = path.join(mediaItemsDir, `${mediaId}.json`)
    fs.writeFileSync(
      mediaItemPath,
      JSON.stringify(
        {
          id: mediaId,
          filename: mediaFilename,
          kind: 'image',
          tags: [],
          location: 'synced',
          contentHash: 'e2e-fixture',
          usage: { usesPastYear: 0 },
          updatedAt: '2026-07-26T00:00:00Z',
          updatedByDevice: 'e2e',
        },
        null,
        2,
      ),
    )

    try {
      // Unauthenticated request — no cookie at all.
      const unauthedState = await fetch(`http://127.0.0.1:${PORT}/api/state`)
      expect(unauthedState.status).toBe(401)

      // /pair sets the auth cookie for subsequent requests.
      const pairRes = await fetch(`http://127.0.0.1:${PORT}/pair?token=${token}`, { redirect: 'manual' })
      const setCookie = pairRes.headers.get('set-cookie')
      expect(setCookie).toContain(`remote_token=${token}`)
      const cookie = setCookie.split(';')[0]

      const stateRes = await fetch(`http://127.0.0.1:${PORT}/api/state`, { headers: { Cookie: cookie } })
      expect(stateRes.status).toBe(200)
      const state = await stateRes.json()
      expect(state.deviceName).toBe('E2E Mirror Phone')
      expect(state.accessLevel).toBe('full-control')

      // The real media file, served through the auth-gated /api/media/:id endpoint — this is
      // what the mirror's <img>/<video> actually points at, since a convertFileSrc URL (what
      // the operator window itself uses) means nothing off-device.
      const mediaRes = await fetch(`http://127.0.0.1:${PORT}/api/media/${mediaId}`, { headers: { Cookie: cookie } })
      expect(mediaRes.status).toBe(200)
      const contentType = mediaRes.headers.get('content-type')
      expect(contentType).toMatch(/^image\//)
      const bytes = await mediaRes.arrayBuffer()
      expect(bytes.byteLength).toBeGreaterThan(0)

      // A revoked/unknown media id doesn't leak a different error shape.
      const missingRes = await fetch(`http://127.0.0.1:${PORT}/api/media/not-a-real-id`, { headers: { Cookie: cookie } })
      expect(missingRes.status).toBe(404)

      // The served index page is the real mirror UI, not the old plain-text banner.
      const pageRes = await fetch(`http://127.0.0.1:${PORT}/`)
      const html = await pageRes.text()
      expect(html).toContain('mirror-wrap')
      expect(html).toContain('renderMirror')
    } finally {
      if (fs.existsSync(remoteDevicesPath)) fs.writeFileSync(remoteDevicesPath, '[]')
      if (fs.existsSync(mediaFilePath)) fs.unlinkSync(mediaFilePath)
      if (fs.existsSync(mediaItemPath)) fs.unlinkSync(mediaItemPath)
    }
  })
})
