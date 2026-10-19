import { Notice, Scope, setIcon, TextFileView, WorkspaceLeaf } from "obsidian";
import type StoryPlannerPlugin from "../main";
import type { StoryTab } from "../settings";
import { addCardAt, addCharacterByName, setCardDate } from "../model/edits";
import { History } from "../model/history";
import { CardTarget, chapterCards, moveCard, moveInList } from "../model/moves";
import { SnapshotInfo } from "../model/snapshots";
import { compareDates, dateInZone, effectiveZone, formatDateRange, formatStoryDate, precisionOf } from "../model/calendar";
import { Clash, findClashes, reorderInTime, referenceDate } from "../model/storyTime";
import { Card, CharacterRole, Id, Story } from "../model/types";
import { outlineWasEdited, parseStory, serializeStory } from "../format/storyFile";
import { addChapter, addPlotLine, locationAndInside, locationPath, locationTree } from "../model/setup";
import { addCardNote, linkedPaths, renameLinkedPath } from "../model/links";
import { cardMatches, queryTerms, searchCards } from "../model/search";
import { CardPanel, NoteHost } from "./CardPanel";
import { Minimap } from "./Minimap";
import { SetupPanel } from "./SetupPanel";
import { BoardItem, computeBoardLayout, Orientation } from "./layout";
import { ChoiceModal, DateModal, LaneModal, TextPromptModal } from "./modals";
import { Bucket, bucketDate, computeTimeLayout, TimeItem, Zoom, ZOOM_LABELS } from "./timeLayout";
import { computeMatrix, computeTrackLayout, TrackAxis, TrackItem } from "./trackLayout";

export const STORY_BOARD_VIEW = "story-planner-board";

/** What is being dragged. */
type Dragged = { kind: "card" | "plotLine" | "chapter" | "character"; id: string };

/** Where a drop lands relative to its target. */
type DropPlace = "before" | "after" | "on";

interface DropTargetSpec {
  accepts: Dragged["kind"];
  axis: "slot" | "lane" | null;
  /** With an axis, the middle half of the target means "on" rather than before or after. */
  middle: boolean;
  onDrop: (place: DropPlace) => void;
}

/** The view tabs: id, label and Lucide icon name. */
const TABS: [StoryTab, string, string][] = [
  ["board", "Board", "layout-dashboard"],
  ["time", "Story time", "calendar-clock"],
  ["characters", "Characters", "users"],
  ["setup", "Setup", "settings-2"],
];

/** Board elements that count as empty space: clicking them clears the selection. */
const EMPTY_SPACE =
  ".story-planner-grid, .story-planner-corner, .story-planner-cell, .story-planner-chapter-end, .story-planner-tray, .story-planner-time-empty, .story-planner-matrix-wrap, .story-planner-track-note";

const ROLE_LABELS: Record<CharacterRole, string> = { pov: "Point of view", present: "Present", mentioned: "Mentioned" };
/** Marks for the presence matrix and appearances: filled for point of view, solid for present, hollow for mentioned. */
const ROLE_MARKS: Record<CharacterRole, string> = { pov: "\u25C9", present: "\u25CF", mentioned: "\u25CB" };

/** Pixels the pointer must move before a press becomes a drag. */
const DRAG_THRESHOLD = 5;

/**
 * Shows a story note as a board. The note stays the source of truth: Obsidian
 * hands us its text in setViewData and asks for it back in getViewData, and
 * requestSave() writes it (debounced) whenever the board changes.
 */
export class StoryBoardView extends TextFileView {
  private story: Story | null = null;
  private frontmatter: string[] = [];
  /** Set when the note could not be read; the board is then read-only and the note is never rewritten. */
  private loadError: string | null = null;
  private warnings: string[] = [];
  private outlineEdited = false;
  private history = new History();
  /** The text we last produced, to tell our own saves apart from outside changes such as a sync. */
  private lastWritten: string | null = null;
  private dragged: Dragged | null = null;
  private dropTargets = new Map<HTMLElement, DropTargetSpec>();
  private suppressClick = false;
  /** Key of the last coalescing edit, so a run of typing is one undo step. */
  private lastCoalesce: string | null = null;
  /** The view's parts: banners and toolbar, then the board beside the card panel. */
  private headerEl: HTMLElement;
  private bodyEl: HTMLElement;
  private boardEl: HTMLElement;
  private panel: CardPanel;
  private minimap: Minimap;
  private setup: SetupPanel;
  /** The spans of the story-time view as last drawn, by id, for drops. */
  private buckets = new Map<string, Bucket>();
  /** Board search: cards that do not match are dimmed. Not saved; it lasts while the board is open. */
  private query = "";
  private searchTerms: string[] = [];
  /** Which match Enter last went to. */
  private matchIndex = -1;
  private searchCount: HTMLElement | null = null;
  /** A card to show once the story has loaded, for "Jump to card" on a board that is still opening. */
  private pendingReveal: Id | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: StoryPlannerPlugin) {
    super(leaf);
    this.scope = new Scope(this.app.scope);
    this.scope.register(["Mod"], "z", () => {
      this.undo();
      return false;
    });
    this.scope.register(["Mod", "Shift"], "z", () => {
      this.redo();
      return false;
    });
    this.scope.register(["Mod"], "y", () => {
      this.redo();
      return false;
    });
    this.scope.register(["Mod"], "f", () => {
      const input = this.headerEl.querySelector<HTMLInputElement>("input.story-planner-search");
      if (!input) return true;
      input.focus();
      input.select();
      return false;
    });
    this.scope.register([], "Escape", () => {
      if (!this.panel.selected) return true;
      this.select(null);
      return false;
    });

    this.contentEl.addClass("story-planner");
    this.headerEl = this.contentEl.createDiv({ cls: "story-planner-header" });
    this.bodyEl = this.contentEl.createDiv({ cls: "story-planner-body" });
    this.boardEl = this.bodyEl.createDiv({ cls: "story-planner-board" });
    // A single click on empty board space closes the side panel. (A double
    // click on an empty cell then goes on to create a card there.)
    this.boardEl.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target === this.boardEl || target.matches(EMPTY_SPACE)) this.select(null);
    });
    this.minimap = new Minimap(this.bodyEl, this.boardEl);
    this.panel = new CardPanel(this.bodyEl, {
      edit: (change, coalesce) => this.mutate(change, coalesce),
      close: () => this.select(null),
      deleted: (title) => {
        this.select(null);
        new Notice(`Deleted "${title}". Press Ctrl+Z to undo.`);
      },
      notes: this.noteHost(),
    });
    this.setup = new SetupPanel(this.contentEl, {
      edit: (change, coalesce) => this.mutate(change, coalesce),
      choose: (choice) => new ChoiceModal(this.app, choice).open(),
      notice: (message) => new Notice(message),
      snapshot: (reason) => this.takeSnapshot(reason),
      listSnapshots: () => this.listSnapshots(),
      restore: (snapshot) => void this.restoreSnapshot(snapshot),
      notes: this.noteHost(),
    });
    this.contentEl.addEventListener(
      "click",
      (e) => {
        if (this.suppressClick) e.stopPropagation();
      },
      true,
    );
  }

  getViewType(): string {
    return STORY_BOARD_VIEW;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "Story board";
  }

  getIcon(): string {
    return "layout-dashboard";
  }

  async onOpen(): Promise<void> {
    this.addAction("file-text", "Open as Markdown", () => {
      if (this.file) void this.plugin.openAsMarkdown(this.leaf, this.file);
    });
    this.addAction("arrow-left-right", "Transpose board", () => this.toggleOrientation());
    this.addAction("file-output", "Export story", () => {
      if (this.file && this.currentStory) this.plugin.promptExport(this.file, this.currentStory);
    });
  }

  getViewData(): string {
    // Never rewrite a note we could not read.
    if (this.loadError || !this.story) return this.data;
    this.lastWritten = serializeStory(this.story, this.frontmatter);
    return this.lastWritten;
  }

  setViewData(data: string, clear: boolean): void {
    // A change that did not come from this board (another file, a sync)
    // makes the undo history meaningless.
    if (clear || data !== this.lastWritten) this.history.clear();
    this.data = data;
    const result = parseStory(data);
    if (result.ok) {
      this.story = result.story;
      this.frontmatter = result.frontmatter;
      this.loadError = null;
      this.warnings = result.warnings;
      this.outlineEdited = outlineWasEdited(result);
    } else {
      this.story = null;
      this.loadError = result.error;
      this.warnings = [];
      this.outlineEdited = false;
    }
    if (clear) {
      this.boardEl.scrollTop = 0;
      this.boardEl.scrollLeft = 0;
    }
    this.lastCoalesce = null;
    this.render();
    if (this.pendingReveal) {
      const id = this.pendingReveal;
      this.pendingReveal = null;
      this.revealCard(id);
    }
  }

  async onClose(): Promise<void> {
    this.cancelDrag();
    this.minimap.destroy();
  }

  clear(): void {
    this.cancelDrag();
    this.story = null;
    this.loadError = null;
    this.history.clear();
    this.headerEl.empty();
    this.boardEl.empty();
    this.panel.show({ cards: {} } as Story, null);
    this.setup.setOpen(false, null);
  }

  // -------------------------------------------------------------------------
  // Editing, undo and redo

  /**
   * Applies a change with undo support. The change returns false when it
   * turned out to change nothing. Changes with the same `coalesce` key in a
   * row (typing in one field) share one undo step and leave the panel's
   * fields alone.
   */
  private mutate(change: (story: Story) => boolean | void, coalesce?: string): void {
    if (!this.story) return;
    const before = JSON.stringify(this.story);
    const draft = JSON.parse(before) as Story;
    if (change(draft) === false || JSON.stringify(draft) === before) return;
    if (!coalesce || coalesce !== this.lastCoalesce) this.history.record(this.story);
    this.lastCoalesce = coalesce ?? null;
    this.story = draft;
    this.changed(coalesce !== undefined);
  }

  undo(): void {
    if (!this.story) return;
    const previous = this.history.undo(this.story);
    if (!previous) return;
    this.story = previous;
    this.lastCoalesce = null;
    this.changed();
  }

  redo(): void {
    if (!this.story) return;
    const next = this.history.redo(this.story);
    if (!next) return;
    this.story = next;
    this.lastCoalesce = null;
    this.changed();
  }

  private changed(typing = false): void {
    this.outlineEdited = false;
    this.requestSave();
    this.render(typing);
  }

  /** Creates a card at a board position, selects it and puts the cursor in its title. */
  private addCard(target: CardTarget): void {
    let id: Id | null = null;
    this.mutate((story) => {
      id = addCardAt(story, target);
    });
    if (id) {
      this.select(id);
      this.panel.focusTitle();
    }
  }

  /** Selects a card and shows it in the side panel; null closes the panel. */
  private select(cardId: Id | null): void {
    if (!this.story) return;
    this.panel.show(this.story, cardId);
    for (const el of Array.from(this.boardEl.querySelectorAll<HTMLElement>("[data-card-id]"))) {
      el.classList.toggle("is-selected", el.dataset.cardId === this.panel.selected);
    }
    this.minimap.refresh();
  }

  // -------------------------------------------------------------------------
  // Search and jumping to cards

  private searchBox(parent: HTMLElement, story: Story): HTMLInputElement {
    const box = parent.createDiv({ cls: "story-planner-search-box" });
    const input = box.createEl("input", { cls: "story-planner-search" });
    input.type = "search";
    input.placeholder = "Search cards";
    input.value = this.query;
    input.setAttr("aria-label", "Search cards. Enter goes to the next match, Shift+Enter to the previous one.");
    this.searchCount = box.createSpan({ cls: "story-planner-search-count" });
    this.updateSearchCount(story);
    input.addEventListener("input", () => {
      this.query = input.value;
      this.searchTerms = queryTerms(this.query);
      this.matchIndex = -1;
      if (this.story) {
        this.updateSearchCount(this.story);
        this.renderBoard(this.story);
      }
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.stepMatch(e.shiftKey ? -1 : 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (input.value) {
          input.value = "";
          input.dispatchEvent(new Event("input"));
        } else {
          input.blur();
        }
      }
    });
    return input;
  }

  private updateSearchCount(story: Story): void {
    if (!this.searchCount) return;
    if (this.searchTerms.length === 0) {
      this.searchCount.setText("");
      return;
    }
    const total = searchCards(story, this.query).length;
    this.searchCount.setText(
      total === 0 ? "No cards" : this.matchIndex >= 0 ? `${this.matchIndex + 1} of ${total}` : `${total} ${total === 1 ? "card" : "cards"}`,
    );
  }

  /** Selects the next (or previous) matching card and scrolls to it. */
  private stepMatch(by: 1 | -1): void {
    if (!this.story) return;
    const matches = searchCards(this.story, this.query);
    if (matches.length === 0) return;
    this.matchIndex = (this.matchIndex + by + matches.length) % matches.length;
    this.revealCard(matches[this.matchIndex]!.id);
    this.updateSearchCount(this.story);
  }

  /** The story as the board has it, with edits not yet saved; null when the note could not be read. */
  get currentStory(): Story | null {
    return this.loadError ? null : this.story;
  }

  /** Shows a card: switches away from the setup page if needed, selects it and scrolls to it. */
  revealCard(cardId: Id): void {
    if (!this.story) {
      this.pendingReveal = cardId;
      return;
    }
    if (!this.story.cards[cardId]) return;
    if (this.tab === "setup") this.showTab("board");
    let el = this.boardEl.querySelector<HTMLElement>(`.story-planner-card[data-card-id="${CSS.escape(cardId)}"]`);
    // Not every view shows every card (undated cards, characters not tracked); fall back to the board.
    if (!el && this.tab !== "board") {
      this.showTab("board");
      el = this.boardEl.querySelector<HTMLElement>(`.story-planner-card[data-card-id="${CSS.escape(cardId)}"]`);
    }
    this.select(cardId);
    el?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  }

  // -------------------------------------------------------------------------
  // Linked notes

  /** What the panels need to show, open, link and create notes. */
  private noteHost(): NoteHost {
    return {
      exists: (path) => this.plugin.noteExists(path),
      open: (path, newTab) => void this.plugin.openNote(path, newTab),
      pick: (placeholder, onPick) => this.plugin.pickNote(placeholder, onPick),
      createFromCard: (cardId) => void this.createCardNote(cardId),
    };
  }

  private async createCardNote(cardId: Id): Promise<void> {
    const card = this.story?.cards[cardId];
    if (!this.story || !card || !this.file) return;
    try {
      const path = await this.plugin.createCardNote(this.file, this.story, card);
      this.mutate((s) => addCardNote(s, cardId, path));
      await this.plugin.openNote(path);
    } catch (e) {
      console.error("Story Planner: could not create a note", e);
      new Notice("Story Planner could not create the note. See the developer console for details.");
    }
  }

  /**
   * A linked note (or a folder of them) was renamed or moved. That is a fact
   * about the vault, not an edit, so it is applied to the undo history too and
   * saved at once, before anything else rewrites the note.
   */
  async followRename(oldPath: string, newPath: string): Promise<void> {
    if (!this.story || this.loadError) return;
    if (!renameLinkedPath(this.story, oldPath, newPath)) return;
    this.history.rewrite((s) => renameLinkedPath(s, oldPath, newPath));
    this.outlineEdited = false;
    this.render();
    await this.save();
  }

  /** A note was created or deleted somewhere; redraw if this story links to it. */
  linksChanged(path: string): void {
    if (this.story && linkedPaths(this.story).has(path)) this.render();
  }

  // -------------------------------------------------------------------------
  // Safety snapshots

  /** Keeps a copy of the story as it is now, before a large destructive edit. */
  private takeSnapshot(reason: string, text?: string): void {
    if (!this.plugin.settings.snapshotsEnabled || !this.file) return;
    const body = text ?? (this.story && !this.loadError ? serializeStory(this.story, this.frontmatter) : null);
    if (body === null) return;
    this.plugin.snapshots
      .take(this.file.path, body, reason)
      .then(() => this.setup.refresh(this.story))
      .catch((e) => {
        console.error("Story Planner: could not save a snapshot", e);
        new Notice("Story Planner could not save a safety snapshot. See the developer console for details.");
      });
  }

  private async listSnapshots(): Promise<SnapshotInfo[]> {
    return this.file ? this.plugin.snapshots.list(this.file.path) : [];
  }

  /**
   * Puts the story back as it was in a snapshot. On a story that opened
   * normally this is one undoable edit, and the current state is snapshotted
   * first. On a story that could not be read, the unreadable text is kept as a
   * snapshot before the note is replaced.
   */
  async restoreSnapshot(info: SnapshotInfo): Promise<void> {
    const snapshot = await this.plugin.snapshots.read(info);
    const parsed = snapshot ? parseStory(snapshot.text) : null;
    if (!snapshot || !parsed?.ok) {
      new Notice("That snapshot could not be read.");
      return;
    }
    const when = new Date(snapshot.takenAt).toLocaleString();
    if (this.story && !this.loadError) {
      this.takeSnapshot(`Before restoring the snapshot from ${when}`);
      this.mutate((story) => {
        for (const key of Object.keys(story)) delete (story as unknown as Record<string, unknown>)[key];
        Object.assign(story, parsed.story);
      });
      new Notice(`Restored the story as it was on ${when}. Press Ctrl+Z to undo.`);
    } else {
      this.takeSnapshot("The note as it was before restoring (it could not be read)", this.data);
      this.setViewData(snapshot.text, false);
      this.requestSave();
      new Notice(`Restored the story as it was on ${when}.`);
    }
  }

  /** The view tab this story shows: the board, or the story setup page. */
  private get tab(): StoryTab {
    const path = this.file?.path;
    return (path ? this.plugin.settings.viewState[path]?.tab : undefined) ?? "board";
  }

  private showTab(tab: StoryTab): void {
    const path = this.file?.path;
    if (!path || tab === this.tab) return;
    this.plugin.settings.viewState[path] = { ...this.plugin.settings.viewState[path], tab };
    void this.plugin.saveSettings();
    this.select(null);
    this.render();
  }

  /** Replaces a card's title with a text box, for renaming it in place. */
  private editTitleInPlace(cardEl: HTMLElement, card: Card): void {
    const titleEl = cardEl.querySelector<HTMLElement>(".story-planner-card-title");
    if (!titleEl) return;
    const input = document.createElement("input");
    input.className = "story-planner-card-title-input";
    input.type = "text";
    input.value = card.title;
    titleEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      const title = input.value.trim();
      if (save && title && title !== card.title) {
        this.mutate((s) => {
          const c = s.cards[card.id];
          if (!c) return false;
          c.title = title;
          c.modified = new Date().toISOString();
        });
      } else {
        input.replaceWith(titleEl);
      }
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      else if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
    // Clicks in the box must not start a drag or reselect the card.
    input.addEventListener("pointerdown", (e) => e.stopPropagation());
    input.addEventListener("click", (e) => e.stopPropagation());
  }

  // -------------------------------------------------------------------------
  // Rendering

  /** The layout of the current view: the board and story time each remember their own. */
  private get orientation(): Orientation {
    const state = this.file ? this.plugin.settings.viewState[this.file.path] : undefined;
    if (this.tab === "time") return state?.timeOrientation ?? this.plugin.settings.defaultStoryTimeOrientation;
    if (this.tab === "characters") return state?.characterOrientation ?? this.plugin.settings.defaultOrientation;
    return state?.orientation ?? this.plugin.settings.defaultOrientation;
  }

  private get zoom(): Zoom {
    const path = this.file?.path;
    return (path ? this.plugin.settings.viewState[path]?.zoom : undefined) ?? "day";
  }

  /** The zone story-time cards show their times in; "" is each card's own local time. */
  private get zoneView(): string {
    const path = this.file?.path;
    const zone = path ? this.plugin.settings.viewState[path]?.timeZoneView : undefined;
    return zone && this.story?.zones.some((z) => z.id === zone) ? zone : "";
  }

  private setViewState(change: Partial<NonNullable<StoryPlannerPlugin["settings"]["viewState"][string]>>): void {
    const path = this.file?.path;
    if (!path) return;
    this.plugin.settings.viewState[path] = { ...this.plugin.settings.viewState[path], ...change };
    void this.plugin.saveSettings();
    this.render();
  }

  private get compact(): boolean {
    const path = this.file?.path;
    return (path ? this.plugin.settings.viewState[path]?.compact : undefined) ?? false;
  }

  private toggleCompact(): void {
    const path = this.file?.path;
    if (!path) return;
    this.plugin.settings.viewState[path] = { ...this.plugin.settings.viewState[path], compact: !this.compact };
    void this.plugin.saveSettings();
    this.render();
  }

  private toggleOrientation(): void {
    const path = this.file?.path;
    if (!path) return;
    const next: Orientation = this.orientation === "vertical" ? "horizontal" : "vertical";
    const key = this.tab === "time" ? "timeOrientation" : this.tab === "characters" ? "characterOrientation" : "orientation";
    this.plugin.settings.viewState[path] = { ...this.plugin.settings.viewState[path], [key]: next };
    void this.plugin.saveSettings();
    this.render();
  }

  /** Redraws the toolbar and board. `typing` means the change came from typing in the panel. */
  private render(typing = false): void {
    const root = this.headerEl;
    this.dropTargets.clear();
    // The search box is redrawn with the toolbar; keep the cursor in it.
    const active = document.activeElement;
    const searching = active instanceof HTMLInputElement && active.matches("input.story-planner-search") && root.contains(active);
    const caret = searching ? [active.selectionStart, active.selectionEnd] : null;
    root.empty();

    if (this.loadError || !this.story) {
      this.boardEl.empty();
      this.panel.show({ cards: {} } as Story, null);
      this.setup.setOpen(false, null);
      const box = root.createDiv({ cls: "story-planner-error" });
      box.createEl("h3", { text: "This story could not be opened" });
      box.createEl("p", { text: this.loadError ?? "Unknown error." });
      box.createEl("p", {
        text: "The note has not been changed. You can open it as Markdown, or restore an earlier version with File recovery.",
      });
      void this.listSnapshots().then((snapshots) => {
        if (snapshots.length === 0 || !box.isConnected) return;
        box.createEl("p", { text: `This story also has ${snapshots.length} safety ${snapshots.length === 1 ? "snapshot" : "snapshots"}.` });
        box.createEl("button", { text: "Restore from a snapshot…", cls: "mod-cta" }).addEventListener("click", () => {
          void this.plugin.pickSnapshot(this);
        });
      });
      return;
    }

    const story = this.story;
    for (const warning of this.warnings) {
      root.createDiv({ cls: "story-planner-banner", text: warning });
    }
    if (this.outlineEdited) {
      root.createDiv({
        cls: "story-planner-banner",
        text: "The outline in this note was edited as text. It will be regenerated from the board the next time the story changes.",
      });
    }

    const toolbar = root.createDiv({ cls: "story-planner-toolbar" });
    toolbar.createEl("h2", { text: story.title, cls: "story-planner-title" });
    this.button(toolbar, "Undo", () => this.undo(), !this.history.canUndo);
    this.button(toolbar, "Redo", () => this.redo(), !this.history.canRedo);
    if (this.tab !== "setup") {
      const input = this.searchBox(toolbar, story);
      if (caret) {
        input.focus({ preventScroll: true });
        input.setSelectionRange(caret[0] ?? null, caret[1] ?? null);
      }
    }

    // View tabs, like the views of a Notion database. More views (story
    // time, characters) join this row later.
    const tabsRow = root.createDiv({ cls: "story-planner-tabs-row" });
    const tabs = tabsRow.createDiv({ cls: "story-planner-tabs" });
    tabs.setAttr("role", "tablist");
    const tab = this.tab;
    for (const [id, label, icon] of TABS) {
      const el = tabs.createEl("button", { cls: "story-planner-tab" });
      el.setAttr("role", "tab");
      el.setAttr("aria-selected", String(id === tab));
      el.toggleClass("is-active", id === tab);
      setIcon(el.createSpan({ cls: "story-planner-tab-icon" }), icon);
      el.createSpan({ text: label });
      el.addEventListener("click", () => this.showTab(id));
    }

    const onBoard = tab === "board";
    const onTime = tab === "time";
    const onCharacters = tab === "characters";
    const withPanel = onBoard || onTime || onCharacters;
    this.bodyEl.hidden = !withPanel;
    this.setup.setOpen(tab === "setup", story);
    if (onTime) this.timeActions(tabsRow.createDiv({ cls: "story-planner-tab-actions" }), story);
    if (onCharacters) this.characterActions(tabsRow.createDiv({ cls: "story-planner-tab-actions" }), story);
    if (onBoard) {
      const actions = tabsRow.createDiv({ cls: "story-planner-tab-actions" });
      this.button(actions, "Add plot line", () =>
        new TextPromptModal(this.app, "New plot line", "", (name) => this.mutate((s) => void addPlotLine(s, name))).open(),
      );
      this.button(actions, "Add chapter", () =>
        new TextPromptModal(this.app, "New chapter", `Chapter ${story.chapters.length + 1}`, (name) =>
          this.mutate((s) => void addChapter(s, name)),
        ).open(),
      );
      this.highlightPicker(actions, story);
      const compact = this.button(actions, "Compact", () => this.toggleCompact());
      compact.toggleClass("is-active", this.compact);
      compact.setAttr("aria-pressed", String(this.compact));
      compact.setAttr("title", "Stack each plot line's cards from the top of the chapter");
    }

    if (withPanel) {
      const actions = tabsRow.querySelector<HTMLElement>(".story-planner-tab-actions") ?? tabsRow.createDiv({ cls: "story-planner-tab-actions" });
      const map = this.button(actions, "Map", () => this.setViewState({ minimap: !this.viewState()?.minimap }));
      const on = !!this.viewState()?.minimap;
      map.toggleClass("is-active", on);
      map.setAttr("aria-pressed", String(on));
      map.setAttr("title", "Show an overview of the whole board in the corner");
    }

    // Keep the panel on the selected card; it closes if the card is gone (after an undo, say).
    this.panel.show(story, withPanel ? this.panel.selected : null, typing);
    this.setup.refresh(story, typing);
    if (withPanel) this.renderBoard(story);
    this.minimap.setVisible(withPanel && !!this.viewState()?.minimap);
  }

  /**
   * Draws the board off-screen and swaps it in, so it is never empty for a
   * moment, and keeps the scroll position: an edit must not move the view.
   */
  private renderBoard(story: Story): void {
    const { scrollTop, scrollLeft } = this.boardEl;
    const content = document.createElement("div");
    if (this.tab === "time") this.fillTime(content, story);
    else if (this.tab === "characters") this.fillCharacters(content, story);
    else this.fillBoard(content, story);
    this.boardEl.replaceChildren(...Array.from(content.childNodes));
    this.boardEl.scrollTop = scrollTop;
    this.boardEl.scrollLeft = scrollLeft;
    this.minimap.refresh();
  }

  private fillBoard(parent: HTMLElement, story: Story): void {
    if (story.plotLines.length === 0) {
      parent.createDiv({ cls: "story-planner-empty", text: "Add a plot line to start planning." });
      return;
    }

    const layout = computeBoardLayout(story, this.orientation, this.compact);
    const grid = parent.createDiv({ cls: `story-planner-grid is-${this.orientation}` });
    grid.style.gridTemplateRows = `repeat(${layout.rows}, auto)`;
    grid.style.gridTemplateColumns =
      this.orientation === "vertical"
        ? `var(--story-planner-header-size) repeat(${layout.columns - 1}, minmax(var(--story-planner-card-width), 1fr))`
        : `var(--story-planner-header-size) repeat(${layout.columns - 1}, var(--story-planner-card-width))`;
    if (this.orientation === "vertical") {
      const lanes = layout.columns - 1;
      grid.style.minWidth = `calc(var(--story-planner-header-size) + ${lanes} * (var(--story-planner-card-width) + var(--size-4-2)))`;
    }

    for (const placed of layout.items) {
      const el = this.renderItem(grid, placed.item, story);
      el.style.gridRow = String(placed.row);
      el.style.gridColumn = String(placed.column);
    }
  }

  private renderItem(grid: HTMLElement, item: BoardItem, story: Story): HTMLElement {
    switch (item.kind) {
      case "corner":
        return grid.createDiv({ cls: "story-planner-corner" });

      case "lane-header": {
        const plotLine = story.plotLines.find((p) => p.id === item.plotLineId);
        const el = grid.createDiv({ cls: "story-planner-lane-header", text: plotLine?.name ?? "" });
        el.style.setProperty("--lane-color", plotLine?.color ?? "var(--interactive-accent)");
        el.addEventListener("dblclick", () => {
          if (!plotLine) return;
          new TextPromptModal(this.app, "Rename plot line", plotLine.name, (name) =>
            this.mutate((s) => {
              s.plotLines.find((p) => p.id === plotLine.id)!.name = name;
            }),
          ).open();
        });
        this.makeDraggable(el, { kind: "plotLine", id: item.plotLineId });
        this.makeDropTarget(el, "plotLine", "lane", (place) =>
          this.mutate((s) =>
            moveInList(s.plotLines, this.dragged!.id, neighbour(s.plotLines, item.plotLineId, place === "after")),
          ),
        );
        return el;
      }

      case "chapter-header": {
        const chapter = story.chapters.find((c) => c.id === item.chapterId);
        const el = grid.createDiv({
          cls: "story-planner-chapter-header",
          text: chapter?.name ?? "Off-page",
        });
        if (chapter) {
          el.addEventListener("dblclick", () => {
            new TextPromptModal(this.app, "Rename chapter", chapter.name, (name) =>
              this.mutate((s) => {
                s.chapters.find((c) => c.id === chapter.id)!.name = name;
              }),
            ).open();
          });
          this.makeDraggable(el, { kind: "chapter", id: chapter.id });
          this.makeDropTarget(el, "chapter", "slot", (place) =>
            this.mutate((s) => moveInList(s.chapters, this.dragged!.id, neighbour(s.chapters, chapter.id, place === "after"))),
          );
        } else {
          el.addClass("is-off-page");
        }
        return el;
      }

      case "add-card": {
        const el = grid.createDiv({ cls: "story-planner-add-card", text: "+" });
        el.setAttr("aria-label", "Add card");
        el.setAttr("title", "Add a card at the end of this chapter");
        el.addEventListener("click", () => this.addCard({ chapter: item.chapterId, plotLine: item.plotLineId }));
        // Dropping here puts the card first in the chapter.
        this.makeDropTarget(el, "card", null, () =>
          this.mutate((s) =>
            moveCard(s, this.dragged!.id, {
              chapter: item.chapterId,
              plotLine: item.plotLineId,
              beforeCardId: chapterCards(s, item.chapterId).find((c) => c.id !== this.dragged!.id)?.id ?? null,
            }),
          ),
        );
        return el;
      }

      case "empty": {
        // Empty space in a plot line, in the row of a scene in another plot
        // line: the middle puts the dropped card in that row, beside the scene;
        // the edges put it in a new row just before or after.
        const el = grid.createDiv({ cls: "story-planner-cell" });
        const card = story.cards[item.cardId]!;
        this.makeCardDropTarget(el, card, item.plotLineId, true);
        // Double-click creates a card here, in this row.
        el.addEventListener("dblclick", () =>
          this.addCard({ chapter: card.chapter, plotLine: item.plotLineId, besideCardId: card.id }),
        );
        return el;
      }

      case "chapter-end": {
        const el = grid.createDiv({ cls: "story-planner-chapter-end" });
        el.addEventListener("dblclick", () => this.addCard({ chapter: item.chapterId, plotLine: item.plotLineId }));
        this.makeDropTarget(el, "card", null, () =>
          this.mutate((s) => moveCard(s, this.dragged!.id, { chapter: item.chapterId, plotLine: item.plotLineId })),
        );
        return el;
      }

      case "card": {
        const card = story.cards[item.cardId]!;
        const plotLine = story.plotLines.find((p) => p.id === card.plotLine);
        const el = grid.createDiv({ cls: `story-planner-card status-${card.status}` });
        el.style.setProperty("--lane-color", plotLine?.color ?? "var(--interactive-accent)");
        el.createDiv({ cls: "story-planner-card-title", text: card.title });
        if (card.date) {
          el.createDiv({ cls: "story-planner-card-date", text: formatDateRange(story, card.date, card.endDate) });
        }
        if (card.synopsis) el.createDiv({ cls: "story-planner-card-synopsis", text: card.synopsis });
        this.cardExtras(el, card, story);
        el.dataset.cardId = card.id;
        if (card.id === this.panel.selected) el.addClass("is-selected");
        el.addEventListener("click", () => this.select(card.id));
        el.addEventListener("dblclick", () => this.editTitleInPlace(el, card));
        this.makeDraggable(el, { kind: "card", id: card.id });
        this.makeCardDropTarget(el, card, card.plotLine);
        return el;
      }

      case "echo": {
        const card = story.cards[item.cardId]!;
        const home = story.plotLines.find((p) => p.id === card.plotLine);
        const el = grid.createDiv({ cls: "story-planner-echo", text: card.title });
        el.style.setProperty("--lane-color", home?.color ?? "var(--interactive-accent)");
        el.setAttr("aria-label", `Also in ${home?.name ?? "another plot line"}`);
        if (this.highlighted(card, story) === false) el.addClass("is-dimmed");
        // Clicking an echo selects the real card and brings it into view.
        el.addEventListener("click", () => {
          this.select(card.id);
          this.boardEl
            .querySelector(`.story-planner-card[data-card-id="${CSS.escape(card.id)}"]`)
            ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
        });
        this.makeCardDropTarget(el, card, item.plotLineId);
        return el;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Highlight: one character, tag or place stands out and every other card dims.
  // A viewing aid only; it never changes the story.

  private get highlight(): string {
    const path = this.file?.path;
    return (path ? this.plugin.settings.viewState[path]?.highlight : undefined) ?? "";
  }

  private highlightPicker(parent: HTMLElement, story: Story): void {
    const select = parent.createEl("select", { cls: "dropdown story-planner-highlight" });
    select.setAttr("aria-label", "Highlight");
    select.createEl("option", { text: "No highlight" }).value = "";
    const group = (label: string, items: [string, string][]) => {
      if (items.length === 0) return;
      const el = select.createEl("optgroup");
      el.label = label;
      for (const [value, text] of items) el.createEl("option", { text }).value = value;
    };
    group("Characters", story.characters.map((c) => [`character:${c.id}`, c.name]));
    if (story.tagsEnabled) group("Story tags", story.tags.map((t) => [`tag:${t.id}`, t.name]));
    group("Places", locationTree(story).map(({ location, depth }) => [`location:${location.id}`, `${"\u2003".repeat(depth)}${location.name}`]));
    select.value = this.highlight;
    if (select.value !== this.highlight) select.value = "";
    select.toggleClass("is-active", select.value !== "");
    select.addEventListener("change", () => this.setViewState({ highlight: select.value }));
  }

  /** Whether a card matches the highlight; undefined when nothing is highlighted. */
  private highlighted(card: Card, story: Story): boolean | undefined {
    if (this.searchTerms.length > 0 && !cardMatches(story, card, this.searchTerms)) return false;
    const [kind, id] = this.highlight.split(":");
    if (!kind || !id) return undefined;
    if (kind === "character") return story.characters.some((c) => c.id === id) ? card.characters.some((c) => c.id === id) : undefined;
    if (kind === "tag") return story.tags.some((t) => t.id === id) ? card.tags.includes(id) : undefined;
    if (kind === "location") {
      if (!story.locations.some((l) => l.id === id)) return undefined;
      return !!card.location && locationAndInside(story, id).has(card.location);
    }
    return undefined;
  }

  /** What every card shows besides title, date and synopsis: its place, tags, and the highlight. */
  private cardExtras(el: HTMLElement, card: Card, story: Story, roleNote = true): void {
    if (card.location && story.locations.some((l) => l.id === card.location)) {
      el.createDiv({ cls: "story-planner-card-place", text: locationPath(story, card.location) });
    }
    if (story.tagsEnabled && card.tags.length > 0) {
      const chips = el.createDiv({ cls: "story-planner-card-tags" });
      for (const id of card.tags) {
        const tag = story.tags.find((t) => t.id === id);
        if (!tag) continue;
        const chip = chips.createSpan({ cls: "story-planner-tag-chip is-on", text: tag.name });
        chip.style.setProperty("--tag-color", tag.color);
      }
    }
    if (card.relationshipState) el.createDiv({ cls: "story-planner-card-state", text: card.relationshipState });
    if (card.notes.length > 0) {
      const missing = card.notes.filter((n) => !this.plugin.noteExists(n)).length;
      const notes = el.createDiv({ cls: "story-planner-card-links", text: `${card.notes.length} ${card.notes.length === 1 ? "note" : "notes"}` });
      if (missing > 0) {
        notes.addClass("is-broken");
        notes.setText(missing === card.notes.length && missing === 1 ? "Linked note missing" : `${card.notes.length} notes, ${missing} missing`);
      }
    }
    const match = this.highlighted(card, story);
    if (match === false) el.addClass("is-dimmed");
    if (match && roleNote && this.highlight.startsWith("character:")) {
      const entry = card.characters.find((c) => `character:${c.id}` === this.highlight)!;
      const role = ROLE_LABELS[entry.role];
      el.createDiv({ cls: "story-planner-card-note", text: entry.note ? `${role}: ${entry.note}` : role });
    }
  }

  // -------------------------------------------------------------------------
  // Story time: the cards in the order things happen, spans of time along one
  // axis and plot lines along the other, with undated cards in a tray.

  private timeActions(actions: HTMLElement, story: Story): void {
    this.highlightPicker(actions, story);
    const zoom = actions.createEl("select", { cls: "dropdown" });
    zoom.setAttr("aria-label", "Zoom");
    for (const [value, label] of Object.entries(ZOOM_LABELS)) zoom.createEl("option", { text: label }).value = value;
    zoom.value = this.zoom;
    zoom.addEventListener("change", () => this.setViewState({ zoom: zoom.value as Zoom }));
    if (story.zones.length > 0) {
      const zones = actions.createEl("select", { cls: "dropdown" });
      zones.setAttr("aria-label", "Show times in");
      zones.createEl("option", { text: "Local times" }).value = "";
      for (const zone of story.zones) zones.createEl("option", { text: `Times in ${zone.name}` }).value = zone.id;
      zones.value = this.zoneView;
      zones.addEventListener("change", () => this.setViewState({ timeZoneView: zones.value }));
    }
  }

  private fillTime(parent: HTMLElement, story: Story): void {
    if (story.plotLines.length === 0) {
      parent.createDiv({ cls: "story-planner-empty", text: "Add a plot line to start planning." });
      return;
    }
    const orientation = this.orientation;
    const layout = computeTimeLayout(story, this.zoom, orientation);
    this.buckets = new Map(layout.buckets.map((b) => [b.id, b]));

    if (layout.buckets.length === 0) {
      parent.createDiv({
        cls: "story-planner-empty story-planner-time-empty",
        text: "No card has a date yet. Open a card and fill in \"When\" to place it in story time.",
      });
    } else {
      const grid = this.spanGrid(parent, "is-time", layout.rows, layout.columns);
      for (const placed of layout.items) this.place(placed, this.renderTimeItem(grid, placed.item, story));
    }
    this.renderTray(parent, story, layout.undated);
  }

  /** A grid for story time or the character track, whose headers can span several slots. */
  private spanGrid(parent: HTMLElement, cls: string, rows: number, columns: number): HTMLElement {
    const orientation = this.orientation;
    const grid = parent.createDiv({ cls: `story-planner-grid ${cls} is-${orientation}` });
    grid.style.gridTemplateRows = `repeat(${rows}, auto)`;
    grid.style.gridTemplateColumns =
      orientation === "vertical"
        ? `var(--story-planner-header-size) repeat(${columns - 1}, minmax(var(--story-planner-card-width), 1fr))`
        : `var(--story-planner-header-size) repeat(${columns - 1}, var(--story-planner-card-width))`;
    if (orientation === "vertical") {
      grid.style.minWidth = `calc(var(--story-planner-header-size) + ${columns - 1} * (var(--story-planner-card-width) + var(--size-4-2)))`;
    }
    return grid;
  }

  /** Puts an item on a span grid: a header covers its slots, and a gap marker runs across every lane. */
  private place(placed: { item: { kind: string }; row: number; column: number; span: number }, el: HTMLElement): void {
    const vertical = this.orientation === "vertical";
    const along = placed.span > 1 ? ` / span ${placed.span}` : "";
    if (placed.item.kind === "gap") {
      el.style.gridRow = vertical ? String(placed.row) : "1 / -1";
      el.style.gridColumn = vertical ? "1 / -1" : String(placed.column);
    } else {
      el.style.gridRow = String(placed.row) + (vertical ? along : "");
      el.style.gridColumn = String(placed.column) + (vertical ? "" : along);
    }
  }

  private renderTimeItem(grid: HTMLElement, item: TimeItem, story: Story): HTMLElement {
    switch (item.kind) {
      case "corner":
      case "lane-header":
        return this.renderItem(grid, item, story);

      case "time-header":
        return grid.createDiv({ cls: "story-planner-time-header", text: item.bucket.label });

      case "gap":
        return grid.createDiv({ cls: "story-planner-time-gap", text: `— ${item.text} —` });

      case "time-cell": {
        const el = grid.createDiv({ cls: "story-planner-cell" });
        this.makeDropTarget(el, "card", null, () => this.dropInTime(item.bucketId, item.plotLineId, null, "on"));
        // Double-click creates an off-page event at this time; it can be given a chapter later.
        el.addEventListener("dblclick", () => {
          const bucket = this.buckets.get(item.bucketId);
          if (!bucket) return;
          let id: Id | null = null;
          this.mutate((s) => {
            id = addCardAt(s, { chapter: null, plotLine: item.plotLineId }, "New event");
            setCardDate(s, id, "date", { ...bucket.date });
          });
          if (id) {
            this.select(id);
            this.panel.focusTitle();
          }
        });
        return el;
      }

      case "card": {
        const card = story.cards[item.cardId]!;
        const el = this.timeCard(grid, card, story);
        el.addEventListener("dblclick", () => this.editTitleInPlace(el, card));
        this.makeDropTarget(el, "card", "slot", (place) => this.dropInTime(item.bucketId, card.plotLine, card, place));
        return el;
      }

      case "echo": {
        const card = story.cards[item.cardId]!;
        const home = story.plotLines.find((p) => p.id === card.plotLine);
        const el = grid.createDiv({ cls: "story-planner-echo", text: card.title });
        el.style.setProperty("--lane-color", home?.color ?? "var(--interactive-accent)");
        el.setAttr("aria-label", `Also in ${home?.name ?? "another plot line"}`);
        if (this.highlighted(card, story) === false) el.addClass("is-dimmed");
        el.addEventListener("click", () => this.select(card.id));
        this.makeDropTarget(el, "card", null, () => this.dropInTime(item.bucketId, item.plotLineId, null, "on"));
        return el;
      }
    }
  }

  /** A card as story time shows it: its time, and a badge with its chapter so reading order stays in view. */
  private timeCard(parent: HTMLElement, card: Card, story: Story): HTMLElement {
    const plotLine = story.plotLines.find((p) => p.id === card.plotLine);
    const chapter = story.chapters.find((c) => c.id === card.chapter);
    const el = parent.createDiv({ cls: `story-planner-card status-${card.status}` });
    if (!chapter) el.addClass("is-off-page");
    el.style.setProperty("--lane-color", plotLine?.color ?? "var(--interactive-accent)");
    el.createDiv({ cls: "story-planner-card-badge", text: chapter?.name ?? "Off-page" });
    el.createDiv({ cls: "story-planner-card-title", text: card.title });
    if (card.date) {
      const when = el.createDiv({ cls: "story-planner-card-date", text: this.timeLabel(card, story) });
      const local = formatDateRange(story, card.date, card.endDate);
      if (when.textContent !== local) when.setAttr("title", `Local: ${local}`);
      if (this.shiftedDay(card, story)) when.addClass("is-shifted");
    }
    this.cardExtras(el, card, story);
    el.dataset.cardId = card.id;
    if (card.id === this.panel.selected) el.addClass("is-selected");
    el.addEventListener("click", () => this.select(card.id));
    this.makeDraggable(el, { kind: "card", id: card.id });
    return el;
  }

  /** A card's time, in its own zone or converted into the zone chosen in the toolbar. */
  private timeLabel(card: Card, story: Story): string {
    const converted = this.convertedDate(card, story);
    return converted ? formatStoryDate(story, converted) : formatDateRange(story, card.date!, card.endDate);
  }

  private convertedDate(card: Card, story: Story) {
    const target = this.zoneView;
    if (!target || !card.date) return undefined;
    const precision = precisionOf(card.date);
    if (precision !== "time" && precision !== "dayPart") return undefined;
    const from = effectiveZone(story, card).zone?.id;
    if (from === target) return undefined;
    return dateInZone(story, card.date, from, target);
  }

  /** True when the converted time falls on another day than the card's local date. */
  private shiftedDay(card: Card, story: Story): boolean {
    const converted = this.convertedDate(card, story);
    const local = card.date!;
    return !!converted && (converted.year !== local.year || converted.month !== local.month || converted.day !== local.day);
  }

  /** Cards without a date, so nothing disappears in story time. Dropping a dated card here takes its date off. */
  private renderTray(parent: HTMLElement, story: Story, undated: Id[]): void {
    const tray = parent.createDiv({ cls: "story-planner-tray" });
    tray.createDiv({
      cls: "story-planner-tray-heading",
      text: undated.length > 0 ? `Undated (${undated.length})` : "Undated",
    });
    tray.createDiv({
      cls: "story-planner-panel-hint",
      text:
        undated.length > 0
          ? "Drag a card onto a time to give it that date, then refine it in the card panel."
          : "Every card has a date. Drop a card here to take its date off.",
    });
    const list = tray.createDiv({ cls: "story-planner-tray-cards" });
    for (const id of undated) this.timeCard(list, story.cards[id]!, story);
    this.makeDropTarget(tray, "card", null, () => {
      const card = this.story?.cards[this.dragged!.id];
      if (!card?.date) return;
      const title = card.title;
      this.mutate((s) => setCardDate(s, card.id, "date", undefined));
      new Notice(`Took the date off "${title}". Press Ctrl+Z to undo.`);
    });
  }

  /**
   * A card dropped in story time. Within its own span it only changes plot
   * line, or its place among cards at the very same moment; an undated card
   * takes the span's date; a dated card moved to another span gets a new date
   * only after the writer confirms it.
   */
  private dropInTime(bucketId: string, plotLine: Id, target: Card | null, place: DropPlace): void {
    const story = this.story;
    const bucket = this.buckets.get(bucketId);
    const card = story && this.dragged ? story.cards[this.dragged.id] : undefined;
    if (!story || !bucket || !card || card === target) return;

    const toLane = (s: Story) => {
      if (s.cards[card.id]!.plotLine !== plotLine) moveCard(s, card.id, { chapter: s.cards[card.id]!.chapter, plotLine, besideCardId: card.id });
    };
    const reorder = (s: Story) => {
      if (target && place !== "on") reorderInTime(s, card.id, target.id, place === "after");
    };

    if (!card.date) {
      this.mutate((s) => {
        setCardDate(s, card.id, "date", { ...bucket.date });
        toLane(s);
      });
      new Notice(`"${card.title}" now happens ${bucket.label}. Refine the date in the card panel.`);
      return;
    }
    const current = bucketDate(story.calendars[0]!, referenceDate(story, card)!, this.zoom);
    if (JSON.stringify(current) === bucketId) {
      this.mutate((s) => {
        toLane(s);
        reorder(s);
      });
      return;
    }
    const initial = target?.date ? { ...target.date } : { ...bucket.date };
    new DateModal(
      this.app,
      story,
      `Move "${card.title}"`,
      `It is dated ${formatDateRange(story, card.date, card.endDate)}. Moving it here changes its date; check the new one.`,
      initial,
      (date) =>
        this.mutate((s) => {
          setCardDate(s, card.id, "date", date);
          const c = s.cards[card.id]!;
          // An end date that would now come before the start is taken off rather than left wrong.
          if (c.endDate && compareDates(s, c.endDate, date) < 0) delete c.endDate;
          toLane(s);
          reorder(s);
        }),
    ).open();
  }

  // -------------------------------------------------------------------------
  // Characters: the character track (the board with characters as lanes) and
  // the presence matrix, with the list of possible clashes.

  private viewState() {
    const path = this.file?.path;
    return path ? this.plugin.settings.viewState[path] : undefined;
  }

  private get characterMode(): "track" | "matrix" {
    return this.viewState()?.characterMode ?? "track";
  }

  private get characterAxis(): TrackAxis {
    return this.viewState()?.characterAxis ?? "chapters";
  }

  /** The characters shown as lanes; until the writer chooses, the first eight. */
  private lanes(story: Story): Id[] {
    const chosen = this.viewState()?.characterLanes;
    if (!chosen) return story.characters.slice(0, 8).map((c) => c.id);
    return chosen.filter((id) => story.characters.some((c) => c.id === id));
  }

  private characterActions(actions: HTMLElement, story: Story): void {
    const modes = actions.createDiv({ cls: "story-planner-segmented" });
    for (const [mode, label] of [
      ["track", "Track"],
      ["matrix", "Matrix"],
    ] as const) {
      const b = this.button(modes, label, () => this.setViewState({ characterMode: mode }));
      b.toggleClass("is-active", this.characterMode === mode);
      b.setAttr("aria-pressed", String(this.characterMode === mode));
    }
    const axis = actions.createEl("select", { cls: "dropdown" });
    axis.setAttr("aria-label", "Order");
    axis.createEl("option", { text: "By chapter" }).value = "chapters";
    axis.createEl("option", { text: "By story time" }).value = "time";
    axis.value = this.characterAxis;
    axis.addEventListener("change", () => this.setViewState({ characterAxis: axis.value as TrackAxis }));
    if (this.characterAxis === "time") {
      const zoom = actions.createEl("select", { cls: "dropdown" });
      zoom.setAttr("aria-label", "Zoom");
      for (const [value, label] of Object.entries(ZOOM_LABELS)) zoom.createEl("option", { text: label }).value = value;
      zoom.value = this.zoom;
      zoom.addEventListener("change", () => this.setViewState({ zoom: zoom.value as Zoom }));
    }
    if (this.characterMode === "track") {
      const lanes = this.lanes(story);
      this.button(actions, `Characters (${lanes.length})`, () =>
        new LaneModal(this.app, story, lanes, (chosen) => this.setViewState({ characterLanes: chosen })).open(),
      ).setAttr("title", "Choose which characters get a lane, and their order");
      if (lanes.length >= 2) {
        const shared = this.button(actions, "Shared scenes", () => this.setViewState({ sharedOnly: !this.viewState()?.sharedOnly }));
        const on = !!this.viewState()?.sharedOnly;
        shared.toggleClass("is-active", on);
        shared.setAttr("aria-pressed", String(on));
        shared.setAttr("title", "Show only the scenes all these characters are in");
      }
      this.highlightPicker(actions, story);
    }
  }

  private fillCharacters(parent: HTMLElement, story: Story): void {
    if (story.characters.length === 0) {
      parent.createDiv({
        cls: "story-planner-empty",
        text: "No characters yet. Add them in Setup, or name them on a card, to follow them here.",
      });
      return;
    }
    const clashes = findClashes(story);
    if (this.characterMode === "matrix") {
      this.fillMatrix(parent, story, clashes);
      return;
    }
    if (clashes.length > 0) {
      const note = parent.createDiv({ cls: "story-planner-clash-summary" });
      note.createSpan({ text: `${clashes.length} possible ${clashes.length === 1 ? "clash" : "clashes"}: a character in two places at once. ` });
      note.createEl("a", { text: "Show in the matrix" }).addEventListener("click", () => this.setViewState({ characterMode: "matrix" }));
    }
    this.fillTrack(parent, story, clashes);
  }

  private fillTrack(parent: HTMLElement, story: Story, clashes: Clash[]): void {
    const lanes = this.lanes(story);
    if (lanes.length === 0) {
      parent.createDiv({ cls: "story-planner-empty", text: "Choose characters to track with the Characters button." });
      return;
    }
    const axis = this.characterAxis;
    const shared = !!this.viewState()?.sharedOnly && lanes.length >= 2;
    const layout = computeTrackLayout(story, lanes, axis, this.zoom, this.orientation, shared);
    this.buckets = new Map(layout.buckets.map((b) => [b.id, b]));
    const clashing = new Set(clashes.flatMap((c) => c.cards.map((id) => `${c.characterId}:${id}`)));

    if (axis === "time" && layout.buckets.length === 0) {
      parent.createDiv({
        cls: "story-planner-empty story-planner-time-empty",
        text: "None of these characters' scenes has a date yet. Fill in \"When\" on a card to place it in story time.",
      });
    } else {
      const grid = this.spanGrid(parent, "is-track", layout.rows, layout.columns);
      for (const placed of layout.items) this.place(placed, this.renderTrackItem(grid, placed.item, story, clashing));
    }

    const notes: string[] = [];
    if (layout.hidden > 0) {
      notes.push(
        shared
          ? `${layout.hidden} ${layout.hidden === 1 ? "scene does" : "scenes do"} not have all of these characters.`
          : `${layout.hidden} ${layout.hidden === 1 ? "scene has" : "scenes have"} none of these characters.`,
      );
    }
    if (axis === "time") {
      const ids = new Set(lanes);
      const undated = Object.values(story.cards).filter((c) => !c.date && c.characters.some((x) => ids.has(x.id))).length;
      if (undated > 0) notes.push(`${undated} undated ${undated === 1 ? "scene is" : "scenes are"} left out; give ${undated === 1 ? "it" : "them"} a date to place ${undated === 1 ? "it" : "them"} here.`);
    }
    if (notes.length > 0) parent.createDiv({ cls: "story-planner-panel-hint story-planner-track-note", text: notes.join(" ") });
  }

  private renderTrackItem(grid: HTMLElement, item: TrackItem, story: Story, clashing: Set<string>): HTMLElement {
    switch (item.kind) {
      case "corner":
        return grid.createDiv({ cls: "story-planner-corner" });

      case "character-header": {
        const character = story.characters.find((c) => c.id === item.characterId);
        const el = grid.createDiv({ cls: "story-planner-lane-header is-character", text: character?.name ?? "" });
        el.style.setProperty("--lane-color", character?.color ?? "var(--interactive-accent)");
        el.setAttr("title", "Drag to reorder the lanes");
        this.makeDraggable(el, { kind: "character", id: item.characterId });
        this.makeDropTarget(el, "character", "lane", (place) => {
          const lanes = this.lanes(story).filter((id) => id !== this.dragged!.id);
          const index = lanes.indexOf(item.characterId);
          lanes.splice(place === "after" ? index + 1 : index, 0, this.dragged!.id);
          this.setViewState({ characterLanes: lanes });
        });
        return el;
      }

      case "chapter-header": {
        const chapter = story.chapters.find((c) => c.id === item.chapterId);
        const el = grid.createDiv({ cls: "story-planner-chapter-header", text: chapter?.name ?? "Off-page" });
        if (!chapter) el.addClass("is-off-page");
        return el;
      }

      case "time-header":
        return grid.createDiv({ cls: "story-planner-time-header", text: item.bucket.label });

      case "gap":
        return grid.createDiv({ cls: "story-planner-time-gap", text: `— ${item.text} —` });

      case "track-cell": {
        const el = grid.createDiv({ cls: "story-planner-cell" });
        this.makeDropTarget(
          el,
          "card",
          item.cardId ? "slot" : null,
          (place) => this.dropInTrack(item.characterId, { cardId: item.cardId, chapterId: item.chapterId, bucketId: item.bucketId, beside: true }, place),
          !!item.cardId,
        );
        el.addEventListener("dblclick", () => this.addCardForCharacter(item.characterId, item));
        return el;
      }

      case "appearance": {
        const card = story.cards[item.cardId]!;
        const el = this.appearance(grid, card, item.characterId, story, clashing.has(`${item.characterId}:${card.id}`));
        this.makeDropTarget(el, "card", "slot", (place) =>
          this.dropInTrack(item.characterId, { cardId: card.id, chapterId: card.chapter, bucketId: item.bucketId, beside: false }, place),
        );
        return el;
      }
    }
  }

  /** A card in one character's lane: what this character does there, in what role, and where. */
  private appearance(parent: HTMLElement, card: Card, characterId: Id, story: Story, clash: boolean): HTMLElement {
    const entry = card.characters.find((c) => c.id === characterId)!;
    const plotLine = story.plotLines.find((p) => p.id === card.plotLine);
    const chapter = story.chapters.find((c) => c.id === card.chapter);
    const el = parent.createDiv({ cls: `story-planner-card story-planner-appearance status-${card.status} role-${entry.role}` });
    if (!chapter) el.addClass("is-off-page");
    el.style.setProperty("--lane-color", plotLine?.color ?? "var(--interactive-accent)");
    if (this.characterAxis === "time") el.createDiv({ cls: "story-planner-card-badge", text: chapter?.name ?? "Off-page" });
    const role = el.createDiv({ cls: "story-planner-appearance-role" });
    role.createSpan({ cls: "story-planner-role-mark", text: ROLE_MARKS[entry.role] });
    role.createSpan({ text: ROLE_LABELS[entry.role] });
    el.createDiv({ cls: "story-planner-card-title", text: card.title });
    if (entry.note) el.createDiv({ cls: "story-planner-card-note", text: entry.note });
    if (card.date) el.createDiv({ cls: "story-planner-card-date", text: formatDateRange(story, card.date, card.endDate) });
    this.cardExtras(el, card, story, false);
    if (clash) {
      el.addClass("has-clash");
      el.createDiv({ cls: "story-planner-clash-mark", text: "In two places at once?" });
    }
    el.dataset.cardId = card.id;
    if (card.id === this.panel.selected) el.addClass("is-selected");
    el.addEventListener("click", () => this.select(card.id));
    el.addEventListener("dblclick", () => this.editTitleInPlace(el, card));
    this.makeDraggable(el, { kind: "card", id: card.id });
    return el;
  }

  /**
   * A card dropped in the character track. In a lane whose character is not
   * in the scene, it offers to add them; otherwise the card moves along the
   * axis as on the board (or in story time), keeping its plot line.
   */
  private dropInTrack(
    characterId: Id,
    target: { cardId?: Id; chapterId?: Id | null; bucketId?: string; beside: boolean },
    place: DropPlace,
  ): void {
    const story = this.story;
    const card = story && this.dragged ? story.cards[this.dragged.id] : undefined;
    if (!story || !card) return;
    const character = story.characters.find((c) => c.id === characterId);
    if (!character) return;

    if (!card.characters.some((c) => c.id === characterId)) {
      new ChoiceModal(this.app, {
        title: `Add ${character.name} to "${card.title}"?`,
        message: `Dropping a scene in ${character.name}'s lane adds ${character.name} to it. How do they take part?`,
        options: (["present", "pov", "mentioned"] as CharacterRole[]).map((role) => ({ value: role, label: ROLE_LABELS[role] })),
        confirm: "Add",
        safe: true,
        onChoose: (role) => this.mutate((s) => void addCharacterByName(s, card.id, character.name, role as CharacterRole)),
      }).open();
      return;
    }

    if (this.characterAxis === "time") {
      if (!target.bucketId) return;
      const targetCard = target.cardId && !target.beside ? story.cards[target.cardId] ?? null : null;
      this.dropInTime(target.bucketId, card.plotLine, targetCard, targetCard ? place : "on");
      return;
    }
    if (target.cardId === card.id) return;
    const anchor = target.cardId ? story.cards[target.cardId] : undefined;
    if (!anchor) {
      this.mutate((s) => moveCard(s, card.id, { chapter: target.chapterId ?? null, plotLine: card.plotLine }));
      return;
    }
    // Beside a scene of the same plot line would put two cards in one cell, so that lands after it.
    const besideOk = place === "on" && anchor.plotLine !== card.plotLine;
    const where = besideOk
      ? { besideCardId: anchor.id }
      : place === "before"
        ? { beforeCardId: anchor.id }
        : { afterCardId: anchor.id };
    this.mutate((s) => moveCard(s, card.id, { chapter: anchor.chapter, plotLine: card.plotLine, ...where }));
  }

  /** Double-clicking empty space in a lane makes a new scene with that character there. */
  private addCardForCharacter(characterId: Id, cell: { cardId?: Id; chapterId?: Id | null; bucketId?: string }): void {
    const story = this.story;
    const character = story?.characters.find((c) => c.id === characterId);
    if (!story || !character) return;
    const row = cell.cardId ? story.cards[cell.cardId] : undefined;
    const plotLine = row?.plotLine ?? story.plotLines[0]?.id;
    if (!plotLine) {
      new Notice("Add a plot line first: every scene belongs to one.");
      return;
    }
    const bucket = cell.bucketId ? this.buckets.get(cell.bucketId) : undefined;
    let id: Id | null = null;
    this.mutate((s) => {
      if (bucket) {
        id = addCardAt(s, { chapter: null, plotLine }, "New event");
        setCardDate(s, id, "date", { ...bucket.date });
      } else {
        // The new scene gets its own row, just after the row it was made in.
        id = addCardAt(s, row ? { chapter: row.chapter, plotLine, afterCardId: row.id } : { chapter: cell.chapterId ?? null, plotLine });
      }
      addCharacterByName(s, id, character.name, "present");
    });
    if (id) {
      this.select(id);
      this.panel.focusTitle();
    }
  }

  private fillMatrix(parent: HTMLElement, story: Story, clashes: Clash[]): void {
    const axis = this.characterAxis;
    const matrix = computeMatrix(story, axis, this.zoom);
    const wrap = parent.createDiv({ cls: "story-planner-matrix-wrap" });
    if (matrix.columns.length === 0) {
      wrap.createDiv({
        cls: "story-planner-empty",
        text: axis === "time" ? "No scene has a date yet, so there is nothing to show in story time." : "Add a chapter to start.",
      });
    } else {
      const legend = wrap.createDiv({ cls: "story-planner-panel-hint story-planner-matrix-legend" });
      legend.setText(`${ROLE_MARKS.pov} point of view   ${ROLE_MARKS.present} present   ${ROLE_MARKS.mentioned} mentioned   A number counts the scenes.`);
      const table = wrap.createEl("table", { cls: "story-planner-matrix" });
      const head = table.createEl("thead").createEl("tr");
      head.createEl("th", { cls: "story-planner-matrix-corner" });
      for (const column of matrix.columns) head.createEl("th", { text: column.label, attr: { title: column.label } });
      head.createEl("th", { text: "Scenes" });
      const body = table.createEl("tbody");
      for (const row of matrix.rows) {
        const character = story.characters.find((c) => c.id === row.characterId)!;
        const tr = body.createEl("tr");
        if (row.total === 0) tr.addClass("is-absent");
        const name = tr.createEl("th", { cls: "story-planner-matrix-name", text: character.name });
        name.style.setProperty("--lane-color", character.color);
        name.setAttr("title", `Follow ${character.name} in the track`);
        name.addEventListener("click", () => {
          const lanes = this.lanes(story);
          this.setViewState({ characterMode: "track", characterLanes: lanes.includes(character.id) ? lanes : [...lanes, character.id] });
        });
        row.cells.forEach((cell, i) => {
          const td = tr.createEl("td");
          if (!cell.role) return;
          td.addClass(`role-${cell.role}`);
          td.createSpan({ cls: "story-planner-role-mark", text: ROLE_MARKS[cell.role] });
          if (cell.cards.length > 1) td.createSpan({ cls: "story-planner-matrix-count", text: String(cell.cards.length) });
          const titles = cell.cards.map((id) => story.cards[id]?.title ?? "").join(", ");
          const clash = cell.clashes.length > 0 ? ". Possibly in two places at once." : "";
          td.setAttr("title", `${character.name} in ${matrix.columns[i]!.label}: ${titles}${clash}`);
          if (clash) td.addClass("has-clash");
          // A click opens the first scene, or the first one with a clash.
          td.addEventListener("click", () => this.select(cell.clashes[0] ?? cell.cards[0]!));
        });
        tr.createEl("td", { cls: "story-planner-matrix-total", text: String(row.total) });
      }
    }
    this.renderClashes(wrap, story, clashes);
  }

  /** The list of possible clashes, under the matrix. Advisory only: a story may mean it. */
  private renderClashes(parent: HTMLElement, story: Story, clashes: Clash[]): void {
    const box = parent.createDiv({ cls: "story-planner-clashes" });
    box.createDiv({ cls: "story-planner-tray-heading", text: clashes.length > 0 ? `Possible clashes (${clashes.length})` : "No clashes" });
    box.createDiv({
      cls: "story-planner-panel-hint",
      text:
        clashes.length > 0
          ? "A character is in two scenes whose times overlap, in places that are not one inside the other. This is only a warning; a twin, a disguise or a lie can explain it."
          : "No character is in two places at once. Scenes need a place and a time of day (or an end date) to be checked.",
    });
    const list = box.createEl("ul");
    for (const clash of clashes) {
      const character = story.characters.find((c) => c.id === clash.characterId);
      const item = list.createEl("li");
      item.createSpan({ text: `${character?.name ?? "Someone"}: ` });
      clash.cards.forEach((id, i) => {
        const card = story.cards[id]!;
        if (i > 0) item.createSpan({ text: " and " });
        const link = item.createEl("a", { text: card.title });
        link.addEventListener("click", () => this.select(id));
        const where = card.location ? locationPath(story, card.location) : "";
        const when = card.date ? formatDateRange(story, card.date, card.endDate) : "";
        item.createSpan({ cls: "story-planner-clash-detail", text: ` (${[where, when].filter(Boolean).join(", ")})` });
      });
    }
  }

  private button(parent: HTMLElement, text: string, onClick: () => void, disabled = false): HTMLButtonElement {
    const el = parent.createEl("button", { text });
    el.disabled = disabled;
    el.addEventListener("click", onClick);
    return el;
  }

  // -------------------------------------------------------------------------
  // Drag and drop. This uses plain pointer events rather than the browser's
  // HTML5 drag and drop, which Obsidian's own drag handling interferes with.
  // A press becomes a drag only after the pointer moves a few pixels, so a
  // plain click still opens the card.

  private makeDraggable(el: HTMLElement, dragged: Dragged): void {
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      this.cancelDrag();
      const startX = e.clientX;
      const startY = e.clientY;
      let ghost: HTMLElement | null = null;
      let target: { el: HTMLElement; spec: DropTargetSpec } | null = null;
      let place: DropPlace = "on";

      const clearMark = () => target?.el.removeClass("is-drop-target", "is-drop-before", "is-drop-after");

      const onMove = (ev: PointerEvent) => {
        if (!ghost) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
          this.dragged = dragged;
          ghost = document.body.createDiv({ cls: "story-planner-drag-ghost", text: el.innerText.split("\n")[0] ?? "" });
          el.addClass("is-dragging");
          this.contentEl.addClass("is-drag-active");
        }
        ev.preventDefault();
        ghost.style.left = `${ev.clientX + 12}px`;
        ghost.style.top = `${ev.clientY + 12}px`;

        clearMark();
        target = this.dropTargetAt(ev.clientX, ev.clientY, dragged.kind);
        if (target) {
          place = this.dropPlace(ev, target.el, target.spec);
          target.el.addClass(place === "on" ? "is-drop-target" : place === "after" ? "is-drop-after" : "is-drop-before");
        }
      };

      const finish = (drop: boolean) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("keydown", onKey, true);
        this.cancelDrag = () => {};
        clearMark();
        el.removeClass("is-dragging");
        this.contentEl.removeClass("is-drag-active");
        if (ghost) {
          ghost.remove();
          // The click that follows a drag must not open the card editor.
          this.suppressClick = true;
          window.setTimeout(() => (this.suppressClick = false), 0);
          if (drop && target) target.spec.onDrop(place);
        }
        this.dragged = null;
      };
      const onUp = () => finish(true);
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === "Escape") {
          ev.stopPropagation();
          finish(false);
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("keydown", onKey, true);
      this.cancelDrag = () => finish(false);
    });
  }

  /** Ends any drag in progress without dropping; replaced while a drag is running. */
  private cancelDrag: () => void = () => {};

  /**
   * Registers a drop target for one kind of dragged item. With an axis, the
   * drop lands before or after the target depending on which half the pointer
   * is in: "slot" is the axis scenes run along, "lane" the axis plot lines run along.
   */
  private makeDropTarget(
    el: HTMLElement,
    accepts: Dragged["kind"],
    axis: "slot" | "lane" | null,
    onDrop: (place: DropPlace) => void,
    middle = false,
  ): void {
    this.dropTargets.set(el, { accepts, axis, middle, onDrop });
  }

  private dropTargetAt(x: number, y: number, kind: Dragged["kind"]): { el: HTMLElement; spec: DropTargetSpec } | null {
    // The pointer can sit in the gap between grid cells; look a few pixels
    // around it so there is no dead space between targets.
    for (const [dx, dy] of GAP_PROBES) {
      for (let node = document.elementFromPoint(x + dx, y + dy); node && node !== this.contentEl; node = node.parentElement) {
        const spec = this.dropTargets.get(node as HTMLElement);
        if (spec) {
          if (spec.accepts === kind) return { el: node as HTMLElement, spec };
          break;
        }
      }
    }
    return null;
  }

  private dropPlace(e: PointerEvent, el: HTMLElement, spec: DropTargetSpec): DropPlace {
    if (!spec.axis) return "on";
    const rect = el.getBoundingClientRect();
    const alongY = (spec.axis === "slot") === (this.orientation === "vertical");
    // Fraction of the way along the axis, from 0 at the start to 1 at the end.
    const t = alongY ? (e.clientY - rect.top) / rect.height : (e.clientX - rect.left) / rect.width;
    if (spec.middle && t > 0.25 && t < 0.75) return "on";
    return t < 0.5 ? "before" : "after";
  }

  /**
   * A card, echo or empty cell as a drop target for cards: the dropped card
   * goes into a new row before or after the target's row, in `plotLine`. An
   * empty cell (`beside`) also takes drops in its middle, which put the card
   * in the target's row.
   */
  private makeCardDropTarget(el: HTMLElement, target: Card, plotLine: string, beside = false): void {
    this.makeDropTarget(
      el,
      "card",
      "slot",
      (place) =>
        this.mutate((s) =>
          moveCard(s, this.dragged!.id, {
            chapter: target.chapter,
            plotLine,
            ...(place === "on" ? { besideCardId: target.id } : place === "after" ? { afterCardId: target.id } : { beforeCardId: target.id }),
          }),
        ),
      beside,
    );
  }
}

/** The id to insert before, for a drop on `targetId`: the target itself, or the item after it. */
function neighbour<T extends { id: string }>(list: T[], targetId: string, after: boolean): string | null {
  if (!after) return targetId;
  const index = list.findIndex((x) => x.id === targetId);
  return list[index + 1]?.id ?? null;
}

const GAP_PROBES: [number, number][] = [
  [0, 0],
  [0, -6],
  [0, 6],
  [-6, 0],
  [6, 0],
];

