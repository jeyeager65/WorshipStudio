# Library Health

Your library lives as files in a shared folder synced by Dropbox (or similar) — see [Sync](/sync)
for how that's set up per device type. Being shared this way means two kinds of problems can
occasionally turn up: a file that got damaged, or the same record edited on two computers at
once. Library Health is where you review and resolve both — nothing here is ever silently
discarded.

## Checking for issues

**Check Now** in [Settings → Library & Sync](/settings) confirms your library folder is readable,
that your sync tool appears to be running, and when the library last changed — if there are
issues to review, it links straight here.

## Resolving a conflict

When the same record was edited on two computers, you'll see a diff of what changed on each side,
labeled with the other device's name. Choose **Keep Mine** or **Keep Theirs** — whichever version
you don't keep is preserved automatically as a backup, not deleted.

![Library Health page showing a resolvable conflict](/screenshots/library-health.webp)

## Recovering a damaged file

For a file that can't be read, you can **Restore** it from the most recent complete backup, or
**Preserve and Remove** it — this moves the damaged file to a quarantine location outside your
active library (keeping the original bytes in case you need them later) and removes it from the
app.
