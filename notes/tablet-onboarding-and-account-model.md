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

### Where the library lives now, and where it is going (2026-08-26)

**Today:** the live library sits in the _operator's own_ OneDrive. Every connected device — his
phone, tablet and iPad — authenticates as the account that owns it, so `/me/drive/root:/…` resolves
trivially. This configuration exercises none of the shared-folder concerns below.

**Intended:** the pastor has created a folder in his own OneDrive and granted the operator
read/write access. The app has **not** been pointed at it yet.

The gap between those two is the whole risk. The setup that works today tells us nothing about the
setup that is planned, because the planned one is precisely the untested case: a device
authenticating as a _shared-with_ user rather than the owner. Connecting a tablet to the pastor's
folder is therefore not merely a test — it is the migration itself, and it is the step that fails if
colon-path addressing will not traverse a shared shortcut.

**Do not test by moving the real library.** It is live data with a prior wipe incident behind it
(see the operator's standing caution about writes to it). Have the pastor share a _throwaway_ folder
with a copy of a few files, point one tablet at that, and see whether it reads and writes. That
answers both the addressing and scope questions for the cost of nothing.

Sequencing note: the **desktop is safe either way**. The Windows OneDrive client syncs a shared
folder into the local tree, so `libraryPath` keeps working as a plain filesystem path with no Graph
involved. Only tablets are exposed, so a migration could move the desktop first and the tablets only
once the above is proven.

Operational risk, distinct from any of the technical ones: a library living in an individual's
personal OneDrive leaves with that individual. Moving it from the operator's account to the pastor's
does not remove that exposure, it relocates it — and to the account of someone likelier to move on.
Worth weighing whether a church-controlled account is the real destination.

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

### RESULT (2026-08-26): path addressing does not reach a shared folder

Run against the pastor's shared folder, signed in as the operator. Two console observations:

```
GET /v1.0/me/drive/root:/Worship%20Studio/Library:/delta   → 404 Not Found
GET /v1.0/me?$select=id                                    → 401 Unauthorized
```

**The 401 is a red herring** — a pre-existing, benign quirk, not a bad token. `fetchAccountId()` in
`providers/onedriveAuth.ts` calls `/me?$select=id` and swallows any failure (`if (!response.ok)
return 'unknown'`). The requested scope is `Files.ReadWrite offline_access`, with no `User.Read`,
which `/me` requires. So that call has presumably always 401'd, harmlessly, on every connection.

**The 404 is the real signal, and it is a 404 rather than a 401** — Graph accepted the token and
could not find the resource. So the token was valid for `Files.ReadWrite`, and this is an addressing
failure, not an auth or scope one. The suspicion in this section was correct: colon-path addressing
resolves within a single drive, and a folder shared from another account is a `remoteItem` shortcut
pointing into _the owner's_ drive. Traversal stops at the shortcut.

**Consequence: the shared-folder account model cannot work on OneDrive as the provider stands.**
Section 4's rework is no longer contingent — it is the plan. Graph URLs must be rebased from
`/me/drive/root:/…` onto `/drives/{driveId}/items/{itemId}:/…`, with the ids resolved once at
connect time (via `sharedWithMe`, or as a by-product of the folder picker).

**This is bigger than the pastor's folder.** The blocker is not "the library is in the wrong
account" — it is that _any_ OneDrive user reaching the library through a share hits it. Relocating
the library changes nothing: whoever does not own it is the one who cannot connect. So today's
working setup works only because the operator owns the folder, and the moment the pastor (or any
volunteer) connects a tablet as themselves, they get the same 404 no matter whose account holds it.

That leaves three options until the provider work is done, and they should be weighed explicitly:

1. **Everyone signs in as one account.** Works today, at the cost of the shared password and no
   per-person revocation — the model this section set out to avoid.
2. **Move to Dropbox.** Its shared folders mount inside each member's own tree, so path addressing
   works for a member using their own account. Believed to work today; not yet verified on a real
   second account, and worth testing the same way before betting on it.
3. **Do the addressing rework.** Contained (one helper, ~6 call sites) but drags in the scope
   question and a folder-resolution step, so it is real work rather than a patch.

**Still unresolved: the scope.** Nothing yet has touched another drive, so `Files.ReadWrite` has not
been tested across drive boundaries. `sharedWithMe` and `/drives/{otherDriveId}/…` generally want
`Files.Read.All` / `Files.ReadWrite.All`. Expect widening, and a heavier consent screen.

**Mundane cause RULED OUT (2026-08-26).** Explorer shows `Worship Studio` sitting in the operator's
OneDrive carrying the shortcut-arrow overlay and the shared-folder icon — so it is present, at
exactly the path that was tested, and it is a `remoteItem` shortcut rather than a real folder in his
drive. Path, name and presence are all correct, and Graph still 404s. The conclusion holds.

(Note for anyone reading logs later: the same drive also contains a separate `WorshipStudio` folder,
no space, which is the operator's _own_ copy. Two near-identical names, one shared and one owned —
easy to confuse when diagnosing.)

**One loose end, unlikely to matter:** a **new app registration** was created for this test and may
be misconfigured. It must be the
**SPA** platform type (not Web — a Web registration expects a client secret and would fail CORS),
its redirect URI must match `origin + pathname` exactly including the trailing slash, and its
supported-account-types must admit the account being used. A misconfiguration of this kind would
normally break at the authorize or token step rather than produce a 404 on an accepted token, so
it does not explain what was seen — but it is worth confirming rather than assuming.

### Side finding: `/me` is called without the scope for it

`fetchAccountId()` will always return `'unknown'` unless `User.Read` is added to `SCOPE`. Whatever
account-identity tracking it was meant to provide is therefore not happening, and it emits an
alarming-looking 401 in the console on every connection. Either add the scope or stop making the
call — but note that adding `User.Read` widens consent, so "stop calling it" is likely the better
fix unless the account id is actually needed.

### What the test was, and why it was shaped this way

It answers both unknowns at once — whether Graph's colon-path addressing traverses an
"Add shortcut to My files" shortcut (suspected not: the shortcut is a `remoteItem` pointing into
another drive, and path addressing works within a single drive), and whether `Files.ReadWrite.All`
is required, which the consent screen says immediately.

The target already exists: a copy of the library has been placed in the pastor's shared folder via
the desktop OneDrive client. Nothing needs to be moved to run this.

**Run it in a separate browser profile, not on a tablet and not in the everyday browser.** The
cloud-connect path is not gated to tablets — it sits behind "Advanced: First Device Setup" in
BootGate's chooser and builds the same tablet adapter in any browser. A separate profile gives an
empty OPFS, isolated localStorage and tokens, a real keyboard, and a clean delete afterwards.

Why not the existing devices:

- The operator's browser and all three tablets are connected to the **real** library. Storage is
  per-origin _per profile_, so reusing any of them means reusing that OPFS cache.
- `disconnectCloud` only revokes tokens — it does **not** clear the OPFS cache or the stored folder
  path, then reloads. So repointing a connected device leaves it holding a full local cache of the
  real library. The hazardous moment is not the test but reconnecting that device _back_ afterwards
  with foreign state still cached.

Steps:

1. New browser profile (or a different browser). Not the everyday one.
2. Open the Pages app; chooser → **Advanced: First Device Setup** → **Connect OneDrive**.
3. Client ID: read it out of the already-connected browser via Settings → Library & Sync → **Add
   Another Device**, whose connect code contains it. No need to visit the Azure portal.
4. Folder path: the pastor's folder **as it appears in the operator's own drive** — wherever "Add
   shortcut to My files" placed it — not the path the pastor sees.
5. Sign in as the operator, not the pastor. Signing in as the owner would prove nothing, since that
   is the configuration that already works.
6. Record what the consent screen asks for, whether the initial pull succeeds, and whether an edit
   made in the app appears in the pastor's folder.
7. Delete the profile. The real connection was never touched.

Blast radius if the path is wrong: reading the sync engine, the push phase iterates tracked dirty
entries and tombstones from `dirtyTrackingRoot`, not a local-vs-remote diff, so a device with empty
local state has nothing to push and nothing to delete; pull deliberately does not delete local files
either. The realistic worst case is the throwaway profile downloading the real library. Worth
confirming rather than trusting, but it is not the shape of the earlier wipe.

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

## 4a. IMPLEMENTED AND VERIFIED (2026-08-26)

The addressing rework below was built and confirmed working against real Graph: connected from a
local dev origin, signed in as the _shared-with_ operator (not the folder's owner), against the
pastor's shared folder — and it pulled the library down.

That closes the central question of section 1. **The shared-folder account model works.** Each
person can sign in as themselves, access granted and revoked by sharing the folder, no password
handed around.

What shipped:

- `providers/onedriveLibraryRoot.ts` resolves the configured folder to a `{driveId, itemId}` anchor:
  `/me/drive/root:/{path}` first for the owner's case, falling back to `sharedWithMe` and
  traversing the remainder inside the owner's drive.
- `itemPath()` rebased onto that anchor, so all call sites work unchanged. `fullPath()` is gone —
  paths already arrive library-relative.
- `relativePathFromItem()` now strips the resolved _owner-side_ prefix, since delta entries describe
  parents in the owning drive's terms rather than the signed-in user's.
- An empty `libraryFolderPath` is now a hard error rather than defaulting to the drive root, per the
  root-cannot-be-shared constraint in section 1.
- Scope widened to `Files.ReadWrite.All` (see 4b).

**Writes confirmed too (2026-08-26).** The pull path was verified first; a subsequent edit made in
the app landed in the pastor's folder, so upload works against another account's drive on the same
anchor. Delete and eTag-conflict handling have not been exercised deliberately, but they address
through the identical helper, so the remaining risk is small rather than structural.

**Deployment consequence:** the scope change means Microsoft will not hand back a broader grant than
was originally consented, so **every currently-connected device must sign in again** once this
ships. Silent reauth fails first, so they surface as "needs reconnect" rather than breaking quietly.

## 4c. The folder picker — BUILT (2026-08-26)

Section 4's sketch is implemented and confirmed working. The connect form now asks only for the
client ID; after sign-in the operator browses their OneDrive and picks the library folder.

What it stores is `driveId` + `itemId`, not a path — ids survive a rename or a move, cannot be
mistyped, and identify a shared folder unambiguously where a path cannot. Path resolution is kept
as a fallback so connections predating the picker keep working. Dropbox is untouched and keeps its
path field, since its shared folders mount inside each member's own tree.

### Two Graph behaviours worth remembering, both found the hard way

**`$select` strips nested facets.** The listing calls originally narrowed with
`$select=id,name,folder,specialFolder,parentReference,remoteItem`, and both `specialFolder` and
`remoteItem.shared` came back _absent_ — so nothing was filtered and nothing was labelled. Folder
listings are small; take the full default payload rather than narrowing it.

**Neither `specialFolder` nor `remoteItem.shared` appears in these payloads at all**, even
unnarrowed — verified against a real response. Two successive attempts keyed off those facets and
could never have fired. What the real payload does provide:

- **Personal Vault** is a separate drive belonging to the _same_ account, so it arrives with a
  `remoteItem` exactly like a share. It is identified by `remoteItem.sharepointIds.siteUrl` ending
  in the account's own `parentReference.driveId` — a same-owner test, not a facet test. It is
  dropped: it stays sealed and can never hold a library.
- **"Shared with you"** comes from membership in `/me/drive/sharedWithMe`, keyed by
  `driveId/itemId`. That endpoint exists to answer exactly this question; the per-item facets do
  not. Folders _inside_ an opened share are deliberately not labelled — the sharing happened at the
  folder above.

The picker also validates the pick (`library-settings.json` present) and warns without blocking,
mirroring the Setup Wizard's equivalent check.

## 4. Sketch: what the picker would actually take

Written before the section 1 test has run, so the shared-item half is contingent on it. The
owner-only half holds either way.

### Graph calls

Listing is two sources that have to be merged in the UI but are addressed differently:

- **The user's own folders.** `GET /me/drive/root/children?$select=id,name,folder,parentReference`,
  then navigate with `GET /me/drive/items/{itemId}/children`. Filter client-side for items carrying
  a `folder` facet — Graph's `$filter` support on that facet is not dependable.
- **Folders shared with them.** `GET /me/drive/sharedWithMe`, which returns items carrying a
  `remoteItem` facet. The real coordinates are `remoteItem.parentReference.driveId` and
  `remoteItem.id`, _not_ the wrapper item's own id. Browsing into one is
  `GET /drives/{driveId}/items/{itemId}/children`.

Both listings paginate via `@odata.nextLink`.

`/me/drive/sharedWithMe` needs `Files.Read.All` or `Files.ReadWrite.All`. So if the scope question
in section 1 resolves badly, the picker can only ever show the user's own folders — which defeats
its purpose for everyone except the library's owner. **The picker and the shared-folder account
model stand or fall together.**

### What selection produces, and how addressing changes

A picked folder yields `driveId` + `itemId`, which is the stable identifier regardless of where the
folder sits in that user's tree or what they renamed it to.

`itemPath()` keeps its shape and only changes its base:

```
today:     /me/drive/root:/{encoded}:          (or /me/drive/root when empty)
proposed:  /drives/{driveId}/items/{itemId}:/{encoded}:   (or the bare base when empty)
```

Graph accepts colon-path addressing relative to an item id, so every existing call site keeps
working unchanged — this really is a one-helper change plus somewhere to keep the base.

### Storage

`MachineSettings.tabletCloudLibraryFolderPath` stops being sufficient. OneDrive needs the drive and
item ids; Dropbox still works by path. Rather than bolt two OneDrive-shaped fields onto a shared
name, this is the point to make the stored location provider-shaped — a small discriminated value
whose meaning each provider owns.

### Provider abstraction

Browsing is provider-specific (Dropbox lists with `/2/files/list_folder` by path), so the picker
should not talk to Graph directly. It wants a `browseFolders(parentRef?) → { id, name, ref }[]`
capability on the provider interface, in the same spirit as the existing `authFor()` unification.
That keeps BootGate's picker screen provider-agnostic and gives Dropbox the same benefit.

### Flow change in BootGate

The picker has to run _after_ sign-in, which is the real restructuring:

```
today:     cloud-connect (client ID + folder path) → connecting-cloud → initial-sync
proposed:  cloud-connect (client ID only) → connecting-cloud → choose-folder → initial-sync
```

A `choose-folder` phase slots between the token exchange and the initial pull. The connect form
loses its folder field entirely — and with it the "leave blank for the account root" hint that
section 1 says should not exist.

One ordering wrinkle: `createTabletAdapter()` currently wants the library location at construction,
but the picker needs authenticated calls _before_ that location is known. The picker should use
`authFor(provider)`'s token with plain fetches rather than a constructed adapter, and the adapter
gets built once a folder has been chosen.

### Worth doing while there

Validate the pick — `GET {base}:/library-settings.json` returning 200 means it really is a library.
Warn rather than block, mirroring the Setup Wizard's "this folder does not contain a library yet"
check in [notes/setup-wizard-join-plan.md](setup-wizard-join-plan.md).

## 4b. Permission scope: why `Files.ReadWrite.All`, and what to revisit

Decided 2026-08-26: go with `Files.ReadWrite.All` first and prove the shared-folder path, rather
than optimise the permission before knowing the approach works.

It is broader than this app needs, and the consent screen says so out loud — "have full access to
all files user can access" is what the pastor and every volunteer will be asked to approve for an
app that only wants one folder. Worth revisiting, but not worth blocking on.

What else Entra offers, and why each was set aside:

| Scope                               | Verdict                                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `Files.ReadWrite`                   | Proven insufficient — own drive only, 404s on a shared folder.                                           |
| `Files.ReadWrite.AppFolder`         | Only an app-created folder; cannot reach an existing library.                                            |
| `Files.SelectedOperations.Selected` | **Requires admin consent**, so unusable on a personal account and needs IT involvement in a work tenant. |
| `Files.ReadWrite.Selected`          | The interesting one — see below.                                                                         |
| `Files.ReadWrite.All`               | Chosen. Broad, but consentable without an admin and known to reach shared folders.                       |

`Files.ReadWrite.Selected` is conceptually exactly right — access to just the folder the user chose
— and would pair naturally with section 4's folder picker, making the picker both the interface and
the permission grant. Three reasons it is not the first move:

- It is built around Microsoft's own File Picker SDK; the grant attaches to items selected _through
  that picker_, so requesting the scope alone leaves nothing addressable. Adopting it means adopting
  the SDK, not changing a string.
- It has been in preview for years.
- The blocking unknown: whether **`/delta` on a folder** works under a selected-item grant. The
  whole sync engine is built on that feed, plus upload sessions and eTag conditionals. If delta is
  unavailable the scope cannot be used here at all, however well it fits conceptually.

Cheap to settle whenever it comes up: the scope is one constant in `providers/onedriveAuth.ts`.
Register `Files.ReadWrite.Selected`, connect, and see whether the delta call returns or 403s.

## 4d. Removed: the QR connect-code flow (2026-08-26)

Deleted, along with `utils/connectCode.ts`, BootGate's `show-connect-code` phase and
`?connectCode=` handling, and the QR image in Add Another Device. Recorded here because the
platform findings behind it were expensive and would otherwise be rediscovered by whoever next asks
"why not just scan a QR?"

### Why it went

The connect code carried provider, client ID and library folder path. Once the folder picker landed
the path became meaningless — a shared folder has no path worth transferring — leaving the whole
apparatus (QR image, `?connectCode=` URL, Safari landing page, `isStandalone` branching, code
format, parser, paste field) in service of moving **one GUID**.

Emailing the client ID beats it on every axis that matters: it reaches the device directly, works
remotely so nobody has to stand next to a configured tablet, needs no camera or second screen, and
skips the Safari-to-PWA detour entirely — which is what made iPad onboarding feel broken. Its one
remaining advantage was in-person onboarding with no email, where the fallback is pasting into the
client ID field that already exists.

### The platform findings, worth keeping

These are why the flow was as convoluted as it was. None of them has stopped being true:

- **iOS cannot route a scanned link into an installed PWA.** It always opens a plain Safari tab,
  which is a _separate storage partition_ from the installed app. Anything authenticated or cached
  there is invisible to the PWA, so auto-connecting from that tab completed the whole OAuth + sync
  flow into storage the app would never see. That is why the landing page only ever displayed a code
  to copy.
- **Android is different**, and its link capturing often opens the installed PWA directly, where
  there is no partition problem — which is why the flow branched on `isStandalone` rather than
  behaving uniformly.
- **In-app camera scanning is not an option on iOS.** Scanning a live video feed inside an installed
  PWA hits an unresolved WebKit bug where the video element never renders a frame
  (bugs.webkit.org #252465). This is why the OS camera app plus copy/paste was the only workable
  route.
- **A plain-text QR is useless on iOS.** Confirmed on a real device: the camera offers only "Search
  the web for …", with no copy affordance. Only a real `https://` link reliably gets "Open in
  Safari", which is why the QR wrapped the code in a URL despite the code itself being plain text.

### What replaced it

Devices now connect by choosing OneDrive, pasting a client ID (emailed, or copied from Settings on
any device that has it), signing in, and picking the folder from a list. Add Another Device is
reduced to showing that client ID with a Copy button — and now reads the church-wide value from
`LibraryCredentials`, so a _desktop_ can show it too, which is where the value is most likely to be
fetched from. That also finally puts the previously-dead credential fields (section 2) to use.

`utils/qrCode.ts` is untouched — it belongs to the QR **slides** feature and has nothing to do with
device onboarding.

## 4e. Documentation this creates a need for (flagged 2026-08-26)

To be folded into the larger docs refresh rather than written piecemeal — see
[notes/setup-wizard-join-plan.md](setup-wizard-join-plan.md)'s own documentation note. Recording it
here so the requirement is not lost between now and then. None of the following is currently
documented anywhere, and none of it is guessable by a church setting this up fresh:

- **Registering the cloud app.** A Microsoft Entra app registration is a hard prerequisite and
  nothing in the product explains it. It must be the **SPA** platform type — not Web, which expects
  a client secret and fails CORS from a browser — needs `Files.ReadWrite.All` as a _delegated_
  permission, and its redirect URI must match the app's `origin + pathname` exactly, trailing slash
  included. The Dropbox equivalent needs the same treatment, including its development-mode cap of
  roughly 50 linked users and what production approval involves.
- **Adding a device**, in its current shape: open the app, choose the provider, paste the church's
  app ID (from Settings → Library & Sync → Add Another Device, or emailed), sign in, pick the
  library folder from the list. Any QR/connect-code instructions are obsolete — see 4d.
- **The sharing model.** The library must be a _folder_, never the drive root, since a root cannot
  be shared. Each person gets access by having that folder shared with them and signs in as
  themselves; there is no shared password.
- **Installing the PWA first on iOS**, still a real prerequisite and still not obvious.
- **That every existing device must sign in again** after the scope widened to
  `Files.ReadWrite.All`.

## 5. Adjacent finding: "Clear Existing Data" is more dangerous than it reads

Found while working out a safe way to run the section 1 test, and not really an onboarding concern —
recorded here because it is live today and should not be lost.

**It deletes library content, not a local cache.** `deleteAllLibraryContent()` walks the stores and
calls `remove()` on every song, service, person, theme, collection, service type, template, role and
role group, then `clearExistingData()` removes all media on top. Those removes go through the
adapter into the library itself.

**The deletion propagates.** On a tablet, each remove writes into the tracked OPFS root, the dirty
tracker records a tombstone, and the next sync pushes the delete to the cloud. On a desktop pointed
at a OneDrive- or Dropbox-synced folder, the desktop client does the same thing. So in essentially
every real deployment this button does not clear "this device" — it clears **the church's library,
everywhere**. That is the shape of the wipe incident already in this project's history.

The confirmation does not say so:

> "This permanently deletes ALL songs, services, people, themes, media, service types, collections,
> role categories, and service templates in this library. This cannot be undone — make sure this
> library is not currently in use before doing this."

It is appropriately alarming about permanence, but "in this library" reads to most people as _this
device's copy_, and "not currently in use" sounds like a warning about concurrent editing rather
than about propagation. Nothing states that every other device will lose the same data on its next
sync.

Worth considering:

- Say the propagation out loud whenever the library is cloud-backed — naming the other devices, or
  at least "every device syncing this library."
- The confirmation is the same regardless of context. A library that is demonstrably shared (a
  tablet, or a desktop whose `libraryPath` sits under a cloud folder) has a much higher blast radius
  than a portable single-machine install, and could warrant a stricter gate.
- Its neighbours in Data Tools are recoverable (Load Sample Data, Add Stock Backgrounds). This one
  is not, and sits in the same visual group.

Not scoped or scheduled — this note only records that it was found.

## Open questions

- The empirical shared-folder test above. Everything in section 1 is provisional until it runs.
- Whether Dropbox should get the same picker treatment at the same time. Its path addressing works
  for shared folders, so it is less urgent, but members can still move or rename them.
- Whether any of this lands before 0.9.0 or after. It is currently the largest open question in
  front of that milestone, and larger than the documentation gate it sits behind.
