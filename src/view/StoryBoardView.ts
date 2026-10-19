import { Notice, Scope, setIcon, TextFileView, WorkspaceLeaf } from "obsidian";
import type StoryPlannerPlugin from "../main";
import type { StoryTab } from "../settings";
import { addCardAt } from "../model/edits";
import { History } from "../model/history";
import { CardTarget, chapterCards, moveCard, moveInList } from "../model/moves";
import { SnapshotInfo } from "../model/snapshots";
import { formatDateRange } from "../model/calendar";
import { Card, Id, Story } from "../model/types";
import { outlineWasEdited, parseStory, serializeStory } from "../format/storyFile";
import { addChapter, addPlotLine } from "../model/setup";
import { CardPanel } from "./CardPanel";
import { SetupPanel } from "./SetupPanel";
import { BoardItem, computeBoardLayout, Orientation } from "./layout";
import { ChoiceModal, TextPromptModal } from "./modals";

export const STORY_BOARD_VIEW = "story-planner-board";

/** What is being dragged. */
type Dragged = { kind: "card" | "plotLine" | "chapter"; id: string };

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
  ["setup", "Setup", "settings-2"],
];

/** Board elements that count as empty space: clicking them clears the selection. */
const EMPTY_SPACE = ".story-planner-grid, .story-planner-corner, .story-planner-cell, .story-planner-chapter-end";

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
  private setup: SetupPanel;

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
    this.panel = new CardPanel(this.bodyEl, {
      edit: (change, coalesce) => this.mutate(change, coalesce),
      close: () => this.select(null),
      deleted: (title) => {
        this.select(null);
        new Notice(`Deleted "${title}". Press Ctrl+Z to undo.`);
      },
    });
    this.setup = new SetupPanel(this.contentEl, {
      edit: (change, coalesce) => this.mutate(change, coalesce),
      choose: (choice) => new ChoiceModal(this.app, choice).open(),
      notice: (message) => new Notice(message),
      snapshot: (reason) => this.takeSnapshot(reason),
      listSnapshots: () => this.listSnapshots(),
      restore: (snapshot) => void this.restoreSnapshot(snapshot),
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
  }

  async onClose(): Promise<void> {
    this.cancelDrag();
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

  private get orientation(): Orientation {
    const path = this.file?.path;
    const saved = path ? this.plugin.settings.viewState[path]?.orientation : undefined;
    return saved ?? this.plugin.settings.defaultOrientation;
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
    this.plugin.settings.viewState[path] = { ...this.plugin.settings.viewState[path], orientation: next };
    void this.plugin.saveSettings();
    this.render();
  }

  /** Redraws the toolbar and board. `typing` means the change came from typing in the panel. */
  private render(typing = false): void {
    const root = this.headerEl;
    this.dropTargets.clear();
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
    this.bodyEl.hidden = !onBoard;
    this.setup.setOpen(!onBoard, story);
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
      const compact = this.button(actions, "Compact", () => this.toggleCompact());
      compact.toggleClass("is-active", this.compact);
      compact.setAttr("aria-pressed", String(this.compact));
      compact.setAttr("title", "Stack each plot line's cards from the top of the chapter");
    }

    // Keep the panel on the selected card; it closes if the card is gone (after an undo, say).
    this.panel.show(story, onBoard ? this.panel.selected : null, typing);
    this.setup.refresh(story, typing);
    if (onBoard) this.renderBoard(story);
  }

  /**
   * Draws the board off-screen and swaps it in, so it is never empty for a
   * moment, and keeps the scroll position: an edit must not move the view.
   */
  private renderBoard(story: Story): void {
    const { scrollTop, scrollLeft } = this.boardEl;
    const content = document.createElement("div");
    this.fillBoard(content, story);
    this.boardEl.replaceChildren(...Array.from(content.childNodes));
    this.boardEl.scrollTop = scrollTop;
    this.boardEl.scrollLeft = scrollLeft;
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

