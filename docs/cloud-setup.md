# Cloud Setup

::: tip Who this page is for
Two groups — one that has no choice, and one that does.

**No choice.** These can't open a folder directly, so the connection here is the only way in:

- **Any tablet or phone**, whatever browser it runs.
- **A Mac on Safari.** (Chrome and Edge on macOS *can* open a folder — see below.)

**By choice.** Opening a folder isn't really a question of which browser you have; it's a
question of whether that computer already runs the **OneDrive or Dropbox desktop app**, keeping
the folder in step. If it doesn't, connecting through the API is often the lighter option — no
sync client to install, no second copy of the account's files on that machine, nothing to
configure beyond signing in. That's a perfectly good reason to come here with Chrome or Edge in
front of you.

**If a computer already syncs the folder** and uses Chrome or Edge — on Windows, macOS or Linux —
pointing at that folder is the simpler path and needs none of this. See [Sync](/sync) for the
comparison.
:::

Devices that can't open a folder talk to Dropbox or OneDrive through the provider's API instead.
Before that can happen, someone has to register Worship Studio as an app on your church's cloud
account. That registration produces an **app ID** — a short string every device needs before it
can sign in at all.

Of the two providers, **OneDrive is the one that has actually been used against a real church
library**. The Dropbox side is implemented but untested — see its section below.

This is a **one-time job for the whole church**, done once by whoever administers the account.
Every device afterwards just pastes the resulting ID.

::: warning Why you have to do this yourself
Worship Studio is free and open source, and never sees your files or your account — there's no
Worship Studio server in the middle. That means there's no shared registration to hand out: the
app talks to *your* Dropbox or OneDrive directly, with your church's own credentials, under your
own control. The tradeoff is these one-time setup steps.
:::

## OneDrive / Microsoft 365

Works with either a personal Microsoft account or a work/school (Microsoft 365) account.

1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com) with the account
   that owns the library, and go to **Applications → App registrations → New registration**.
2. **Name** it anything you'll recognize — `Worship Studio` is fine. Nobody but you sees it.
3. Under **Supported account types**, pick whichever matches your church's account. If you're
   unsure, *Accounts in any organizational directory and personal Microsoft accounts* is the
   permissive choice and always works.
4. Under **Redirect URI**, choose **Single-page application (SPA)** from the platform dropdown
   and enter the exact address people open Worship Studio at:

   ```
   https://jeyeager65.github.io/WorshipStudio/app/
   ```

   ::: danger Two things go wrong here
   **Pick SPA, not Web.** A *Web* registration expects a client secret and will fail with a CORS
   error from a browser. SPA is the one that works with the PKCE sign-in Worship Studio uses.

   **The address must match exactly, trailing slash included.** Microsoft compares it
   character for character, and a missing `/` at the end produces a sign-in error that doesn't
   explain itself.
   :::
5. Click **Register**.
6. Go to **API permissions → Add a permission → Microsoft Graph → Delegated permissions**, add
   **`Files.ReadWrite.All`**, and remove the default `User.Read` if you like — Worship Studio
   doesn't use it.

   ::: details Why the broad-sounding permission?
   `Files.ReadWrite.All` reads as alarming, and the narrower `Files.ReadWrite` genuinely doesn't
   work here. The narrow one covers only files in the signed-in person's *own* drive. As soon as
   the library is shared from someone else's account — the normal arrangement once more than one
   person uses it — it lives in the owner's drive, and reaching it needs the broader permission.
   We confirmed this the hard way: the narrow scope returned "not found" for a folder that was
   plainly there.

   Nothing is granted to us by this. The permission is *delegated*, meaning the app can only ever
   see what the person signing in could already see for themselves, and only while they're
   signed in. On a work/school account your administrator may need to approve it once.
   :::
7. On the registration's **Overview** page, copy the **Application (client) ID**. That's your
   app ID.

## Dropbox

::: danger Not yet tested
The Dropbox connection is written but has never been exercised against the live Dropbox API.
OneDrive is the path that has actually been used against a real church library. These steps are
accurate to what the app requests, but treat them as a starting point rather than a proven
recipe — and please [report anything that doesn't work](https://github.com/jeyeager65/WorshipStudio/issues).

This applies only to the devices above connecting through the Dropbox **API**. Pointing a desktop
at a Dropbox-synced *folder* is a different thing entirely and works fine — Worship Studio just
reads and writes plain files there and never knows Dropbox is involved.
:::

1. Sign in at the [Dropbox App Console](https://www.dropbox.com/developers/apps) and choose
   **Create app**.
2. Pick **Scoped access**, then **Full Dropbox** — App folder access can't reach a library folder
   that already exists, or one shared from another account.
3. On the app's **Permissions** tab, enable `files.metadata.read`, `files.content.read`, and
   `files.content.write`, then **Submit**. Do this *before* anyone signs in — Dropbox grants
   permissions at sign-in, so anyone who connected earlier has to sign in again to pick up a
   change.
4. On the **Settings** tab, add the exact address people open Worship Studio at as an OAuth 2
   **Redirect URI**:

   ```
   https://jeyeager65.github.io/WorshipStudio/app/
   ```

   As with OneDrive, this has to match character for character, trailing slash included.
5. Copy the **App key** from the Settings tab. That's your app ID.

::: warning Dropbox's development-mode limit
A new Dropbox app starts in development mode and is capped at a small number of linked accounts
(around 50). That's ample for a single church. Going beyond it means applying to Dropbox for
production approval.
:::

## Sharing the library folder

Whichever provider you use, the same two rules apply:

- **The library must be a folder, not the drive root.** A root can't be shared with anyone, so a
  library placed there can never reach a second person.
- **Everyone signs in as themselves.** Share the library folder with each person who needs it,
  through Dropbox or OneDrive's normal sharing, and they sign in with their own account. There's
  no shared password, and nobody needs the account that owns the library.

## Connecting each device

Once per device, and it's short:

1. Open Worship Studio on the device.

   ::: tip On an iPad or iPhone, install it first
   Add Worship Studio to the Home Screen *before* connecting. A page running in a Safari tab and
   the same page installed as an app get **separate storage**, so connecting in the tab and then
   installing leaves you connected in one and not the other. The first-run screen puts the
   install step first for this reason.
   :::
2. Choose your provider and paste the app ID.
3. Sign in with your own account and approve the permission prompt.
4. Pick the library folder from the list it offers. Shared folders appear alongside your own.

To pass the ID to the next device, open **Settings → Library & Sync → Add Another Device** on any
connected device — it shows your church's ID with a **Copy** button.

::: tip The app ID isn't a secret
It identifies the registration, not your account, and it can't be used to reach anything without
someone signing in and consenting first. Emailing or texting it is fine. (Technically: these are
PKCE public clients, which have no client secret by design.)
:::

## If something goes wrong

**"Not found" when picking the library folder, on a folder you can see in OneDrive.**
Almost always the permission: check the registration lists `Files.ReadWrite.All` as *delegated*,
not `Files.ReadWrite`. Everyone must sign out and in again after changing it.

**A CORS error, or a complaint about a missing client secret.**
The registration is the *Web* platform type instead of **SPA**. Add an SPA platform entry with
the same redirect URI.

**Sign-in bounces back with a redirect-mismatch error.**
The redirect URI doesn't match exactly. Compare it character by character against the address bar,
including the trailing slash.

**A device that used to work now asks to sign in again.**
Expected after the permission scope changed. Sign in once and it sticks.

**Everything works, then stops after a day.**
OneDrive caps how long a browser-based sign-in stays valid, so an occasional re-sign-in is normal
rather than a fault.
