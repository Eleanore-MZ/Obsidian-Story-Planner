import type { Zoom } from "./view/timeLayout";
import type { TrackAxis } from "./view/trackLayout";
import { App, PluginSettingTab, Setting } from "obsidian";
import { formatStoryDate } from "./model/calendar";
import { DATE_TOKENS, DEFAULT_DATE_FORMAT, DEFAULT_TIME_FORMAT, setDefaultFormats, TIME_TOKENS } from "./model/dateFormat";
import { createEmptyStory } from "./model/defaults";
import type StoryPlannerPlugin from "./main";
import { Orientation } from "./view/layout";

/** The views of a story, shown as tabs above it. */
export type StoryTab = "board" | "time" | "characters" | "setup";

/** Per-story view preferences. Kept in data.json so viewing never changes the story note. */
export interface StoryViewState {
  orientation?: Orientation;
  /** Compact mode: each plot line's cards stack from the top of the chapter. */
  compact?: boolean;
  tab?: StoryTab;
  /** The view story setup was opened from, to go back to when it closes. */
  lastView?: StoryTab;
  /** Story time: layout, zoom, and which zone times are shown in ("" for each card's own local time). */
  timeOrientation?: Orientation;
  zoom?: Zoom;
  timeZoneView?: string;
  /** A character, tag or place to make stand out, as "character:id", "tag:id" or "location:id". */
  highlight?: string;
  /** Character view: track or matrix, the characters chosen as lanes (in order), axis and layout. */
  characterMode?: "track" | "matrix";
  characterLanes?: string[];
  characterAxis?: TrackAxis;
  characterOrientation?: Orientation;
  /** With two or more lanes, show only the scenes they share. */
  sharedOnly?: boolean;
  /** Show the overview minimap beside the board. */
  minimap?: boolean;
  /** Folded chapters on the main board, by id ("" is the off-page group). */
  foldedChapters?: string[];
  /** Folded lanes: plot lines (main board and story time) and characters (character track). */
  foldedPlotLines?: string[];
  foldedCharacters?: string[];
  /** Lane widths in pixels set by dragging, by plot line or character id. */
  laneWidths?: Record<string, number>;
  characterLaneWidths?: Record<string, number>;
}

/** The views that are tabs, in the default order. Setup is not one: it opens from the gear button. */
export const ALL_TABS: StoryTab[] = ["board", "time", "characters"];

/** The tabs in the writer's order: unknown ones (and setup, from older settings) dropped, missing ones added at the end. */
export function orderedTabs(order: StoryTab[] | undefined): StoryTab[] {
  const known = (order ?? []).filter((t, i, all) => ALL_TABS.includes(t) && all.indexOf(t) === i);
  return [...known, ...ALL_TABS.filter((t) => !known.includes(t))];
}

/** The key that, held while dropping a card on another plot line, adds an echo there instead of moving it. */
export type EchoModifier = "alt" | "ctrl" | "shift" | "off";

export interface StoryPlannerSettings {
  /** How story dates and times are shown, unless a story sets its own; see model/dateFormat.ts. */
  dateFormat: string;
  timeFormat: string;
  echoModifier: EchoModifier;
  /** The order of the view tabs, the same for every story. */
  tabOrder: StoryTab[];
  defaultOrientation: Orientation;
  defaultStoryTimeOrientation: Orientation;
  /** Folder offered by the "New story" command; empty means the vault root. */
  newStoryFolder: string;
  /** Folder for notes created from cards; empty means the story's own folder. */
  cardNoteFolder: string;
  /** Vault path of a template note for notes created from cards; empty uses the built-in one. */
  cardNoteTemplate: string;
  /** Open story notes as boards automatically. */
  autoOpenStories: boolean;
  /** Keep a safety snapshot of a story before large deletions and merges. */
  snapshotsEnabled: boolean;
  /** How many snapshots to keep for each story. */
  snapshotsPerStory: number;
  /** View state per story, keyed by vault path. */
  viewState: Record<string, StoryViewState>;
}

export const DEFAULT_SETTINGS: StoryPlannerSettings = {
  dateFormat: DEFAULT_DATE_FORMAT,
  timeFormat: DEFAULT_TIME_FORMAT,
  echoModifier: "alt",
  tabOrder: [...ALL_TABS],
  defaultOrientation: "vertical",
  defaultStoryTimeOrientation: "vertical",
  newStoryFolder: "",
  cardNoteFolder: "",
  cardNoteTemplate: "",
  autoOpenStories: true,
  snapshotsEnabled: true,
  snapshotsPerStory: 10,
  viewState: {},
};

export class StoryPlannerSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: StoryPlannerPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const orientationOptions = {
      vertical: "Vertical (chapters down, plot lines across)",
      horizontal: "Horizontal (chapters across, plot lines down)",
    };
    const timeOrientationOptions = {
      vertical: "Vertical (time down, plot lines across)",
      horizontal: "Horizontal (time across, plot lines down)",
    };

    new Setting(containerEl)
      .setName("Default layout")
      .setDesc("How new boards are laid out in chapter view. Each story remembers its own choice after that.")
      .addDropdown((d) =>
        d
          .addOptions(orientationOptions)
          .setValue(this.plugin.settings.defaultOrientation)
          .onChange(async (value) => {
            this.plugin.settings.defaultOrientation = value as Orientation;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Default layout for story time")
      .setDesc("How boards are laid out when switched to story time.")
      .addDropdown((d) =>
        d
          .addOptions(timeOrientationOptions)
          .setValue(this.plugin.settings.defaultStoryTimeOrientation)
          .onChange(async (value) => {
            this.plugin.settings.defaultStoryTimeOrientation = value as Orientation;
            await this.plugin.saveSettings();
          }),
      );

    // Dates and times, with a preview of a sample date as it would show.
    const sample = createEmptyStory("Sample");
    const preview = () => {
      const formats = { date: this.plugin.settings.dateFormat || DEFAULT_DATE_FORMAT, time: this.plugin.settings.timeFormat || DEFAULT_TIME_FORMAT };
      const full = formatStoryDate(sample, { calendar: "main", year: 2024, month: 3, day: 2, minutes: 9 * 60 + 30 }, { formats });
      const month = formatStoryDate(sample, { calendar: "main", year: 2024, month: 3 }, { formats });
      return `For example: ${full}, or ${month} for a date with only a month.`;
    };
    const tokenHelp = (tokens: [string, string][]) => tokens.map(([t, what]) => `${t} ${what}`).join(" · ");
    const saveFormats = async () => {
      setDefaultFormats({ date: this.plugin.settings.dateFormat, time: this.plugin.settings.timeFormat });
      await this.plugin.saveSettings();
      this.plugin.refreshBoards();
    };
    const dateSetting = new Setting(containerEl)
      .setName("Date format")
      .setDesc(`How story dates are shown. ${tokenHelp(DATE_TOKENS)}. Parts a date does not have are left out. Text in [brackets] is kept as it is. A story can set its own in Setup.`)
      .addText((t) =>
        t
          .setPlaceholder(DEFAULT_DATE_FORMAT)
          .setValue(this.plugin.settings.dateFormat)
          .onChange(async (value) => {
            this.plugin.settings.dateFormat = value.trim() || DEFAULT_DATE_FORMAT;
            datePreview.setText(preview());
            await saveFormats();
          }),
      );
    const datePreview = dateSetting.descEl.createDiv({ cls: "story-planner-format-preview", text: preview() });
    new Setting(containerEl)
      .setName("Time format")
      .setDesc(`How clock times are shown after the date. ${tokenHelp(TIME_TOKENS)}. Named parts of the day, such as Morning, are shown by name.`)
      .addText((t) =>
        t
          .setPlaceholder(DEFAULT_TIME_FORMAT)
          .setValue(this.plugin.settings.timeFormat)
          .onChange(async (value) => {
            this.plugin.settings.timeFormat = value.trim() || DEFAULT_TIME_FORMAT;
            datePreview.setText(preview());
            await saveFormats();
          }),
      );

    new Setting(containerEl)
      .setName("Key for dropping an echo")
      .setDesc(
        "Hold this key while dropping a card on another plot line to show the card there as an echo, instead of moving it. On Windows, Ctrl is the usual key for copying while dragging.",
      )
      .addDropdown((d) =>
        d
          .addOptions({ alt: "Alt", ctrl: "Ctrl (Cmd on Mac)", shift: "Shift", off: "Off" })
          .setValue(this.plugin.settings.echoModifier)
          .onChange(async (value) => {
            this.plugin.settings.echoModifier = value as EchoModifier;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Folder for new stories")
      .setDesc("Where the \"Create new story\" command puts new story notes. Leave empty for the vault root. You can also right-click any folder and choose \"New story here\".")
      .addText((t) =>
        t
          .setPlaceholder("Stories")
          .setValue(this.plugin.settings.newStoryFolder)
          .onChange(async (value) => {
            this.plugin.settings.newStoryFolder = value.trim().replace(/^\/+|\/+$/g, "");
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Folder for notes made from cards")
      .setDesc("Where \"Create note from card\" puts new notes. Leave empty to put them beside the story note.")
      .addText((t) =>
        t
          .setPlaceholder("Drafts")
          .setValue(this.plugin.settings.cardNoteFolder)
          .onChange(async (value) => {
            this.plugin.settings.cardNoteFolder = value.trim().replace(/^\/+|\/+$/g, "");
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Template for notes made from cards")
      .setDesc(
        "Path of a note to copy into each new note, such as Templates/Scene.md. It can use {{title}}, {{synopsis}}, {{story}}, {{plotLine}}, {{chapter}}, {{date}}, {{location}}, {{characters}} and {{written}}. Leave empty for a short built-in template. The template is used once, when the note is made; after that the note is yours.",
      )
      .addText((t) =>
        t
          .setPlaceholder("Templates/Scene.md")
          .setValue(this.plugin.settings.cardNoteTemplate)
          .onChange(async (value) => {
            this.plugin.settings.cardNoteTemplate = value.trim().replace(/^\/+/, "");
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Open stories as boards")
      .setDesc("Open story notes as boards automatically. When off, use \"Open as story board\" from the command palette or the file menu.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.autoOpenStories).onChange(async (value) => {
          this.plugin.settings.autoOpenStories = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Safety snapshots")
      .setDesc(
        "Before deleting a plot line, chapter or character that cards use, or merging characters, keep a copy of the whole story in the plugin's folder. Restore one from the story's Setup tab or with the \"Restore story from a snapshot\" command.",
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.snapshotsEnabled).onChange(async (value) => {
          this.plugin.settings.snapshotsEnabled = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Snapshots kept per story")
      .setDesc("Older snapshots are removed once a story has more than this.")
      .addSlider((s) =>
        s
          .setLimits(1, 50, 1)
          .setValue(this.plugin.settings.snapshotsPerStory)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.snapshotsPerStory = value;
            await this.plugin.saveSettings();
          }),
      );
  }
}
