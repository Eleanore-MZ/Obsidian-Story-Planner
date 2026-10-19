import { FuzzySuggestModal, MarkdownView, normalizePath, Notice, Plugin, TAbstractFile, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { FRONTMATTER_KEY, FRONTMATTER_VALUE, parseStory, serializeStory } from "./format/storyFile";
import { createEmptyStory } from "./model/defaults";
import { DEFAULT_NOTE_TEMPLATE, fillTemplate, noteFileName, noteValues, renameLinkedPath } from "./model/links";
import { cardsInReadingOrder } from "./model/search";
import { chapterTitleOf } from "./model/chapters";
import { setDefaultFormats } from "./model/dateFormat";
import { cleanPalette, setPalette } from "./model/palette";
import { EXPORT_EXTENSIONS, exportStory } from "./format/export";
import { Card, Story } from "./model/types";
import { SnapshotInfo } from "./model/snapshots";
import { SnapshotStore } from "./snapshotStore";
import { DEFAULT_SETTINGS, StoryPlannerSettings, StoryPlannerSettingTab } from "./settings";
import { STORY_BOARD_VIEW, StoryBoardView } from "./view/StoryBoardView";
import { registerIcon, STORY_ICON } from "./icon";
import { ExportChoice, ExportModal, TextPromptModal } from "./view/modals";

export default class StoryPlannerPlugin extends Plugin {
  settings: StoryPlannerSettings = DEFAULT_SETTINGS;
  /** Story notes the user chose to read as Markdown in this session; auto-open leaves them alone. */
  private markdownOverride = new Set<string>();
  snapshots!: SnapshotStore;
  /** The pane linked notes open in, beside the board; reused while it is open. */
  private noteLeaf: WorkspaceLeaf | null = null;

  async onload(): Promise<void> {
    registerIcon();
    await this.loadSettings();
    const pluginDir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    this.snapshots = new SnapshotStore(this.app.vault.adapter, `${pluginDir}/snapshots`, () => this.settings.snapshotsPerStory);

    this.registerView(STORY_BOARD_VIEW, (leaf) => new StoryBoardView(leaf, this));
    this.addSettingTab(new StoryPlannerSettingTab(this.app, this));

    this.addRibbonIcon(STORY_ICON, "Open story", () => new StoryPickerModal(this).open());

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
      id: "jump-to-card",
      name: "Jump to card",
      callback: () => void this.jumpToCard(),
    });

    this.addCommand({
      id: "export-story",
      name: "Export story",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(StoryBoardView);
        if (!view?.file || !view.currentStory) return false;
        if (!checking) this.promptExport(view.file, view.currentStory);
        return true;
      },
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
            item.setTitle("New story here").setIcon(STORY_ICON).onClick(() => this.promptNewStory(target.path)),
          );
        } else if (target instanceof TFile && this.isStoryFile(target)) {
          menu.addItem((item) =>
            item
              .setTitle("Open as story board")
              .setIcon(STORY_ICON)
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
        void this.followRename(oldPath, file.path);
      }),
    );

    // Boards show a broken-link marker for linked notes that are gone, and drop it when they come back.
    this.registerEvent(this.app.vault.on("delete", (file) => this.refreshLinks(file.path)));
    this.registerEvent(this.app.vault.on("create", (file) => this.refreshLinks(file.path)));
  }

  private boards(): StoryBoardView[] {
    return this.app.workspace
      .getLeavesOfType(STORY_BOARD_VIEW)
      .map((leaf) => leaf.view)
      .filter((view): view is StoryBoardView => view instanceof StoryBoardView);
  }

  /** Redraws every open board, after a change to settings they all share. */
  refreshBoards(): void {
    for (const view of this.boards()) view.refresh();
  }

  private refreshLinks(path: string): void {
    for (const view of this.boards()) view.linksChanged(path);
  }

  /**
   * Keeps links pointing at a note (or the notes in a folder) after it is
   * renamed or moved. Open boards update in memory and save at once; other
   * stories are rewritten only if they link to it, and never if they cannot
   * be read.
   */
  private async followRename(oldPath: string, newPath: string): Promise<void> {
    const open = new Set<string>();
    for (const view of this.boards()) {
      if (!view.file) continue;
      open.add(view.file.path);
      await view.followRename(oldPath, newPath);
    }
    for (const story of this.storyFiles()) {
      if (open.has(story.path)) continue;
      const text = await this.app.vault.cachedRead(story);
      if (!text.includes(oldPath)) continue;
      await this.app.vault.process(story, (current) => {
        const parsed = parseStory(current);
        if (!parsed.ok || !renameLinkedPath(parsed.story, oldPath, newPath)) return current;
        return serializeStory(parsed.story, parsed.frontmatter);
      });
    }
  }

  /**
   * Lets the writer pick a card and shows it on its board. From a board, the
   * cards of that story come first; the cards of every other story follow.
   */
  private async jumpToCard(): Promise<void> {
    const active = this.app.workspace.getActiveViewOfType(StoryBoardView);
    const items: CardChoice[] = [];
    const add = (file: TFile, story: Story) => {
      for (const card of cardsInReadingOrder(story)) {
        const where = chapterTitleOf(story, card.chapter);
        items.push({ file, cardId: card.id, text: `${card.title} · ${where} · ${story.title}` });
      }
    };
    const open = new Map(this.boards().filter((v) => v.file).map((v) => [v.file!.path, v]));
    if (active?.file && active.currentStory) add(active.file, active.currentStory);
    for (const file of this.storyFiles()) {
      if (file === active?.file) continue;
      const inMemory = open.get(file.path)?.currentStory;
      if (inMemory) {
        add(file, inMemory);
        continue;
      }
      const parsed = parseStory(await this.app.vault.cachedRead(file));
      if (parsed.ok) add(file, parsed.story);
    }
    if (items.length === 0) {
      new Notice("There are no cards to jump to yet.");
      return;
    }
    new CardPickerModal(this, items, (item) => void this.showCard(item.file, item.cardId)).open();
  }

  /** Opens a story's board (or uses the one already open) and shows a card on it. */
  async showCard(file: TFile, cardId: string): Promise<void> {
    let view = this.boards().find((v) => v.file === file);
    if (view) {
      this.app.workspace.setActiveLeaf(view.leaf, { focus: true });
    } else {
      const leaf = this.app.workspace.getLeaf(false);
      await this.openAsBoard(leaf, file);
      view = leaf.view instanceof StoryBoardView ? leaf.view : undefined;
    }
    view?.revealCard(cardId);
  }

  /** Asks how to export a story, then writes the export to a new file. */
  promptExport(file: TFile, story: Story): void {
    const folder = file.parent && file.parent.path !== "/" ? `${file.parent.path}/` : "";
    new ExportModal(this.app, `${folder}${file.basename} export`, (choice) => void this.writeExport(story, choice)).open();
  }

  private async writeExport(story: Story, choice: ExportChoice): Promise<void> {
    try {
      const ext = EXPORT_EXTENSIONS[choice.format];
      const wanted = normalizePath(choice.path.endsWith(`.${ext}`) ? choice.path : `${choice.path}.${ext}`);
      const slash = wanted.lastIndexOf("/");
      const dir = slash > 0 ? wanted.slice(0, slash) : "";
      if (dir && !this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir);
      const stem = wanted.slice(0, -(ext.length + 1));
      let path = wanted;
      for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = `${stem} ${n}.${ext}`;
      const file = await this.app.vault.create(path, exportStory(story, choice.format, choice.order));
      new Notice(`Exported the story to ${path}.`);
      if (choice.format === "markdown") await this.app.workspace.getLeaf("tab").openFile(file);
    } catch (e) {
      console.error("Story Planner: could not export the story", e);
      new Notice("Story Planner could not write the export. See the developer console for details.");
    }
  }

  /** True when a linked note exists in the vault. */
  noteExists(path: string): boolean {
    return this.app.vault.getAbstractFileByPath(path) instanceof TFile;
  }

  /** Lets the writer pick a note to link; story notes are left out. */
  pickNote(placeholder: string, onPick: (path: string) => void): void {
    new NotePickerModal(this, placeholder, (file) => onPick(file.path)).open();
  }

  /** Opens a linked note in a pane beside the board, reusing that pane while it is open. */
  async openNote(path: string, newTab = false): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(`"${path}" is not in the vault any more. It may have been deleted or moved outside Obsidian.`);
      return;
    }
    let leaf: WorkspaceLeaf;
    if (newTab) {
      leaf = this.app.workspace.getLeaf("tab");
    } else {
      const reusable = this.noteLeaf && this.app.workspace.getLeavesOfType("markdown").includes(this.noteLeaf);
      leaf = reusable ? this.noteLeaf! : this.app.workspace.getLeaf("split", "vertical");
      this.noteLeaf = leaf;
    }
    await leaf.openFile(file, { active: true });
  }

  /**
   * Makes a new note from a card, filled once from the template, and returns
   * its path. The note gets no back-reference; the story links to it.
   */
  async createCardNote(storyFile: TFile, story: Story, card: Card): Promise<string> {
    const folder = this.settings.cardNoteFolder || storyFile.parent?.path || "";
    const dir = normalizePath(folder || "/");
    if (folder && !this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir);
    const base = noteFileName(card.title);
    const prefix = folder && dir !== "/" ? dir + "/" : "";
    let path = normalizePath(`${prefix}${base}.md`);
    for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${prefix}${base} ${n}.md`);

    let template = DEFAULT_NOTE_TEMPLATE;
    if (this.settings.cardNoteTemplate) {
      const file = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.cardNoteTemplate));
      if (file instanceof TFile) template = await this.app.vault.read(file);
      else new Notice(`The template note "${this.settings.cardNoteTemplate}" was not found, so the built-in template was used.`);
    }
    await this.app.vault.create(path, fillTemplate(template, noteValues(story, card)));
    return path;
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, { viewState: {} }, await this.loadData());
    setDefaultFormats({ date: this.settings.dateFormat, time: this.settings.timeFormat });
    this.settings.palette = cleanPalette(this.settings.palette);
    setPalette(this.settings.palette);
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

  promptNewStory(folder: string): void {
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

interface CardChoice {
  file: TFile;
  cardId: string;
  text: string;
}

class CardPickerModal extends FuzzySuggestModal<CardChoice> {
  constructor(
    plugin: StoryPlannerPlugin,
    private items: CardChoice[],
    private onPick: (item: CardChoice) => void,
  ) {
    super(plugin.app);
    this.setPlaceholder("Jump to card…");
  }

  getItems(): CardChoice[] {
    return this.items;
  }

  getItemText(item: CardChoice): string {
    return item.text;
  }

  onChooseItem(item: CardChoice): void {
    this.onPick(item);
  }
}

class NotePickerModal extends FuzzySuggestModal<TFile> {
  constructor(
    private plugin: StoryPlannerPlugin,
    placeholder: string,
    private onPick: (file: TFile) => void,
  ) {
    super(plugin.app);
    this.setPlaceholder(placeholder);
  }

  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles().filter((f) => !this.plugin.isStoryFile(f));
  }

  getItemText(file: TFile): string {
    return file.path.replace(/\.md$/, "");
  }

  onChooseItem(file: TFile): void {
    this.onPick(file);
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
