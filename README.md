# Story Planner for Obsidian

A lightweight plot-planning plugin for Obsidian. Plan a story as cards on a board organized by plot lines and chapters, switch to an in-world "story time" view with custom calendars and time zones, and follow what each character does across the timeline. Each story is stored as a single note in your vault, so your notes, backups, file recovery and sync all cover it, and the plugin never spreads data across the vault.

This project is in early development. The full design is in [docs/design.md](docs/design.md).

## What works so far

The foundation is in place. You can create a story with the "Create new story" command or by right-clicking a folder and choosing "New story here". You can open any story from the ribbon icon or the "Open story" command. Story notes open as a board automatically, with plot lines as columns and chapters as rows, and scenes run down in scene order, with parallel scenes in different plot lines able to share a row. Off-page events appear in their own group at the end. You can add plot lines and chapters, and rename them by double-clicking their headers. Tabs above the board switch between views, like the views of a Notion database: Board, and Setup, a page for the story's title, plot lines (name, colour, order), chapters and characters; deleting a plot line or chapter that has cards asks where they should go, and duplicate characters can be merged. Each story remembers which tab it was on. Before deleting a plot line, chapter or character that cards use, or merging characters, the plugin keeps a safety snapshot of the whole story in its own folder (`.obsidian/plugins/story-planner/snapshots`, never as a note); the Setup tab lists them with a Restore button, the "Restore story from a snapshot" command does the same, and a story that cannot be read offers them too. The plugin settings turn snapshots off or change how many are kept per story (10 by default). The Compact button stacks each plot line's cards from the top of the chapter, for a quick look at how busy each plot line is. Clicking a card opens it in a side panel, where you edit its title, synopsis, status, plot line, chapter, echoes and characters, or delete it; the panel saves as you type. Double-click a card to rename it in place, double-click an empty spot to create a card there, or click a chapter's "+" to add one at its end. Drag a card to reorder scenes, move it to another chapter or the off-page group, or change its plot line; drag a plot line or chapter header to reorder it. Every change can be undone and redone with the toolbar buttons or Ctrl+Z and Ctrl+Shift+Z (or Ctrl+Y). A card that touches more than one plot line shows a title-only echo in its secondary plot lines. The transpose button in the view header flips the board between vertical and horizontal layouts, and each story remembers its choice. The "Open as Markdown" button shows the note's readable outline.

Story time has begun. Each story has its own calendar, edited on the Setup tab: months with their own lengths, a simple leap rule, eras (including one that counts down, like BC), a week of any length anchored to a known date, any number of hours per day and minutes per hour, and named parts of the day such as dawn. Presets give a Gregorian-style calendar, the same without leap years, twelve months of thirty days, or a blank one to build from. Time zones have a name and an offset from a reference zone; characters can have a default zone. In the card panel, "When" dates a card as precisely as you know it (a year, a month, a day, a clock time or a part of the day), with an optional zone, an "approximate" flag and an end date, and the panel names the weekday and says why a date the calendar cannot have is not saved. Dates show on the cards. The story-time view itself comes next.

## How a story is stored

A story note has frontmatter with `storyplanner: story`, a readable outline that the plugin regenerates on every save, and a data block at the end inside an Obsidian `%%` comment, with one line for the story setup and one line per card. Edit in the board and read anywhere: text edits to the outline are replaced on the next save. The format lives in `src/format/storyFile.ts`.

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
4. Optionally, install the community plugin "Hot Reload". It reloads Story Planner whenever the build changes, so you don't have to restart Obsidian.

The build output and Obsidian's per-device files in the test vault are not committed. To build into another vault instead, set `OBSIDIAN_PLUGIN_DIR` to that vault's plugin folder, for example in PowerShell: `$env:OBSIDIAN_PLUGIN_DIR = "E:\Vaults\Writing\.obsidian\plugins\story-planner"; npm run dev`.
