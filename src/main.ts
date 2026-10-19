import { FuzzySuggestModal, MarkdownView, normalizePath, Notice, Plugin, TAbstractFile, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { FRONTMATTER_KEY, FRONTMATTER_VALUE, serializeStory } from "./format/storyFile";
import { createEmptyStory } from "./model/defaults";
import { SnapshotInfo } from "./model/snapshots";
import { SnapshotStore } from "./snapshotStore";
import { DEFAULT_SETTINGS, StoryPlannerSettings, StoryPlannerSettingTab } from "./settings";
import { STORY_BOARD_VIEW, StoryBoardView } from "./view/StoryBoardView";
import { TextPromptModal } from "./view/modals";

export default class StoryPlannerPlugin extends Plugin {
  settings: StoryPlannerSettings = DEFAULT_SETTINGS;
  /** Story notes the user chose to read as Markdown in this session; auto-open leaves them alone. */
  private markdownOverride = new Set<string>();
  snapshots!: SnapshotStore;

  async onload(): Promise<void> {
    await this.loadSettings();
    const pluginDir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    this.snapshots = new SnapshotStore(this.app.vault.adapter, `${pluginDir}/snapshots`, () => this.settings.snapshotsPerStory);

    this.registerView(STORY_BOARD_VIEW, (leaf) => new StoryBoardView(leaf, this));
    this.addSettingTab(new StoryPlannerSettingTab(this.app, this));

    this.addRibbonIcon("layout-dashboard", "Open story", () => new StoryPickerModal(this).open());

    this.addCommand({
      id: "create-story",
      name: "Create new story",
      callback: () => this.promptNewStory(this.settings.newStoryFolder),
    });

    this.addCommand({
      id: "open-story",
      name: "Open story",
      callback: () => new StoryPickerModal(this).open(),
    });

    this.addCommand({
      id: "restore-snapshot",
      name: "Restore story from a snapshot",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(StoryBoardView);
        if (!view?.file) return false;
        if (!checking) void this.pickSnapshot(view);
        return true;
      },
    });

    this.addCommand({
      id: "open-as-board",
      name: "Open as story board",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !this.isStoryFile(file)) return false;
        if (!checking) void this.openAsBoard(this.app.workspace.getLeaf(false), file);
        return true;
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, target) => {
        if (target instanceof TFolder) {
          menu.addItem((item) =>
            item.setTitle("New story here").setIcon("layout-dashboard").onClick(() => this.promptNewStory(target.path)),
          );
        } else if (target instanceof TFile && this.isStoryFile(target)) {
          menu.addItem((item) =>
            item
              .setTitle("Open as story board")
              .setIcon("layout-dashboard")
              .onClick(() => this.openAsBoard(this.app.workspace.getLeaf(false), target)),
          );
        }
      }),
    );

    // Open story notes as boards when they are opened as Markdown.
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (!file || !this.settings.autoOpenStories || this.markdownOverride.has(file.path)) return;
        if (!this.isStoryFile(file)) return;
        for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
          if ((leaf.view as MarkdownView).file === file) void this.openAsBoard(leaf, file);
        }
      }),
    );

    // Keep per-story view state attached to the story when it is renamed or moved.
    this.registerEvent(
      this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
        const state = this.settings.viewState[oldPath];
        if (state) {
          delete this.settings.viewState[oldPath];
          this.settings.viewState[file.path] = state;
          void this.saveSettings();
        }
        if (this.markdownOverride.delete(oldPath)) this.markdownOverride.add(file.path);
        if (file instanceof TFile && file.extension === "md") void this.snapshots.renamed(oldPath, file.path);
      }),
    );
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, { viewState: {} }, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Uses the metadata cache, so it never reads file contents. */
  isStoryFile(file: TFile): boolean {
    if (file.extension !== "md") return false;
    return this.app.metadataCache.getFileCache(file)?.frontmatter?.[FRONTMATTER_KEY] === FRONTMATTER_VALUE;
  }

  storyFiles(): TFile[] {
    return this.app.vault.getMarkdownFiles().filter((f) => this.isStoryFile(f));
  }

  async openAsBoard(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
    this.markdownOverride.delete(file.path);
    await leaf.setViewState({ type: STORY_BOARD_VIEW, state: { file: file.path }, active: true });
  }

  async openAsMarkdown(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
    this.markdownOverride.add(file.path);
    await leaf.setViewState({ type: "markdown", state: { file: file.path }, active: true });
  }

  /** Lets the writer pick one of a story's snapshots and restores it on the board. */
  async pickSnapshot(view: StoryBoardView): Promise<void> {
    const snapshots = view.file ? await this.snapshots.list(view.file.path) : [];
    if (snapshots.length === 0) {
      new Notice("This story has no snapshots yet. One is kept before large deletions and merges.");
      return;
    }
    new SnapshotPickerModal(this, snapshots, (snapshot) => void view.restoreSnapshot(snapshot)).open();
  }

  private promptNewStory(folder: string): void {
    new TextPromptModal(this.app, "New story", "", (title) => void this.createStory(folder, title)).open();
  }

  async createStory(folder: string, title: string): Promise<void> {
    const safeName = title.replace(/[\\/:*?"<>|#^[\]]/g, "").trim() || "Untitled story";
    const dir = normalizePath(folder || "/");
    if (folder && !this.app.vault.getAbstractFileByPath(dir)) {
      await this.app.vault.createFolder(dir);
    }
    let path = normalizePath(`${folder ? dir + "/" : ""}${safeName}.md`);
    for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) {
      path = normalizePath(`${folder ? dir + "/" : ""}${safeName} ${n}.md`);
    }
    const file = await this.app.vault.create(path, serializeStory(createEmptyStory(title)));
    await this.openAsBoard(this.app.workspace.getLeaf(false), file);
    new Notice(`Created story "${title}"`);
  }
}

class StoryPickerModal extends FuzzySuggestModal<TFile> {
  constructor(private plugin: StoryPlannerPlugin) {
    super(plugin.app);
    this.setPlaceholder("Open a story…");
  }

  getItems(): TFile[] {
    return this.plugin.storyFiles();
  }

  getItemText(file: TFile): string {
    return file.path.replace(/\.md$/, "");
  }

  onChooseItem(file: TFile): void {
    void this.plugin.openAsBoard(this.app.workspace.getLeaf(false), file);
  }
}

class SnapshotPickerModal extends FuzzySuggestModal<SnapshotInfo> {
  constructor(
    plugin: StoryPlannerPlugin,
    private snapshots: SnapshotInfo[],
    private onPick: (snapshot: SnapshotInfo) => void,
  ) {
    super(plugin.app);
    this.setPlaceholder("Restore the story as it was…");
  }

  getItems(): SnapshotInfo[] {
    return this.snapshots;
  }

  getItemText(snapshot: SnapshotInfo): string {
    return `${new Date(snapshot.takenAt).toLocaleString()} · ${snapshot.reason}`;
  }

  onChooseItem(snapshot: SnapshotInfo): void {
    this.onPick(snapshot);
  }
}
