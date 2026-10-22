# StoryPlanner: Design Notes for a Plot-Line Planning Plugin

Revision 5, 22 October 2026. Revision 5 adds profiles for characters and organizations, events, and a four-part outline (sections 15 to 17), and changes the story format to version 3 (section 9). Revision 4 added locations, made the plugin desktop-first, and added a development setup with a test vault (section 13).

Previous revisions: Revision 2 incorporated Eleanore's twelve decisions on the first draft: each story is stored as one note in the vault rather than in hidden plugin data, and story time is built on dates in a calendar customized per story. Revision 3 settles the five follow-up questions and adds a small time zone system to the calendar (section 5). Nothing here is code yet. The final section lists the few questions that remain.

## 0. Decisions So Far

The plugin supports multiple stories in one vault. A card has one primary plot line and may also touch secondary plot lines, where it appears as a slim, title-only echo running parallel to the real card. The board defaults to the vertical layout (chapters down, plot lines across), can be transposed, and the default orientation is a global setting. Story time is expressed as dates, in a calendar that each story can customize, because the stories involved have specific timelines (such as Year 1531, December 4th) that are usually not on a real-world calendar. Off-page events are in. The character highlight is a toggle inside the plot line board, while the character track and the presence matrix live together in a separate character view, with the track laid out like the plot line board but with characters in place of plot lines. Character relationships are worth developing. Story setup lives in its own panel per story; the Obsidian settings tab holds only global preferences. Tags are included but belong to the story and never mix with Obsidian's own tag system. Each story is stored as its own file, and that file now lives in the vault as a note, so that word counts, file recovery, version history and ordinary backups all work. Cards may link to notes, including creating new notes from cards.

The follow-up answers settle five more points. The story note uses the hybrid format, under the rule "edit in the board, read anywhere". Word counts, when they come, measure the words in the planner itself rather than in linked notes, and they are optional, not a required feature. One calendar per story is enough for now, but the data model should leave room for several later; the calendar must allow a custom number of months per year, days per month and days per week, and it needs a small time zone system. Links to notes live only in the story file, so created notes carry no back-reference. Story files can be created anywhere in the vault.

The last round added two more decisions. Stories have a light, nested list of locations, which carry time zones and enable a warning when a character is in two places at once. The plugin is built for desktop first, and mobile and tablet support is not a goal for now.

Revision 5 settles the following:

- Characters and organizations share one shape: a name, a short name, a colour, a summary, a description, the story's own fields, and a linked note. Places and items may join them later.
- Every character and organization has a profile in the Characters view.
- Organizations nest (a branch inside a guild). A character's membership can carry a rank and the story dates it starts and ends.
- Scenes name organizations as involved or mentioned, just as they name characters.
- The character track is set aside for now; the Characters view shows the presence matrix and the profiles.
- Events are objects of their own. A card belongs to at most one event, and an event can sit inside one arc (a single level of nesting). Cards in no event stay loose. Plot lines and events have synopses.
- The outline, both the tab and the exported note, has four parts: the story, its characters, its organizations, and the plot. It can be edited in place.

## 1. The Core Idea in One Paragraph

StoryPlanner is a purpose-built board inside Obsidian where a writer lays out the plot of a story as cards arranged along two axes: which plot line a card belongs to, and where it falls in time. Time can be read in two ways. The first is the order in which the reader meets events, which is the chapter order. The second is the order in which events actually happen in the world of the story, which is story time, measured in dates of the story's own calendar. The board can flip between these two readings without losing anything, because every card carries both. Characters are attached to cards, so the same data can be re-read as "what is this person doing, and when". Each story is one note in the vault. The plugin opens that note as a board rather than as text, and it creates nothing else in the vault unless the writer asks it to.

## 2. Vocabulary

A **story** is one planning board, stored as one story file in the vault. A vault can hold any number of them.

A **plot line** is a structural thread through the story, such as the relationship between two characters or the main investigation. Plot lines are the lanes of the board. Each has a name, a colour, an optional description, an order, and optionally the characters it concerns.

A **card** is one unit of plot, usually a scene but possibly a beat, an event, or a reveal. It has a short title, a synopsis of a few sentences, a primary plot line and optional secondary plot lines, a chapter placement (or none, if it is off-page), an optional story date, characters with roles and notes, a status, optional story tags, and optional links to notes.

A **chapter** is a container in reading order, with a name or number, an order, and an optional summary. Parts or acts can later be added as groupings of chapters.

**Story time** is the in-world chronology, expressed as dates in the story's **calendar** (section 5).

A **character** is a named entity with a colour, a short description, an optional default time zone, and an optional link to a character note.

A **location** is a named place in the story, with an optional parent location (so a tavern can sit inside a city inside a province), an optional time zone, a short description, and an optional link to a location note. A card can name the location where it happens.

A **story tag** is a label such as "clue", "red herring", or "needs research", defined inside one story and unrelated to Obsidian's `#tags`.

## 3. The Board

The board shows plot lines as columns and chapters as rows, with cards sitting in the cells. Within each chapter, cards have a single scene order across all columns, which the sketch suggests by drawing the cards of chapter 1 at different heights. The board renders each chapter as a stack of thin sub-rows, one per scene, with each card in its own plot line's column at its own sub-row. Scenes in different plot lines can also share a sub-row, for parallel or intercut scenes at the same point of the book; dropping a card into the middle of an empty cell beside another scene puts it in that scene's row, while the top and bottom of the cell put it just before or after. Within a shared row the reading order runs left to right by plot line. Reading straight down the board gives the scene order of the book, and reading down one column shows how one plot line advances. Dragging a card up or down changes its scene order, dragging it sideways changes its primary plot line, and dragging it across a chapter divider moves it into another chapter. A compact mode stacks each cell's cards from the top and hides the cross-column order, which is better for a quick overview of how busy each plot line is.

In chapter mode the order is whatever the writer drags it to, because reading order is an authorial choice. In story-time mode the order comes from each card's date, and dragging a card onto another position proposes a new date (section 5). The two orderings never overwrite each other.

### Echoes for cards in several plot lines

A card's primary plot line decides the column it lives in. In each of its secondary plot lines, the card appears as an echo on the same sub-row: a slim strip carrying only the title, perhaps with a thin border in the primary plot line's colour, so that you can tell where the real card lives. Clicking an echo selects the real card and scrolls to it. An echo cannot be dragged by itself; dragging the real card moves its echoes with it. A small control on the card, or a field in the detail panel, adds or removes secondary plot lines, and dropping a card onto another column while holding a modifier key could add that column as a secondary plot line instead of moving it there. Echoes appear in the same way in story-time mode.

## 4. Orientation

The vertical layout, with chapters down and plot lines across, is the default, because stories typically have few plot lines and many chapters, so the board fits the pane's width and grows downward in the direction Obsidian naturally scrolls. A transpose toggle on the board swaps the axes, which gives the horizontal layout where time runs left to right and each plot line reads like a lane of music, making gaps and convergences easy to spot. The rendering is built around an abstract notion of lane and slot from the start, so transposing is a display setting rather than a second implementation.

The global settings hold the default orientation for new boards, and it makes sense to allow separate defaults for chapter mode and story-time mode, since many writers prefer the horizontal layout for chronology. Each story remembers the orientation it was last viewed in, so switching one story does not change the others. That per-story preference is stored as view state and does not mark the story file as changed for no reason (section 9).

## 5. Story Time and Custom Calendars

### Why dates, and why custom calendars

Story time is expressed as dates, because the stories this plugin is meant for have specific timelines, and placing a scene on "Year 1531, December 4th" is both more natural and more checkable than placing it in "Day 3". At the same time, these timelines are usually not on a real-world calendar. A year numbered 1531 might belong to an invented world, months might have invented names or different lengths, and there might be eras, a different number of days in a week, or no leap years at all. The plugin should never assume the Gregorian calendar, and in particular it should never store dates as real-world timestamps, which would bring in time zones, leap seconds, and the real calendar's history, none of which apply to a fictional world.

### The calendar definition

Each story has a calendar, defined in the story setup panel. Every part of it is customizable. The year consists of an ordered list of months, as many as the world needs, each with a name, an optional short name, and its own number of days. There is an optional leap rule, kept simple: for example "every N years, month M gets one extra day", or none at all. There are optional eras, each a name such as "Third Age" or "Before the Founding", plus whether years count upward or downward within it, which covers calendars with a year zero, counting backward, or a reset at some event. To put every era on one timeline, the plugin counts years from the first era that counts upward, the anchor: its year 1 is the start of the line. A counting-down era just before it, such as "Before the Founding", needs no length, since its year 1 simply ends where the anchor begins (so 1 BC is followed directly by 1 AD, with no year zero). Any other era needs its length in years so the eras after it can be placed; until one is given, the plugin assumes ten thousand years, which keeps later eras in the right order. The leap rule counts years on this same line. The week is a list of weekday names of any length, together with an anchor (which weekday a chosen date falls on), so the plugin can tell you that December 4th, 1531 is a "Marketday" if your world has such things; the week can also be switched off. The day has a configurable number of hours and minutes per hour, defaulting to 24 and 60, and an optional list of named parts of the day such as dawn, morning, noon, evening and night. Each named part maps to a span of hours (dawn might be 5 to 7), which lets named times sort correctly against clock times and convert between time zones.

Only one calendar per story is needed for now. Even so, every stored date carries a calendar identifier, which is always the story's main calendar today. A second calendar can then be added later, for example for a culture that dates events differently, without changing any stored dates. The future version would convert between calendars through the shared sortable key described below.

To make starting easy, the setup panel offers presets: a Gregorian-style calendar with real month names and lengths (which suits a story that looks like the real world but is not tied to it), the same without leap years, a simple thirty-day-month calendar, and a blank calendar. The Gregorian-style preset anchors its week on 1 January 2000, a Saturday, so its weekdays match the real calendar for recent centuries, even though its simple leap rule drifts from the real one over longer spans. A preset is copied into the story and can then be edited freely, so stories never depend on each other's calendars.

### Dates on cards

A card's date is stored as its components (era, year, month, day, time of day) rather than as a single number, so that the date always means the same thing even if the calendar definition is later edited. Dates can be partial: a card can be dated only to a year, to a month in a year, to a day, or to a day and time. Partial dates sort before more precise dates within the same span, and the board shows them with their real precision ("1531", "December 1531", "December 4th, 1531, evening"). A card can also carry an optional end date, for events that span time, such as a journey or a siege, and an optional "approximate" flag, shown as "around December 1531", for when the writer knows roughly but not exactly.

Several cards often share a date, especially on a busy day. Within the same date and time, cards keep a manual order that the writer sets by dragging, so the chronology is fully specified even when the calendar cannot separate two events. Cards without a date sit in an "undated" tray in story-time mode, so nothing disappears, and dropping a card from the tray onto the timeline gives it the date of the place where it was dropped, which can then be refined in the detail panel.

Internally, every date converts to a sortable key computed from the calendar definition and, where a time zone is set, from that zone's offset (see below). The board uses this key to order cards and to space them along the axis. Dragging a card in story-time mode can therefore work in two ways: dropping it between two cards that share a date keeps the date and changes the manual order, while dropping it in a different date row opens a small date editor pre-filled with that row's date. The writer always confirms a date change rather than having dates silently recalculated, because dates in these stories are meaningful facts, not just positions.

### Time zones

Time zones matter as soon as a story has events in different places happening "at the same time": a message sent at dawn from one city might arrive in another where it is still the previous evening, and an alibi can depend on exactly that. The design keeps this deliberately small. It has no daylight saving time, no historical changes of offset and no real-world zone database, because fictional worlds need none of these, and leaving them out keeps both the interface and the code light.

Each story can define a list of time zones in the story setup panel. A zone has a name, such as "Harbour Time" or "Eastern Provinces", and an offset from the story's reference zone in hours and minutes of the story's own day. Offsets can be fractional and can be positive or negative. One zone is marked as the reference zone, and a story that never defines zones simply has a single implicit reference zone, so writers who do not need zones never see them.

Each card's date can optionally name a zone. The card stores and shows the local date and time as the writer entered it, for example "4 December 1531, 06:00, Harbour Time". For sorting and for placing the card on the story-time axis, the plugin converts that local time to the reference zone using the calendar. The conversion carries correctly across day, month and year boundaries, and leap days included, so an event late on New Year's Eve in one zone can correctly fall on New Year's Day in the reference zone. A card without a zone is taken to be in the reference zone. Named parts of the day convert through their hour spans, so "dawn in the Eastern Provinces" lands at roughly the right reference time. Because a named part is a span, that conversion is treated as approximate.

So that writers rarely set zones by hand, a card's zone is resolved in order of preference. A zone set on the card itself wins. Next comes the zone of the card's location, inherited from a parent location if the location itself has none, so setting the zone once on a province covers every city and building inside it. After that comes the point-of-view character's default zone, and finally the reference zone. The card's detail panel always shows which zone is in effect and where it came from. The story-time view also has a display switch that shows every card's time either in its own local zone or converted into one chosen zone. The second mode answers "what time was it for everyone when this happened", and a small marker shows when a card's displayed date differs from its local date.

Edits to the calendar or to zone offsets after cards are dated could move events relative to one another, since local times stay fixed and their converted positions change. The setup panel therefore shows how many cards an edit affects before applying it, and the plugin takes a snapshot first.

### How the story-time axis is drawn

In story-time mode, the rows (or columns, when transposed) become spans of time. A zoom control chooses the grain, such as years, months, days or parts of the day, and empty stretches of time collapse into a thin "gap" marker showing how much time passes ("— 3 years later —") rather than producing pages of empty rows. This keeps a story that spans decades readable while still letting a single dense week expand to show each evening. Each card in story-time mode shows a small badge with its chapter, so the reader-order position stays visible. Double-clicking empty space in story time creates an off-page event at that time, and dropping a dated card on the undated tray takes its date off.

### Off-page events

Off-page events are cards with a date but no chapter: things that happen in the world but are never shown to the reader, such as the crime that an investigation uncovers, a character's backstory, or what the antagonist is doing elsewhere. In chapter mode they appear in a collapsible "off-page" lane at the end of the board, so they can be found and dragged into a chapter if the writer decides to show them after all. In story-time mode they appear among the other cards with a distinct dashed outline. They also appear in the character track, which is where they tend to be most useful, because they fill in what a character was doing between their on-page appearances.

## 6. Characters

### On the cards

Characters are entities stored with the story. Each card lists the characters involved, each with a role (point of view, present, or mentioned) and an optional one-line note on what that character does in the scene, such as "lies about the alibi" or "notices the missing ring". Those per-character notes are what make the character views meaningful.

### In the plot line board: the highlight toggle

The plot line board has a character highlight toggle. Choosing one or more characters dims every card that does not involve them, so their path through the plot lines stands out, and optionally shows each highlighted character's note on the cards they appear in. Turning the toggle off returns the board to normal. This is a viewing aid only and does not change any data.

### The character view: track and matrix

A separate character view, opened per story from the board, holds the character track and the presence matrix.

The character track has the same layout and the same controls as the plot line board, except that the lanes are characters instead of plot lines. It uses the same chapter or story-time axis, the same orientation toggle, and the same zoom. Because a scene usually involves several characters, a card appears in the lane of every character involved, and unlike the plot line board there is no primary lane. Each appearance shows the card's title together with that character's own note and role, so reading down one character's lane gives you a sequence of what that person actually does, including their off-page events. The point-of-view character's appearance is marked. The writer chooses which characters appear as lanes and in what order, since a story might have forty named characters and only six who need tracking at once. Dragging works as it does on the board, in that moving a card along the time axis moves it everywhere, while dragging a card into another character's lane adds that character to the scene (with a confirmation), which is a fast way to populate scenes.

The presence matrix is a compact grid with characters as rows and chapters or story-time spans as columns. Each cell shows whether the character appears there and how, with a filled mark for point of view, a solid mark for present, and a hollow mark for mentioned. It is best at catching continuity problems, such as a character who vanishes for half the book, or a character placed in two scenes at the same date and time in different places. Because cards have locations, that second check becomes a gentle warning. When one character appears in two cards whose times overlap but whose locations differ, after converting both to the reference zone, the matrix flags the clash. Locations that sit inside one another, such as a room within a house, do not count as different places. The warning is advisory only, since a story may intend it (a twin, a disguise, a lie).

As built, the character view is a third tab beside the board and story time, with its own transpose setting. Since revision 5 its modes are Matrix and Profiles (section 15); the track below is set aside until its design is reworked, though its code is kept. The matrix can list organizations instead of characters. Until the writer chooses lanes, the track shows the first eight characters. The clash check needs a definite stretch of time: a clock time covers its hour, a part of the day covers its hours, and a card with an end date covers everything from the start of its first day to the end of its last. A card known only to the day, month or year with no end date is never checked, because a day has room for a journey and flagging every same-day pair would bury real problems. A mentioned character is not physically present, so mentions never clash.

### Locations

Locations are managed in the story setup panel as a simple nested list and can be assigned to a card from its detail panel. Besides supplying time zones and powering the clash warning, they give the board a location filter and a location highlight that works like the character highlight. The character track can also show each appearance's location, so reading a character's lane tells you where they are as well as what they do. A dedicated location view, for example lanes per location, is a natural later addition but is not needed at first.

### Character relationships

Relationships can grow from what the design already has, without a separate system. A relationship is a plot line that names the characters it concerns, as in "Mara and Ilse". Three additions make relationships genuinely useful. First, cards in a relationship plot line can carry an optional relationship state, a short label such as "strangers", "allies", "trust broken", or "reconciled", so that the lane reads as an arc of the relationship over the story. Second, in the character view, selecting two characters shows their shared scenes and the states of every relationship plot line between them, in either chapter or story-time order, which answers "how do these two stand at this point in the story" at a glance. Third, the story setup panel can show a simple relationship overview listing each relationship plot line, its characters, and its current state at the end of the story, and later perhaps a small diagram of characters connected by their relationships. Because relationships are plot lines, they automatically appear on the main board, get echoes, use story tags, and show in the matrix.

## 7. Settings

The Obsidian settings tab holds global preferences only. These include the default orientation for chapter mode and for story-time mode, the default card size and whether synopses show on cards, the default folder offered by the "New story" command (story files can live anywhere in the vault, and the file explorer's right-click menu offers "New story here" for any folder, while the plugin finds stories wherever they are by their frontmatter marker), the default calendar preset for new stories, the folder and template used when creating notes from cards, whether the plugin takes snapshots before destructive operations and how many it keeps, and whether story files open as boards automatically.

Story-specific setup lives in a story setup panel opened from a button on the board. It manages plot lines, chapters, the calendar, characters, story tags and statuses, with drag-to-reorder lists, colour pickers, and merge and delete actions. Common actions are also available directly on the board, such as renaming a plot line by clicking its header or adding a chapter at the bottom, so the panel is for bulk management rather than a mandatory detour. Deleting something that cards depend on, such as a plot line with cards in it, asks where those cards should go.

## 8. Story Tags

Story tags capture cross-cutting qualities that neither plot lines nor characters cover, such as "clue", "red herring", "flashback", "action", or "needs research". Each tag has a name and a colour, cards show tags as small chips, and the board and character view can filter by tag. Tags are switchable off per story.

Story tags are defined within one story and are deliberately kept separate from Obsidian's tag system. This matters more now that stories are stored as notes, because Obsidian indexes anything that looks like `#tag` in a note. The story file therefore never writes story tags with a leading `#`, and the plugin stores them in a way Obsidian does not treat as tags (section 9), so a story tag called "clue" will never appear in Obsidian's tag pane or mix with a vault-wide `#clue`.

A single built-in status field (for example idea, outlined, drafted, revised) is kept separate from tags, because every card has exactly one status and it is natural to colour or filter the board by it.

## 9. Storage: One Note per Story in the Vault

### What changed and why

The first draft kept all data out of the vault. That keeps the vault clean, but it also hides the data from everything that protects and measures notes: Obsidian's file recovery snapshots, Obsidian Sync's version history, the writer's own vault backups, and word counts. The decision now is that each story is one note in the vault. This is the same approach used by well-established plugins such as Kanban and Excalidraw, whose boards and drawings are ordinary `.md` files that the plugin opens in its own view. It still meets the original spirit of the constraint, because the vault is not turned into a database: one story is one file, there is no web of generated notes, and the plugin writes nothing else unless the writer asks for it (for example by creating a note from a card).

The plugin's own `data.json` remains, but now holds only global settings and small per-device view state, such as which stories were recently opened and each story's last orientation and zoom. Keeping view state out of the story file means that scrolling or switching orientation never changes the note, which would otherwise produce constant sync traffic and useless file-recovery snapshots.

### How the plugin recognizes and opens a story file

A story file is a normal Markdown note, perhaps named `The Glass Harbour.story.md` or simply `The Glass Harbour.md`, with a frontmatter property that marks it as a StoryPlanner story, such as `storyplanner: story`. Obsidian's metadata cache already reads frontmatter for every note, so the plugin can list all stories in the vault instantly, without scanning file contents. When such a note is opened, the plugin shows it as a board, with a command and a header button to switch to the plain Markdown view and back, as the Kanban plugin does. Because the story is a file, renaming or moving it in the file explorer simply works, deleting it moves it to the trash like any note, and there is no separate story list to keep in step with the vault.

### The file format

Since format version 3, the data block holds one JSON line for the setup, then one line each for every character, organization and event (each marked with its kind), then one line per card. Characters moved out of the setup line, so a story with many characters still diffs and merges line by line. Stories saved in version 2 open unchanged, and they are rewritten in version 3 on the next save. A version of the plugin older than 0.7.0 refuses version 3 stories rather than misread them, and a line of a kind the plugin does not know stops the story from opening rather than being dropped.

The central design choice is what goes inside the note. There are three realistic options.

The first is a fully readable Markdown format, in which the note itself is the data: chapters as headings, cards as sub-headings with their synopsis as a paragraph, and the card's details (plot line, date, characters, tags) as a compact line of fields beneath each heading. Story setup such as plot lines, characters and the calendar would sit in a section at the top. This is the most Obsidian-native option. The file is pleasant to read and edit as text, and word counts reflect only real prose. Its weakness is that the plugin must parse text the writer may have edited by hand, so a stray edit can produce a card the plugin misreads, and rich structure (per-character notes, end dates, echoes, relationship states, calendars) makes the format verbose and fragile.

The second is a hidden data block, in which the note contains only frontmatter and a block of structured data. This is the most robust option and the simplest to build, but it gives up most of the reason for moving into the vault: the note is unreadable, word counts are meaningless, and searching finds noise.

The third, which is recommended, is a hybrid. The note contains a readable outline of the story generated by the plugin, followed by the canonical data in a structured block at the end of the note, hidden inside an Obsidian comment so it does not show in reading view. The readable outline lists chapters, the cards in scene order with titles and synopses, and the off-page events, and is regenerated from the data every time the story is saved. The data block is what the plugin reads. Excalidraw uses this pattern successfully. It gives a note that reads well in plain Markdown view, in search results, in exports and in version history, while the plugin never has to parse prose. The tradeoff is that the readable outline is output, not input: if the writer edits it by hand in Markdown view, the edit will be overwritten on the next save. The rule is "edit in the board, read anywhere", which has been agreed. To avoid surprises, the plugin notices when the outline was changed outside the board and says so before regenerating it, rather than silently discarding the edit. A note at the top of the Markdown view, or a line in the outline itself, can also remind the reader that this text is generated.

A sketch of what a story note would look like under the hybrid format:

```markdown
---
storyplanner: story
storyplanner-version: 1
title: The Glass Harbour
---

## Chapter 1: The Pier

**Body found at the pier** (Investigation, 4 December 1531, dawn)
Mara is called out before dawn and finds the harbourmaster's body...

**Ilse arrives in the city** (Mara and Ilse, 4 December 1531, evening)
...

## Off-page

**The harbourmaster's last meeting** (Investigation, 3 December 1531, night)
...

%%
storyplanner-data
{"plotLines":[...],"chapters":[...],"calendar":{...},"characters":[...],"tags":[...]}
{"id":"k1","title":"Body found at the pier","plotLine":"p1","alsoIn":[],"chapter":"c1","order":1,"date":{"cal":"main","y":1531,"m":12,"d":4,"t":"dawn","zone":"z1"},"characters":[{"id":"x","role":"pov","note":"Notices the missing ring"}],"status":"outlined","tags":["g1"],"notes":[],"modified":"2026-10-18T11:00:00Z"}
{"id":"k2", ...}
%%
```

Two details in that sketch are deliberate. Story tags appear in the outline as plain words or not at all, never as `#tags`, so they stay out of Obsidian's tag system. And the data block holds one line for the story setup followed by one line per card. That layout keeps the file diff-friendly, so version history shows clearly which card changed, and it makes sync merges much safer, as explained below.

### Word counts

Word counts measure the words in the planner itself, meaning the card titles, synopses and character notes, not the words in linked notes. This is an optional feature for a later phase rather than a requirement. When it comes, the plugin counts its own text and shows totals per card, per chapter, per plot line and for the whole story, perhaps in the board's header or the detail panel. It counts from the data, not from the note, because Obsidian's own word count of the story note would also include the generated outline's labels and possibly the comment-wrapped data block. Even before the plugin has its own counter, keeping the story in a note means a readable outline exists that ordinary word count tools can roughly measure.

### Protection, history and backups

Because a story is a Markdown note, Obsidian's file recovery core plugin snapshots it, Obsidian Sync keeps its version history, and any vault backup (OneDrive, a Git repository, a copied folder) includes it, all without the plugin doing anything. The plugin can still add an inexpensive safety step of its own: before a destructive operation, such as deleting a plot line with its cards or merging two chapters, it writes a snapshot of the story's data into a small rolling set in its plugin folder, so a single command can undo even a large mistake. Export remains useful too. A story can be exported as a standalone JSON file for archiving or moving to another vault, and the readable outline can be exported as a clean Markdown or plain text document without the data block.

### Saving, size and performance

The plugin writes the story note a short moment after the last change, and when the board is closed, rather than on every keystroke. It uses Obsidian's atomic file-update method so that a write never interleaves with another change to the same file. Plot data is small: a card is typically between half a kilobyte and two kilobytes including its outline entry, so a 300-card story is a few hundred kilobytes, well within what Obsidian handles comfortably, and other stories are never loaded until opened. Long prose should live in linked notes rather than synopses, which keeps story files light and keeps the plan a plan.

### Sync and conflicts

Story notes sync like any other note, whatever sync method the writer uses, and they no longer depend on the "sync plugin settings" option that the first draft had to warn about. Because each story is its own file, a conflict affects only one story.

The remaining risk is that the same story is edited on two devices before they sync. Some sync services keep a conflicted copy, and Obsidian Sync attempts to merge changes to Markdown files. A merge of a structured block could, in principle, produce data that no longer parses. The one-card-per-line layout makes this much less likely, because edits to different cards land on different lines and merge cleanly. On top of that, the plugin validates the data every time it loads a story. If the data block does not parse, it opens the story read-only, explains the problem, and offers to restore from the last good snapshot or from file recovery, and it never writes over a story it could not read. If two versions of the same card line both survive a merge, the plugin keeps the one with the newer modification time and reports what it did. The plugin also watches for the story file changing on disk while the board is open, for example when a sync arrives, and reloads the board instead of overwriting the newer content with its own stale copy.

## 10. Linking Cards to Notes

A card can link to existing notes, such as a draft of the scene, research, or a location note, and the "Create note from card" action makes a new note in the folder chosen in settings, pre-filled from an optional template with the card's title, synopsis, plot line, date and characters. A card can hold more than one link, and characters can link to character notes in the same way. Linked notes open in a split beside the board, which gives a plan-and-draft workflow.

Since the story is now a note, these links can also appear as real Obsidian links in the readable outline. This means a draft note shows the story in its backlinks, and the graph shows the connection, which is a genuine benefit of the change in storage. The plugin listens for linked notes being renamed or moved and updates the paths in its data, then regenerates the outline. If a linked note is deleted, the card shows a broken-link marker rather than failing silently.

Links live only in the story file. A note created from a card is an ordinary note with no back-reference, and the plugin never writes into any note except the story file. The template fills the new note once, at creation, and after that the note belongs entirely to the writer. Obsidian's backlinks still let a note find its story, because the story's readable outline links to it.

## 11. The Interface Inside Obsidian

The board and the character view are custom views. The board opens whenever a story note is opened (or on request, if automatic opening is turned off), and there are commands to create a new story, open a story from a list of all stories in the vault, and jump to a card. Because these are ordinary tabs, writers can split them beside their drafts, open the board and the character view side by side, pop them out into a second window, or pin them.

Card editing happens in a side panel or an inline expanding editor rather than a modal dialog, so editing a card does not hide the board. Clicking a card selects it and shows its details; double-clicking edits its title in place; double-clicking an empty cell creates a card there, pre-filled with that plot line and chapter or date (double rather than single, so a stray click on the board never adds a card). The side panel saves as you type, and a run of typing in one field is a single undo step. The date field is a small picker that understands the story's calendar, with month names from the calendar, partial-precision choices, and the named parts of the day. Undo and redo exist from the start, since dragging cards around makes accidental moves common. Styling uses Obsidian's theme variables so the board matches any light or dark theme.

The interface can be built with plain DOM code or a very small rendering library rather than a large framework, which keeps the plugin small and its startup fast. The plugin targets desktop Obsidian first, with mouse and keyboard, and is marked as desktop-only until mobile becomes a goal. Story files are ordinary notes, so they still sync to a phone and remain readable there as outlines. Drag and drop is written behind a small internal interface, so a touch-friendly pointer implementation can replace the first version later without touching the rest of the board. Rendering only the visible part of very large boards can wait until a story is large enough to need it.

## 12. Suggested Phasing

The first phase establishes the board in chapter mode with story notes as storage: creating and listing stories, the hybrid file format with validation and safe saving, plot lines, chapters, cards with title, synopsis, status and characters, sequence and compact modes, dragging, echoes for secondary plot lines, the side editing panel, undo, the transpose toggle with a global default, and snapshots before destructive operations.

The second phase adds story time: the custom calendar with presets (months, days per month, week, hours per day, named parts of the day), dated cards with partial precision, end dates and approximate dates, the small time zone system with character default zones and the converted-time display, the story-time view with zoom and collapsed gaps, the undated tray, and off-page events.

The third phase adds the character view (track and matrix), the character highlight toggle on the board, locations with zone inheritance and the clash warning, story tags, and relationship states.

A later phase (revision 5) adds profiles for characters and organizations, events with their tab and event modes, and the four-part outline. It is built in one step, as version 0.7.0, with the story format at version 3. Left for later:

- the reworked character track
- places and items as profiles
- deeper nesting of events
- event bands beside the dates in story time

The fourth phase adds note linking and creating notes from cards, board search and "Jump to card", export, and the overview minimap. Planner word counts and, eventually, multiple calendars per story are optional additions after that.

The order can change. Since story time with real dates is central to the stories this is for, phases one and two could reasonably be built together, as the data model already supports both.

## 13. Development Setup and Test Vault

### Repository

The plugin will live in its own GitHub repository, which Eleanore creates. I can't create GitHub repositories from here, but I can do everything after that. It takes three steps. First, create an empty repository on GitHub, for example named `storyplanner`, either private or public. It can be completely empty or have only a README. Second, connect your GitHub account to Claude at https://claude.ai/connect-github and, on that same page, install the Claude GitHub App on the new repository. Third, add the repository to this project under Project settings, in the repositories (resources) section. From then on, a thread can clone it, scaffold the plugin, and open pull requests for you to review.

The repository would follow the layout of Obsidian's official sample plugin: TypeScript source in `src/`, a `manifest.json` and `versions.json`, a `styles.css`, and an esbuild configuration that bundles everything into a single `main.js`. A watch mode rebuilds on every save. The design document itself can move into a `docs/` folder in the repository, so the design and the code stay together.

### The test vault

A test vault is a good idea. Developing against a real writing vault risks damaging real work, and because a story note's format is something the plugin writes, testing format changes in a throwaway vault is especially important. The proposal is to keep the test vault inside the repository, in a folder such as `test-vault/`. The vault would hold its own `.obsidian` settings, with the plugin's build output placed in `test-vault/.obsidian/plugins/storyplanner/`. The build can copy its output there automatically. The vault would also contain a few sample story notes that exercise the design. One would be a small, simple story. Another would use a custom calendar with unusual month lengths, several time zones and nested locations. A third would be a large generated story with a few hundred cards, for checking performance.

On Windows you then open `test-vault` as a vault in Obsidian ("Open folder as vault"), turn on community plugins, and enable StoryPlanner. While developing, the community plugin "Hot Reload" reloads the plugin whenever the build output changes, so you see each change without restarting Obsidian. Obsidian's per-device files, such as `workspace.json`, are excluded from the repository so that opening the vault does not create noise in version control. If a sample story gets damaged during testing, it can be restored from the repository with one command.

The sample stories also act as fixtures for automated tests. Tests for the file format (reading, writing, validation and recovery from a damaged data block) and for the calendar and time zone arithmetic can run without Obsidian at all, under a standard test runner. These two areas are where subtle bugs would hurt most.

## 14. Open Questions

All design questions so far are settled. The only remaining step is setting up the repository described in section 13. Once it is connected to the project, building can start with phase one.

## 15. Profiles: Characters and Organizations

Characters and organizations are both entities. An entity has these fields:

- a name, and a short name for tight spaces such as chips on cards
- a colour
- a one- or two-line summary, and a longer description
- values for the story's own fields
- a linked note

The story's own fields are defined in story setup, each as text, a date, or a choice, and each applies to characters, organizations, or both. Deleting a field deletes its values.

A character also has:

- aliases, and a role in the story, in the writer's own words
- birth and death dates in the story's calendar; with a birth date, the card panel shows the character's age in each dated scene
- memberships in organizations, each with an optional rank and the story dates it runs from and until

An organization can be part of another, to any depth, but never inside itself. Its members are not stored on the organization: they are worked out from the characters' memberships, so they can never disagree.

The Profiles mode of the Characters view lists the characters (or, with a switch, the organizations) on the left and shows the chosen profile on the right. The profile uses the same property rows as the card panel. Below the properties, the profile shows what the scenes say:

- the first and last appearance
- how many scenes in each role
- the plot lines the scenes are in
- every scene, in reading order; clicking one opens it on the board

Scenes name organizations as involved (a solid outline) or mentioned (dashed), and clicking the role word cycles between the two, as for characters. Several selected cards can be given an organization at once. Cards can show their organizations through a card field toggle, and the board highlight can pick an organization, either alone or together with its members' scenes.

## 16. Events

An event is something that happens across several scenes, such as a siege or a wedding. It has these fields:

- a title, a synopsis, a colour, and an optional status
- an optional parent: the arc it is part of. Only one level of nesting is allowed, so an arc holds events and an event holds scenes.
- its stretch of story time, worked out from its scenes' dates, unless the writer sets a start or end by hand
- for an event without scenes, the chapter where the board shows it

A card belongs to at most one event (the card field `event`). Cards in no event stay loose everywhere. There are four places to work with events:

- **The Events tab:** the arcs, their events, and each event's scenes in story order. Dragging regroups them: a scene dropped on an event joins it, an event dropped on the middle of a top-level event goes inside it, and an event dropped above or below another moves there. Clicking an event opens its page, which is built like the card panel and lists what its scenes bring together: characters, organizations, places, dates and the scenes themselves.
- **Event mode on the board:** in each plot line, an event's scenes become one block across their rows. A block may run over empty cells but never over another scene; where another scene or a chapter boundary interrupts the run, a new block starts. The arrow on a block shows that event's scenes as cards again, and the event line on those cards folds them back. Events with no scenes yet wait in a strip above the board.
- **Event mode in story time:** the same blocks, which here may also run across the gaps between spans of time. A separate column of event bands beside the dates was considered and left out, because events overlap in time and would need several tracks of bands.
- **The card panel:** an Event property, with "New event…" in its list. Several selected cards can be given an event at once.

## 17. The Outline

The Outline tab and the exported outline note share one structure:

1. **Story:** the logline, genre, premise, themes and notes, edited in story setup or in place.
2. **Characters:** each one's name, then their aliases, role, organizations, birth and death and own fields, then their summary.
3. **Organizations:** each one's name, then what it is part of, its members and its own fields, then its summary.
4. **Plot:** the plot lines with their synopses, then acts, chapters, events and scenes in board order. A chapter's scenes are grouped into runs by event. An event's synopsis appears the first time the event does. Scenes in no event that follow an event's get an "Other scenes" heading. Each chapter's background events come last.

In the tab, titles and synopses are edited in place:

- Enter starts a new line in a synopsis and leaves a title.
- Escape leaves either.
- Each part, act and chapter folds.
- Scenes keep their plot line's colour in the margin.
- A grip reorders a chapter's scenes, and a small arrow goes to a scene on the board.

The export ends each card's title line (and each line inside a synopsis) with two spaces, so line breaks survive with strict line breaks on. The readable outline inside the story note also gains short sections for the story, its characters, organizations and plot lines, and notes each scene's organizations and event.
