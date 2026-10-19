import type { Zoom } from "./view/timeLayout";
import type { TrackAxis } from "./view/trackLayout";
import { App, PluginSettingTab, Setting } from "obsidian";
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
}

export interface StoryPlannerSettings {
  defaultOrientation: Orientation;
  defaultStoryTimeOrientation: Orientation;
  /** Folder offered by the "New story" command; empty means the vault root. */
  newStoryFolder: string;
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
  defaultOrientation: "vertical",
  defaultStoryTimeOrientation: "vertical",
  newStoryFolder: "",
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
