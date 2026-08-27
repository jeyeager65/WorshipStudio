# Songs

The Song Library is where you build your church's song catalog once and reuse it every week.
Search by title, author, artist, tag, or collection, and filter the library sidebar by Collection
or Tag.

![Song Library, with the collection/tag filter sidebar on the left and the searchable song list on the right](/screenshots/songs.webp)

## Song details

Each song has a title, author, artist (used for the credit line, falling back to author if
blank), a CCLI number, tags, and one or more collections — each collection can carry its own
hymnal or songbook number.

## Lyrics and arrangement

Lyrics are built from reusable, named **blocks** — verse, chorus, bridge, and so on — each with
its own text. A separate **Default Arrangement** panel decides the actual play order by adding
blocks from that list and dragging them into place; this arrangement is what gets copied into a
service when you add the song.

![Song editor, showing a song's lyric blocks](/screenshots/song-editor.webp)

## Using songs in a service

From [Service Plan](/services), **Choose Songs from Library** opens the Song Library in picker
mode — click a song to add it to the service, and drag to reorder your selections.

A song added to a service starts from its Default Arrangement, and you can vary it for that one
service without touching the song itself. In the Service Workspace, select the song and click
**Edit Arrangement**: blocks can then be dragged into a different order, removed, or added back
from the chips below, and **Reset to song default** undoes the lot. Click **Done** when you're
finished.

::: tip Why it's behind a button
Removing a block here doesn't ask you to confirm — being asked on every tap would make building
an arrangement tedious, and Reset to song default is the safety net. That's exactly why the
controls stay out of the way until you ask for them, and why an ordinary tap on a block never
deletes anything.
:::

## Import and housekeeping

**Import from OpenSong** brings in songs from OpenSong XML files, available here and in the
[Getting Started](/getting-started) wizard. Worship Studio tracks last-used date and uses-in-the-
past-year automatically, and nudges you to archive a song after about 18 months of disuse.
**Archive** hides a song from the library and song pickers without losing its usage history or
affecting past services — use **Delete** only if you're sure you won't need it again.
