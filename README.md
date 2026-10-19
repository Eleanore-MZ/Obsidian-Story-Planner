# Story Planner for Obsidian

Plan a story on a board: plot lines across, chapters and scenes down, a card for every scene. Switch to story time to see the scenes in the order they happen, on your story's own calendar, or to the characters view to follow each person through the book. Every story is a single note in your vault, so your backups, sync and file recovery cover it.

Desktop only.

## Features

**Main board**
- Cards in plot line columns, chapter by chapter, in scene order; scenes in different plot lines can share a row.
- Drag cards, plot lines and chapters; hold Alt (configurable) while dropping to show a card as an echo in another plot line. The board scrolls when you drag to its edge.
- Chapters are numbered automatically and can have a title, a label such as "Prologue" and a synopsis. Acts group chapters, in a column of their own, and can be switched off per story.
- Fold chapters, acts and plot lines; resize columns; colour plot lines by category; mark scenes written with one click.
- Compact and cozy layouts, a transpose button, search (Ctrl+F), "Jump to card", a highlight for one character, tag or place, and a minimap.
- Undo and redo for every change (Ctrl+Z, Ctrl+Shift+Z); Delete removes the selected card.

**Card panel**
- Title, synopsis, scene tags, plot line and echoes, chapter, date and end date, place, characters with their roles, and linked notes, which open beside the board. "Create note from card" makes a note from a template.

**Story time**
- Scenes in the order they happen, at a zoom of years, months, days or times of day, with "3 days later" between distant dates. Cards with an end date run down to it.
- Each story has its own calendar: months, leap years, eras, weeks, hours per day and named times of day, plus time zones for places and characters.
- Dates are typed as you would write them: "2020/07/12 19:49", "20200712", "12 Jul 2020", "~2023/09", or "+3d" for an end date. The date and time format is yours to set.

**Characters**
- A track per character, by chapter or by story time, and a presence matrix of characters against chapters, with warnings when someone seems to be in two places at once.

**Story setup**
- Plot lines and categories, scene tags, acts and chapters, characters, places nested inside each other, the calendar and time zones, and safety snapshots taken before large deletions.
- Choose colours from a palette or pick a custom colour; edit and reorder the palette in plugin settings. New story elements use its colours in order.

**Export**
- The story as a readable Markdown outline, a CSV with one row per card, or JSON.

## Installing

Story Planner is not in Obsidian's community plugin list. Install it with the BRAT plugin, which also keeps it up to date:

1. In Obsidian, open Settings, Community plugins, Browse, and install and enable **BRAT** ("Obsidian42 - BRAT").
2. In BRAT's settings, choose **Add beta plugin** and enter `Eleanore-MZ/Obsidian-Story-Planner`.
3. Enable **Story Planner** under Settings, Community plugins.

BRAT checks for new releases when Obsidian starts (or with its "Check for updates" command) and installs them.

To install by hand instead, download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/Eleanore-MZ/Obsidian-Story-Planner/releases/latest) into `.obsidian/plugins/story-planner/` in your vault, then enable the plugin.

## Getting started

Create a story with the "Create new story" command, or right-click a folder and choose "New story here". Story notes open as a board; the ribbon icon and "Open story" list every story in the vault, and the story title on the board switches between them.

## How a story is stored

A story note has frontmatter with `storyplanner: story`, a readable outline that the plugin writes on every save, and the story's data at the end inside an Obsidian `%%` comment, one line for the setup and one per card. Edit on the board and read anywhere: changes typed into the outline are replaced on the next save. The plugin writes only to story notes and to notes you ask it to create.

## Releasing a new version

1. `npm run version-bump -- 0.2.0` (sets the version in `manifest.json`, `package.json` and `versions.json`).
2. Commit and push, then tag the commit with the same number and push the tag: `git tag 0.2.0` and `git push origin 0.2.0`.
3. The Release workflow builds the plugin and publishes a GitHub release with `main.js`, `manifest.json` and `styles.css`. BRAT picks it up from there.

## Development

You need Node.js 20 or later. On Windows, run these commands in PowerShell or the VS Code terminal from the repository folder.

```powershell
npm install
npm run dev      # rebuilds on every change and copies the plugin into test-vault
npm test         # runs the automated tests
npm run build    # type-checks and makes a production build
npm run samples  # regenerates the sample stories in test-vault/Stories
```

### The test vault

The `test-vault` folder is a ready-made Obsidian vault for development. Its sample stories cover a plain story, a story with an invented calendar, time zones, nested locations, characters and tags, and a large 320-card story for checking speed.

1. Run `npm run dev` and leave it running.
2. In Obsidian, choose "Open folder as vault" and pick the `test-vault` folder.
3. Turn on community plugins when Obsidian asks, then enable Story Planner under Settings, Community plugins.
4. Reload Obsidian after a build (Ctrl+P, "Reload app without saving"), or install the community plugin "Hot Reload", which reloads Story Planner whenever the build changes.

The build output and Obsidian's per-device files in the test vault are not committed. To build into another vault instead, set `OBSIDIAN_PLUGIN_DIR` to that vault's plugin folder, for example in PowerShell: `$env:OBSIDIAN_PLUGIN_DIR = "E:\Vaults\Writing\.obsidian\plugins\story-planner"; npm run dev`.
