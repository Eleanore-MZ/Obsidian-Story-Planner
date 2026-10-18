import { App, PluginSettingTab, Setting } from "obsidian";
import type StoryPlannerPlugin from "./main";
import { Orientation } from "./view/layout";

/** Per-story view preferences. Kept in data.json so viewing never changes the story note. */
export interface StoryViewState {
  orientation?: Orientation;
  /** Compact mode: each plot line's cards stack from the top of the chapter. */
  compact?: boolean;
}

export interface StoryPlannerSettings {
  defaultOrientation: Orientation;
  defaultStoryTimeOrientation: Orientation;
  /** Folder offered by the "New story" command; empty means the vault root. */
  newStoryFolder: string;
  /** Open story notes as boards automatically. */
  autoOpenStories: boolean;
  /** View state per story, keyed by vault path. */
  viewState: Record<string, StoryViewState>;
}

export const DEFAULT_SETTINGS: StoryPlannerSettings = {
  defaultOrientation: "vertical",
  defaultStoryTimeOrientation: "horizontal",
  newStoryFolder: "",
  autoOpenStories: true,
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
          .addOptions(orientationOptions)
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
  }
}
