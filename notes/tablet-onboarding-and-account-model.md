# Tablet onboarding and the cloud account model

Status: working document, opened 2026-08-26. Nothing here is built yet. Written while working
through the problem rather than after deciding it, so treat later sections as more provisional than
earlier ones.

Two questions turned out to be tangled together, and they need answering in this order:

1. **Whose account does a tablet sign into?** This decides what onboarding even looks like.
2. **How does a new device get what it needs to connect?** Only answerable once (1) is settled.

## 1. The account model

The operator's expectation: **the library folder is shared with each person, so it appears in their
own OneDrive.** Each person signs in as themselves. Access is granted and revoked by sharing.

This is the right model. The alternative — everyone signs in as the church's OneDrive account —
means handing out one password to the pastor and any volunteer who wants the app on their tablet.
No per-person revocation when someone moves on, and MFA becomes unpleasant across five or six
devices. With four to six devices expected (operator's phone, tablet and iPad; the pastor's iPad;
likely others), that is not a hypothetical.

### The library must be a folder, never the drive root

You cannot share the root of a OneDrive — sharing operates on files and folders. So a library
configured as the account root can only ever be reached by sharing the account password, which is
the model being moved away from.

The current connect flow actively invites that configuration: `itemPath('')` returns
`/me/drive/root` (`adapters/tablet/providers/onedrive.ts`), and BootGate's field says _"Leave blank
if the library lives at the root of the account."_ That option should stop being offered, or at
least stop being presented as the easy default.

### What the code does today

- **OneDrive addressing is `/me/drive/root:/…`** — the _signed-in user's own_ drive. A folder shared
  to someone else's account lives under "Shared with me," which Graph addresses as
  `/drives/{driveId}/items/{itemId}`, not by path from their root.
- **Scope is `Files.ReadWrite`**, which covers the signed-in user's own files. Reaching files shared
  _with_ them generally needs `Files.ReadWrite.All` — a heavier consent prompt that can trip admin
  consent in a work tenant.
- The good news: **addressing is centralised.** Every Graph URL funnels through one `itemPath()`
  helper across about six call sites in a 332-line file. Repointing it at a resolved drive/item base
  is a contained change, not a rewrite.

**Dropbox does not have this problem.** Its shared folders mount inside each member's own tree, so
path addressing works for a member using their own account. The provider abstraction is not being
bent here — OneDrive is simply the harder of the two.

### The test that decides the scale of this

Not yet run, and worth running before anything is built:

> Share the library folder to a second Microsoft account. Sign in as that account on a tablet. See
> whether the current code can read it at all.

That answers both unknowns at once — whether Graph's colon-path addressing traverses an "Add
shortcut to My files" shortcut (suspected not: the shortcut is a `remoteItem` pointing into another
drive, and path addressing works within a single drive), and whether `Files.ReadWrite.All` is
required, which the consent screen will say immediately.

## 2. Getting a new device connected

Whichever way the account model lands, every device still needs the **client ID** — the church's own
app registration — before it can talk to the provider's API at all.

### Why the client ID cannot simply be baked in

It was considered and rejected. Technically one registration can serve many churches, each signing
into their own account. But this app is published to GitHub Pages deliberately so any church can use
it, and baking in one registration would make its owner the operator of record for all of them:
their Dropbox 50-user development cap, their publisher verification, their registration's continued
good standing all become everyone's single point of failure. A "fork it and use it" project should
not create that dependency.

The variant that survives is an _optional_ build-time override, so a church that forks and
self-hosts can bake in its own and skip connect codes entirely. Costs nothing, changes no defaults,
and only pays off if someone actually self-hosts.

### The chicken-and-egg that isn't

A tablet needs the client ID to reach the library, so it cannot read the client ID _from_ the
library. Real, and any design where a tablet self-bootstraps from the synced file is circular.

But the desktop is not subject to it. **The Tauri build has no cloud sync at all** — `libraryPath`
is a plain local filesystem path and the OneDrive desktop client does the syncing. The desktop
reaches the library as a folder, needing no client ID ever, and can read and write `credentials.json`
immediately. So the desktop can hold the value and hand it out; the tablet receives it out-of-band,
exactly as it does from a QR today.

### The church-wide credential fields already exist, and are dead

`LibraryCredentials.dropboxIntegration.appKey` and `.oneDriveIntegration.clientId` are defined in
`models/settings.ts` and documented as _"owned by the church… synced church-wide"_ — and are never
read or written by anything. No UI edits them, no Rust touches them.

That is why today's QR only works from an already-configured tablet: `addDeviceCode` falls back to
`machineSettings.tabletCloudClientId`, the device-local cache written only by `finishTabletBoot`,
and `isCloudConnected` is hard-gated to `adapterKind === 'tablet'`. The first tablet must always be
set up by hand, and a desktop can never produce a code at all.

Wiring those fields up is what makes the connect code pay off for the _first_ device rather than
only for devices 2..N.

### Transfer: email the code, not a QR

The operator's proposal, and better than the QR-proximity assumption it replaces: from the desktop,
produce the values and email them. Email is already authenticated on the recipient's device, works
remotely, and needs no physical proximity — the pastor never has to be in the same room as a
configured tablet.

**Emailing a QR image is pointless** and was dropped: the iPad cannot scan its own screen, so a QR
in a message read on that iPad is decoration. Text is what works. And the text branch is the best
path found so far — copy from Mail, open the PWA, paste — because it **skips the Safari detour
entirely**, and with it the separate-storage-partition problem that makes iPad onboarding weird.
That weirdness only exists because a scanned QR has to route through the camera and a browser.

The in-person QR keeps its place for the case where a code is displayed on one screen and scanned
with a different device.

## 3. Proposed: pick the folder instead of typing a path

Operator's idea, and it subsumes an earlier share-link proposal. Once the client ID is known and the
user has signed in, the app can **list their OneDrive folders and let them choose**, instead of
asking anyone to type a path.

This is not just nicer — it dissolves several problems at once:

- **No path typing**, and no silent failure when it is typed wrong (today the mistake only surfaces
  after a full OAuth round trip).
- **No per-user path divergence.** A shared folder sits wherever each recipient put it, under
  whatever name they kept, so a single path string in a connect code cannot be correct for everyone.
- **Picking yields the robust identifier directly.** The chosen item carries its own `driveId` and
  `itemId` — precisely the addressing shared-folder support needs. The picker _is_ the resolution
  mechanism, so no share-link round trip is needed.
- **The connect code shrinks** to provider plus client ID, with the folder question moved out of it
  entirely.
- **Root-vs-folder stops being a trap**, because the picker only offers real folders.

A picker that lists both the user's own folders and `sharedWithMe` covers the owner and every
shared-with user through one interface.

### Consequences to design around

- **Ordering changes.** The folder path is entered _before_ OAuth today; a picker must come _after_
  sign-in. BootGate gains a screen: connect first, then choose. That simplifies the connect form to
  just the client ID.
- **Listing shared items depends on the scope question** in section 1. Same test settles it.
- **Worth validating the pick.** After choosing, check the folder actually looks like a library
  (a `library-settings.json`, a `songs/` folder) and warn if not — the same reasoning as the Setup
  Wizard's "this folder does not contain a library yet" check. See
  [notes/setup-wizard-join-plan.md](setup-wizard-join-plan.md).

## Open questions

- The empirical shared-folder test above. Everything in section 1 is provisional until it runs.
- Whether Dropbox should get the same picker treatment at the same time. Its path addressing works
  for shared folders, so it is less urgent, but members can still move or rename them.
- Whether any of this lands before 0.9.0 or after. It is currently the largest open question in
  front of that milestone, and larger than the documentation gate it sits behind.
