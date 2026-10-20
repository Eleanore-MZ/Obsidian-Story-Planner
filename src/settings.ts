import type { Zoom } from "./view/timeLayout";
import type { TrackAxis } from "./view/trackLayout";
import { App, PluginSettingTab, Setting } from "obsidian";
import { formatStoryDate } from "./model/calendar";
import { DATE_TOKENS, DEFAULT_DATE_FORMAT, DEFAULT_TIME_FORMAT, setDefaultFormats, TIME_TOKENS } from "./model/dateFormat";
import { createEmptyStory } from "./model/defaults";
import { cleanPalette, DEFAULT_PALETTE, normalizeHex, setPalette } from "./model/palette";
import { reorderHandle } from "./view/reorder";
import type StoryPlannerPlugin from "./main";
import { Orientation } from "./view/layout";

/** The views of a story, shown as tabs above it. */
export type StoryTab = "board" | "time" | "characters" | "outline" | "setup";

/** Per-story view preferences. Kept in data.json so viewing never changes the story note. */
export interface StoryViewState {
  orientation?: Orientation;
  /** Compact mode: each plot line's cards stack from the top of the chapter. */
  compact?: boolean;
  tab?: StoryTab;
  /** The view story setup was opened from, to go back to when it closes. */
  lastView?: StoryTab;
  /** The section of story setup last open. */
  setupSection?: "story" | "chapters" | "characters" | "time" | "safety";
  /** Story time: layout, zoom, and which zone times are shown in ("" for each card's own local time). */
  timeOrientation?: Orientation;
  zoom?: Zoom;
  timeZoneView?: string;
  /** Story time shows every span from the first to the last, not only those with cards. */
  expandTimeline?: boolean;
  /** The clock zoom's block, in minutes, set with Ctrl+wheel; never shorter than the story's shortest. */
  clockBlock?: number;
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
  /** Main board: leave out off-page events, both the off-page group and chapters' background rows. */
  hideOffPage?: boolean;
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
export const ALL_TABS: StoryTab[] = ["board", "time", "characters", "outline"];

/** The tabs in the writer's order: unknown ones (and setup, from older settings) dropped, missing ones added at the end. */
export function orderedTabs(order: StoryTab[] | undefined): StoryTab[] {
  const known = (order ?? []).filter((t, i, all) => ALL_TABS.includes(t) && all.indexOf(t) === i);
  return [...known, ...ALL_TABS.filter((t) => !known.includes(t))];
}

/** Where a clicked card opens. */
export type CardOpening = "side" | "centre";

/** What cards on the board can show besides their title. */
export type CardShow = "chapter" | "date" | "synopsis" | "tags" | "characters" | "place" | "written" | "notes";

export const CARD_SHOW_LABELS: Record<CardShow, string> = {
  chapter: "Chapter (in story time and the character views)",
  date: "Date and time",
  synopsis: "Synopsis",
  tags: "Scene tags",
  characters: "Characters",
  place: "Place",
  written: "Written box",
  notes: "Linked notes",
};

export const DEFAULT_CARD_SHOWS: Record<CardShow, boolean> = {
  chapter: true,
  date: true,
  synopsis: true,
  tags: true,
  characters: false,
  place: true,
  written: true,
  notes: true,
};

/** The key that, held while dropping a card on another plot line, adds an echo there instead of moving it. */
export type EchoModifier = "alt" | "ctrl" | "shift" | "off";

export interface StoryPlannerSettings {
  /** The colours new plot lines, characters, categories and tags take, and the colour board offers. */
  palette: string[];
  /** How story dates and times are shown, unless a story sets its own; see model/dateFormat.ts. */
  dateFormat: string;
  timeFormat: string;
  echoModifier: EchoModifier;
  /** Where a clicked card opens: the side panel, or a page in the middle over the board. */
  cardOpening: CardOpening;
  /** What cards on the board show. */
  cardShows: Record<CardShow, boolean>;
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
  palette: [...DEFAULT_PALETTE],
  dateFormat: DEFAULT_DATE_FORMAT,
  timeFormat: DEFAULT_TIME_FORMAT,
  echoModifier: "alt",
  cardOpening: "side",
  cardShows: { ...DEFAULT_CARD_SHOWS },
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

  private async savePalette(colors: string[]): Promise<void> {
    this.plugin.settings.palette = cleanPalette(colors);
    setPalette(this.plugin.settings.palette);
    await this.plugin.saveSettings();
  }

  /** The palette as a list: drag to reorder, click a square to change it, type a hex code, or remove it. */
  private drawPalette(list: HTMLElement): void {
    list.empty();
    const colors = [...this.plugin.settings.palette];
    const redraw = async (next: string[]) => {
      await this.savePalette(next);
      this.drawPalette(list);
    };
    colors.forEach((color, i) => {
      const row = list.createDiv({ cls: "story-planner-palette-row" });
      reorderHandle(row, "palette", i, (to) => {
        const next = [...colors];
        const [moved] = next.splice(i, 1);
        next.splice(to, 0, moved!);
        void redraw(next);
      });
      const pick = row.createEl("input", { cls: "story-planner-palette-color" });
      pick.type = "color";
      pick.value = color;
      const hex = row.createEl("input", { cls: "story-planner-palette-hex" });
      hex.type = "text";
      hex.value = color;
      hex.spellcheck = false;
      pick.addEventListener("change", () => {
        colors[i] = pick.value;
        void redraw(colors);
      });
      hex.addEventListener("change", () => {
        const value = normalizeHex(hex.value);
        if (!value) {
          hex.value = color;
          return;
        }
        colors[i] = value;
        void redraw(colors);
      });
      const remove = row.createEl("button", { cls: "clickable-icon", text: "×" });
      remove.setAttr("aria-label", "Remove");
      remove.disabled = colors.length <= 1;
      remove.addEventListener("click", () => void redraw(colors.filter((_, k) => k !== i)));
    });
    const add = list.createEl("button", { text: "+ Add colour" });
    add.addEventListener("click", () => {
      const color = Array.from({ length: 256 }, (_, n) => `#${n.toString(16).padStart(2, "0").repeat(3)}`)
        .find((candidate) => !colors.includes(candidate)) ?? "#888888";
      void redraw([...colors, color]);
    });
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

    new Setting(containerEl).setName("Board").setHeading();

    new Setting(containerEl)
      .setName("Default layout")
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
      .addDropdown((d) =>
        d
          .addOptions(timeOrientationOptions)
          .setValue(this.plugin.settings.defaultStoryTimeOrientation)
          .onChange(async (value) => {
            this.plugin.settings.defaultStoryTimeOrientation = value as Orientation;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Open cards")
      .addDropdown((d) =>
        d
          .addOptions({ side: "In the side panel", centre: "In the middle, over the board" })
          .setValue(this.plugin.settings.cardOpening)
          .onChange(async (value) => {
            this.plugin.settings.cardOpening = value as CardOpening;
            await this.plugin.saveSettings();
            this.plugin.refreshBoards();
          }),
      );

    new Setting(containerEl)
      .setName("Key for dropping an echo")
      .setDesc("Hold while dropping a card on another plot line.")
      .addDropdown((d) =>
        d
          .addOptions({ alt: "Alt", ctrl: "Ctrl (Cmd on Mac)", shift: "Shift", off: "Off" })
          .setValue(this.plugin.settings.echoModifier)
          .onChange(async (value) => {
            this.plugin.settings.echoModifier = value as EchoModifier;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName("Dates & times").setHeading();

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
      .setDesc(`Tokens: ${DATE_TOKENS.map(([t]) => t).join(" ")}`)
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
      .setDesc(`Tokens: ${TIME_TOKENS.map(([t]) => t).join(" ")}`)
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

    new Setting(containerEl).setName("Files").setHeading();

    new Setting(containerEl)
      .setName("Folder for new stories")
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
      .setDesc("Uses {{title}}, {{synopsis}}, {{chapter}}, {{date}}, {{location}}, {{characters}} and similar.")
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
      .addToggle((t) =>
        t.setValue(this.plugin.settings.autoOpenStories).onChange(async (value) => {
          this.plugin.settings.autoOpenStories = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName("Layout").setHeading();
    containerEl.createDiv({ cls: "setting-item-description story-planner-settings-note", text: "What cards on the board show besides their title." });
    for (const key of Object.keys(CARD_SHOW_LABELS) as CardShow[]) {
      new Setting(containerEl).setName(CARD_SHOW_LABELS[key]).addToggle((t) =>
        t.setValue(this.plugin.settings.cardShows[key]).onChange(async (value) => {
          this.plugin.settings.cardShows = { ...this.plugin.settings.cardShows, [key]: value };
          await this.plugin.saveSettings();
          this.plugin.refreshBoards();
        }),
      );
    }

    new Setting(containerEl).setName("Colours").setHeading();
    const palette = new Setting(containerEl).setName("Colour palette").setDesc("Offered by every colour square, and given in turn to new plot lines, characters, categories and tags.");
    palette.addButton((b) =>
      b.setButtonText("Reset to default").onClick(async () => {
        await this.savePalette([...DEFAULT_PALETTE]);
        this.drawPalette(list);
      }),
    );
    const list = containerEl.createDiv({ cls: "story-planner-palette-editor" });
    this.drawPalette(list);

    new Setting(containerEl).setName("Safety").setHeading();

    new Setting(containerEl)
      .setName("Safety snapshots")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.snapshotsEnabled).onChange(async (value) => {
          this.plugin.settings.snapshotsEnabled = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Snapshots kept per story")
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
