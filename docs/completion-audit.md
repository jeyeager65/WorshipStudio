# Worship Studio Completion Audit

Last reviewed: August 1, 2026

## Current assessment

The core application is close to a coherent, production-quality product. The primary screens—Services, content libraries, People, Roles, Templates, Themes, Reports, Planning, Settings, and Setup—have largely been brought to the same visual standard.

The next phase should emphasize reliability, consistent application states, and release hardening rather than another broad redesign or a large expansion of features.

## Highest priorities before production use

### 1. Protect library data from interrupted or invalid writes

Previously, JSON files were written directly to their destination, so an interrupted write, power loss, filesystem problem, or sync interruption could leave an incomplete file that was then silently skipped during loading.

Status: completed August 1, 2026.

- JSON is serialized before any existing file is touched, written to a unique temporary file in the destination directory, flushed to disk, and atomically moved into place.
- Every replacement preserves the previous valid version as an adjacent `.backup` file. A corrupt current file never replaces a known-good backup.
- Domain reads now distinguish missing files from malformed or unreadable files and return a path-specific error instead of silently omitting the record.
- **Library Recovery** scans the active library against the expected model for each file type, identifies whether a verified backup exists, and offers **Restore Backup**.
- When no valid backup exists, **Move Aside** preserves the damaged bytes beside the original while removing them from the active `.json` set.
- Recovery commands are restricted to JSON files inside the active library.
- Machine settings automatically restore a valid local backup when possible and never overwrite unrecoverable damaged settings with defaults.
- Canva authorization and other application-owned JSON files use the same atomic persistence helper.
- Moving a service between year folders commits the new file before removing the old copy.
- Focused tests cover backup preservation, serialization failure, invalid JSON reporting, restoration, quarantine, and path-boundary enforcement.

Relevant implementation: `src-tauri/src/domain/mod.rs` and `src-tauri/src/paths.rs`.

### 2. Establish standard loading and error states

Most Pinia stores expose whether they have loaded, but do not retain loading or error state. Adapter failures can therefore produce blank screens, temporary empty-state flashes, console-only failures, or an editor that remains dirty without explaining why its save failed.

Recommended shared states:

- Initial loading state or skeleton
- Empty library state
- Filtered-empty state
- Recoverable loading failure with Retry
- Save failure with an actionable message
- Offline/API failure where applicable
- Missing or malformed library item state
- Background refresh state that does not replace existing content with a spinner

These should be implemented through shared components and common store conventions rather than independently in every view.

### 3. Finish the focused credential review

The credential boundary is now deliberate rather than treating every credential alike:

- The Canva client ID and secret define the church's private integration. They are stored in the synced church library so its Worship Studio computers share one integration.
- Canva OAuth access and refresh tokens identify a particular computer's authorized Canva account. They remain local in `canva-auth.json` and never sync through the library.
- Existing machine-local Canva integration credentials migrate only when the shared church integration is entirely empty; shared values are never overwritten by an older computer.
- Bible API keys remain machine-local plaintext configuration. Given the private computers, limited Dropbox exposure, and replaceable keys, this is an accepted current tradeoff rather than a blocker.
- Remote-control pairing records and tokens remain machine-local.

Recommended remaining work:

- Review local file permissions for machine settings, Canva tokens, and remote pairing data.
- Ensure diagnostics, logging, and error messages never expose credentials or tokens.
- Revisit an OS credential store only if the distribution model or threat model expands beyond trusted church computers and a private synced library.
- Document credential rotation and Canva reconnection procedures.

Relevant implementation: `src-tauri/src/models.rs`, `src-tauri/src/commands/settings.rs`, and `src-tauri/src/commands/canva.rs`. See `docs/canva-setup.md` for the operational model.

### 4. Reconcile the email workflow

Assignment message composition is real, but the email adapter methods deliberately do not send anything. The current dialog presents a **Send** button and explains only afterward that nothing was sent.

Until real mail delivery is implemented, use one or both of these honest actions:

- **Copy Message**
- **Open in Email App** using a `mailto:` draft

Only restore **Send** when a real transport is configured and failures can be reported accurately.

The same decision applies to any Order of Worship email action.

### 5. Add a pre-service readiness check

A single readiness check would provide more practical Sunday-morning reliability than most new feature work.

Suggested checks:

- Unfilled service-template placeholders
- Missing or unavailable local media
- Unresolved scripture passages
- Missing external applications, executables, or per-service files
- No connected/configured audience display
- Empty song arrangements or missing song blocks
- Missing referenced songs, slides, media, themes, or people
- Invalid countdown targets
- Optionally, unassigned critical roles
- Optionally, assignment conflicts and unavailable people

Suggested interaction:

- Show a compact status near **Start Presenting**.
- Distinguish blockers from warnings.
- Allow the operator to open the affected item directly.
- Re-run automatically after relevant edits or display changes.
- Present a clear green **Ready to Present** state when no blockers remain.

## Design-standard audit

### Clear visual holdout: Sync Conflicts

`src/views/SyncConflictsView.vue` still uses the older plain Vuetify container/card presentation.

Bring it up to the current standards with:

- The established page background, width, header, and hierarchy
- A designed no-conflicts state
- Loading, resolution-in-progress, and error states
- Stronger device/version identity
- A responsive comparison layout rather than two fixed columns
- More readable field names and formatted structured values
- A clear explanation of what will be discarded
- Resolution progress when several conflicts exist
- A return action after the final conflict is resolved

### Editor not-found states

Song, Slide, Person, Service, and Assignment pages still have plain-text not-found fallbacks. Themes and Templates already have more deliberate states.

Create one shared not-found pattern with:

- Contextual icon
- Clear title and explanation
- Back-to-library or Back-to-Services action
- Optional Reload action
- Consistent spacing and card treatment

### Loading, empty, and filtered-empty states

Libraries currently implement similar states with duplicated view-specific CSS. Extract a shared state component that supports icon, title, description, primary action, and secondary action.

### Dialog consistency

Review dialogs for consistent:

- Header icon and title treatment
- Supporting description
- Close affordance
- Primary action placement and wording
- Cancel/secondary action style
- Validation behavior
- Fixed versus content-driven sizing
- Small-screen behavior
- Focus placement and keyboard dismissal

The Assignments email dialog is one visible example of the older generic style.

### Shared page headers

Library and editor headers are visually similar but independently implemented. Shared `LibraryPageHeader` and `EditorPageHeader` components would reduce drift while retaining slots for page-specific actions, metadata, and status.

### Large view decomposition

These files have become difficult to maintain safely:

- `src/views/ServiceWorkspaceView.vue` — roughly 4,000 lines
- `src/views/SettingsView.vue` — roughly 2,700 lines

Decompose them by user-facing section, not merely by code type. Good candidates include:

- Service details dialog
- Audience-display chooser
- Add-to-Service dialog and individual content panels
- Service order list
- Selected-item editor panels
- Live preview/transport area
- Each Settings section
- External-app profile editor
- Remote-control settings
- Bible translation settings

This is partly maintainability work, but it also makes visual consistency and targeted testing much easier.

### Intentionally minimal windows

The audience Presentation window and Identify Display window are special-purpose surfaces. They do not need the normal application page chrome or library/editor design language.

## Features to complete or explicitly defer

Each item should be assigned to a named milestone such as **0.5 polish**, **before 1.0**, or **post-1.0**.

### Audio service items

The data model recognizes audio, but live rendering remains a placeholder. A complete implementation needs file selection, playback, pause/seek/stop behavior, live-transition semantics, missing-file handling, remote behavior, and operator status.

### QR slide items

The data model recognizes QR items, but the content type is not complete. Decide whether the advanced Slide editor already covers the actual use cases well enough or whether a quick URL-to-QR content type is still valuable.

### Sheet music / PDF region mapping

Not implemented and already described in the feature specification as speculative. It is a strong candidate for post-1.0 unless real users identify it as necessary.

### Additional song import and export

Still absent:

- ChordPro structure import
- Plain-text paste and parse
- OpenSong XML export

OpenSong import covers the immediate migration need, so these can be prioritized from actual usage rather than feature parity.

### Local Bible-file import

KJV and API-backed translations are supported, but the general local Bible import workflow is not complete. Decide whether churches need OpenSong Bible files or another documented format before 1.0.

### Email delivery

Real email transport is not implemented. Decide between:

- Delegating to the user's installed mail application
- SMTP configuration
- A cloud mail provider
- Keeping Worship Studio responsible only for document/message generation

The installed mail application is likely the simplest and least credential-heavy first step.

### Automatic updates

The release workflow creates versioned artifacts, but the application does not check for, download, or install updates. Add a Tauri updater before distributing broadly, or document a clear manual update process and expose the Releases page prominently.

### Help and documentation generation

The application has source, issue, and release links in About, but does not yet have an operator guide, keyboard-shortcut reference, troubleshooting flow, or generated help videos.

## Testing and release hardening

### Add a Windows E2E smoke lane to CI

The native WebdriverIO/Tauri suite exists under `e2e/`, but the normal CI workflow runs frontend unit tests and Rust tests only.

A time-bounded CI smoke suite should cover:

- First launch and setup completion
- Create, save, close, reopen, and edit a service
- Song or slide save/reload
- Media import and live display
- Presentation-window creation
- Report generation and save/open flow
- Remote server startup and basic authorization
- Portable machine-settings behavior

The full native suite can remain scheduled or manually triggered if it is too slow for every push.

### Real-hardware test matrix

Before a stable release, manually test:

- Projector absent at startup and connected afterward
- Projector disconnected during use
- Display renumbering after reboot, docking, or cable changes
- 100%, 125%, and 150% Windows scaling
- Mixed-resolution and mixed-scaling monitors
- 16:9, 16:10, and 4:3 audience outputs
- Installed and portable instances running together
- Multiple Worship Studio computers on one LAN
- Configured and automatically selected port conflicts
- mDNS discovery across typical church network equipment
- A library hosted in Dropbox or OneDrive during concurrent edits
- Missing local media on a preparation computer
- Upgrade installation over an existing version
- Power loss or forced termination during save
- Network loss while resolving scripture or refreshing Canva
- Canva authorization expiration and reconnection

### Accessibility and interaction review

Perform a focused pass for:

- Keyboard-only operation
- Visible focus indicators
- Correct focus placement when dialogs open and close
- Accessible names for icon-only controls
- Color contrast in light and dark modes
- Meaning that does not depend on color alone
- Screen-reader labels for custom cards, drag handles, and controls
- Reduced-motion behavior
- Text scaling and Windows display scaling

### Diagnostics

Rust logging exists, but users need a supportable workflow.

Add to Settings > About or Support:

- Open Logs Folder
- Copy Diagnostic Summary
- Export Diagnostic Bundle
- Application version and build identifier
- Operating system and architecture
- Configured library path, portable status, hostname, and port without exposing credentials
- Connected display summary
- Recent recoverable errors

## Security review

Before broader public distribution:

- Verify that plaintext credentials follow the documented trusted-church-library boundary and never enter logs or diagnostics.
- Review remote-control authentication, cookie behavior, token revocation, and LAN threat assumptions.
- Review whether HTTP-only LAN control is acceptable and document the boundary.
- Narrow the disabled Content Security Policy if practical.
- Narrow the unrestricted Tauri asset-protocol scope if practical.
- Confirm that no private code-signing key is tracked or packaged. The public `.cer` may be tracked; the `.pfx` must remain private and ignored.
- Review temporary Canva downloads and deletion behavior.
- Verify that exported reports cannot overwrite files without an explicit native save choice.

## Licensing and distribution follow-up

- Confirm the ESV API attribution and app-link interpretation directly with Crossway before shipping.
- Confirm api.bible attribution and translation-selection restrictions.
- Retain licenses for all bundled fonts and dependencies in distributed artifacts or an About/Credits location as required.
- Document that locally imported Bible translations are supplied and licensed by the user.
- Decide whether the current self-signed Windows certificate process is acceptable for the intended audience.
- Decide when macOS signing and notarization become necessary.

## Documentation drift

The README and architecture plan contain historical statements that no longer match the implementation, including claims that several adapter areas are still mock-only.

Update:

- `README.md`
- `docs/architecture-plan.md`
- `docs/release-process.md`
- Feature-support and platform-support matrix
- Installed versus portable behavior
- Remote-control discovery and port behavior
- Canva setup and credential expectations
- Backup/recovery guidance

## Remove development-era compatibility before 1.0

Worship Studio does not need to preserve compatibility with data formats produced during pre-1.0 development. Once the 1.0 library and machine-settings formats are finalized, remove the migrations and compatibility paths accumulated while the application was changing.

This cleanup should include:

- Legacy model fields retained only for migration, including old credential and settings locations.
- Load-time migrations, backfills, aliases, and fallback behavior for obsolete pre-1.0 JSON shapes.
- One-time conversion flags and code paths that can no longer be reached by a clean 1.0 installation.
- Tests whose only purpose is preserving compatibility with an abandoned development format.
- Comments and UI messages that describe upgrade behavior no longer supported by 1.0.

Do this after the final schemas are settled, not piecemeal while they are still changing. Before removing a path, confirm that any data worth keeping in the active development library has been converted or can be recreated. Then validate 1.0 using a clean installation and newly created library as the supported baseline.

This does not apply to user-facing imports such as OpenSong or to migrations deliberately introduced after 1.0. From 1.0 onward, persisted-format changes should have explicit versioning and supported upgrade rules.

## Recommended execution order

1. Atomic saves, corruption detection, backups, and recovery — completed August 1, 2026
2. Standard loading, error, and save-failure handling
3. Pre-service readiness check
4. Sync Conflicts redesign and shared state components
5. Credential boundary and focused security review
6. Honest email/copy/mail-client workflow
7. Windows E2E smoke CI and real-hardware testing
8. Automatic updates and user-accessible diagnostics
9. Finalize the 1.0 persisted schemas and remove development-era compatibility code
10. Documentation and licensing reconciliation
11. Decide which incomplete content/import features belong before 1.0

## Suggested milestone split

### 0.5.x polish

- Sync Conflicts redesign
- Shared loading/error/empty/not-found states
- Honest email action wording
- Pre-service readiness check
- Documentation correction
- Hardware testing and bug fixes

### Before 1.0

- Credential-boundary verification and rotation documentation
- Updater or a deliberate documented alternative
- Windows E2E smoke CI
- Diagnostics export
- Licensing confirmation
- Security review
- Final schema cleanup with pre-1.0 migrations and compatibility fields removed

### Candidate post-1.0 work

- Sheet-music PDF mapping
- Built-in email delivery
- QR content type
- Additional song import/export formats
- Local Bible imports, if not required by early adopters
- Full automated help-video generation

## Completion criteria

Worship Studio is ready for a stable release when:

- A failed or interrupted save cannot silently destroy or hide library data.
- Every major asynchronous operation has a visible loading, success, or failure outcome.
- Synced integration credentials and local authorization tokens follow the documented boundary and never appear in logs or diagnostics.
- The operator can verify service readiness before presenting.
- A projector can be connected or changed without restarting the app.
- The critical Windows workflow passes automated smoke tests and the hardware matrix.
- A clean 1.0 installation uses the final persisted formats without development-era migration or compatibility code.
- No visible control claims to perform an action that is not implemented.
- Remaining incomplete features are hidden, clearly labeled, or explicitly deferred.
- Documentation accurately describes installed, portable, remote, reporting, and update behavior.
- The remaining older states and Sync Conflicts screen match the established application design.
