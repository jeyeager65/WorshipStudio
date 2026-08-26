# Setup Wizard — joining an existing library

Status: plan agreed 2026-08-26, implementation in progress in the same pass. Raised by the
operator: "if you are syncing with an existing setup, it should really sync first and then decide
what makes sense. It probably needs to set the computer name, but that might be all that's needed."

That instinct is correct, and the codebase already agrees with it in one place — see "Prior art"
below. This note records why, and what changed.

## The underlying problem: the wizard mixes two settings scopes

Settings are split into `MachineSettings` (per-device, in the Tauri app-data dir, **never synced**)
and `LibrarySettings` (inside the library folder, **shared with every device**). See
`src/models/settings.ts`.

Of the wizard's four substantive steps, three wrote shared data:

| Step | What it writes | Scope |
| --- | --- | --- |
| Church Identity | `branding.churchName`, brand colours | **library** |
| Display Setup | `displayRoles` | machine |
| Library & Import | `libraryPath` | machine |
| | song import, stock backgrounds | **library content** |
| Planning Defaults | `defaultTranslationCode`, first service type | **library** |
| | `darkMode` | machine |

A device joining an existing library already has all of the library-scoped values. Asking for them
is at best redundant, and at worst destructive — which it was.

## The bug this fixes (data loss, not cosmetics)

Ordering in `SetupWizardView.vue` was exactly wrong:

1. `onMounted` runs `store.load()`, reading `LibrarySettings` from the *currently configured* root.
   On a new machine that is app-data's empty default, so the in-memory copy is all defaults.
2. The Church step **requires** a church name before it will advance (`validateCurrentStep`).
3. The Library step points `libraryPath` at the existing synced folder. `pickLibraryFolder` only
   assigned the path — nothing reloaded.
4. Finish called `store.save()`, which writes machine settings **first** (committing the new path),
   then `saveLibrarySettings`. The Rust side resolves `library_root()` by re-reading machine
   settings *from disk* (`src-tauri/src/paths.rs`), so it now resolved to the **new** folder and
   wrote the stale defaults over the real `library-settings.json`.

Net effect: setting up a second machine against an existing library overwrote that library's
branding, brand colours, default translation, bulletin settings and font sizes for **every** device.

The fix is not to reorder the saves. It is to stop the wizard writing library settings it did not
load from that library — which the mode fork below does structurally.

## Prior art: the tablet path already does this

`BootGate.vue` already implements "sync first, then decide" for tablets: connect to the cloud
library, force `hasCompletedSetup: true`, block on the initial full pull, then boot in. Its comment
makes the same argument — a joining device is "not a per-device blank slate," and the
desktop-oriented steps "mostly don't even apply."

So this change does not introduce a new idea. It brings the desktop wizard in line with a
conclusion the tablet path reached first.

## What changed

**A mode fork on the Welcome step** — "Set up a new library" vs "Join an existing library" —
driving a computed step list rather than a fixed one:

- **New**: Welcome → Church → This Device → Displays → Library → Defaults → Finish
- **Join**: Welcome → Library → Displays → This Device → Finish

Join puts the library connection first, so everything after it is decided with the real library
already loaded. That is the operator's "sync first, then decide," made explicit rather than
inferred.

**Scope-clean steps.** A new "This Device" step holds the machine-scoped values (computer name,
dark mode); `darkMode` moved there out of Planning Defaults, leaving that step purely
library-scoped. Church and Defaults are skipped entirely in Join mode.

**Join never writes library settings.** `completeSetup` saves only `MachineSettings` in Join mode,
and skips `applyFirstServiceType`. This is the actual fix for the bug above.

**Choosing the folder now persists and reloads.** `pickLibraryFolder` saves machine settings before
reloading, because the desktop backend resolves `library_root()` from what is on disk — an
in-memory path change alone would reload the *old* library. After the reload the wizard knows the
real church name, which powers both the Join confirmation and the safety net below.

**A safety net for the wrong choice.** If someone picks "new library" but the chosen folder already
contains a library with a church name, the Library step says so and offers to switch to Join.
Detection is deliberately the backstop, not the primary mechanism: a partially-pulled cloud folder
is ambiguous mid-sync, so the explicit fork stays the thing that decides.

## Computer name

`thisComputerName` is machine-scoped and is the `updatedByDevice` stamp on **every** saved record —
songs, themes, services, external apps all resolve it through a `deviceName()` helper mirroring
`this_device_name()` in `paths.rs`. `SyncConflictsView.vue` shows it when resolving a conflict, so a
blank value makes two devices indistinguishable in exactly the situation the field exists for.

The gap is platform-specific, and narrower than first assumed:

- **Desktop** already defaults it to the OS hostname (`gethostname()`, `paths.rs`). Never blank.
- **Web and tablet** default it to `''` (`adapters/web/settings.ts`) and only Settings → General
  ever sets it — a page a new user has no reason to open.

Since tablets are precisely the devices that *join*, they were the ones stamping every edit with
nothing. Both the wizard's This Device step and the tablet's connect flow now collect it, prefilled
with a platform-appropriate suggestion rather than left empty.

## Documentation

Recommending "set up on the main Windows machine first, then add devices" is right, and worth
writing — Display Setup is Windows-only, OpenSong import is desktop-only, and somebody has to
create the library before anything can sync to it.

But documentation was explicitly *not* accepted as the fix. It makes the good path likely; it does
not make the bad path safe, and the wizard could not tell which case it was in. Docs land on top of
the structural fix, not instead of it.

## Deliberately out of scope

- **Merging the tablet connect flow into the wizard.** Tempting — a joining tablet's needs are now
  almost exactly the Join flow — but `BootGate.vue` carefully blocks on the initial pull to stop
  pages racing a half-populated library, and unifying them risks that for no user-visible gain.
- **Making Join detect and offer *cloud* connections on desktop.** Desktop joins by pointing at a
  synced folder, which is what the existing picker does.
