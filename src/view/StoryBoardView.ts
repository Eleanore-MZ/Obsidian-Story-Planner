import { Notice, Scope, TextFileView, WorkspaceLeaf } from "obsidian";
import type StoryPlannerPlugin from "../main";
import { createCard, newId } from "../model/defaults";
import { History } from "../model/history";
import { chapterCards, moveCard, moveInList } from "../model/moves";
import { Card, Story } from "../model/types";
import { outlineWasEdited, parseStory, serializeStory } from "../format/storyFile";
import { BoardItem, computeBoardLayout, Orientation } from "./layout";
import { CardEditModal, TextPromptModal } from "./modals";

export const STORY_BOARD_VIEW = "story-planner-board";

/** What is being dragged. Kept on the view, since dataTransfer can't be read during dragover. */
type Dragged = { kind: "card" | "plotLine" | "chapter"; id: string };

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
    if (clear) this.contentEl.scrollTop = 0;
    this.render();
  }

  clear(): void {
    this.story = null;
    this.loadError = null;
    this.history.clear();
    this.contentEl.empty();
  }

  // -------------------------------------------------------------------------
  // Editing, undo and redo

  /** Applies a change with undo support. The change returns false when it turned out to change nothing. */
  private mutate(change: (story: Story) => boolean | void): void {
    if (!this.story) return;
    const before = JSON.stringify(this.story);
    const draft = JSON.parse(before) as Story;
    if (change(draft) === false || JSON.stringify(draft) === before) return;
    this.history.record(this.story);
    this.story = draft;
    this.changed();
  }

  undo(): void {
    if (!this.story) return;
    const previous = this.history.undo(this.story);
    if (!previous) return;
    this.story = previous;
    this.changed();
  }

  redo(): void {
    if (!this.story) return;
    const next = this.history.redo(this.story);
    if (!next) return;
    this.story = next;
    this.changed();
  }

  private changed(): void {
    this.outlineEdited = false;
    this.requestSave();
    this.render();
  }

  private addCard(chapterId: string | null, plotLineId: string): void {
    const draft = { title: "", synopsis: "", status: "idea" as const };
    new CardEditModal(this.app, draft, (edit) => {
      this.mutate((story) => {
        const order = chapterCards(story, chapterId).reduce((max, c) => Math.max(max, c.order), 0) + 1;
        const card = createCard({ ...edit, plotLine: plotLineId, chapter: chapterId, order });
        story.cards[card.id] = card;
      });
    }).open();
  }

  private editCard(cardId: string): void {
    const card = this.story?.cards[cardId];
    if (!card) return;
    new CardEditModal(
      this.app,
      card,
      (edit) =>
        this.mutate((story) => {
          Object.assign(story.cards[cardId]!, edit, { modified: new Date().toISOString() });
        }),
      () => {
        this.mutate((story) => {
          delete story.cards[cardId];
        });
        new Notice(`Deleted "${card.title}". Press Ctrl+Z to undo.`);
      },
    ).open();
  }

  // -------------------------------------------------------------------------
  // Rendering

  private get orientation(): Orientation {
    const path = this.file?.path;
    const saved = path ? this.plugin.settings.viewState[path]?.orientation : undefined;
    return saved ?? this.plugin.settings.defaultOrientation;
  }

  private toggleOrientation(): void {
    const path = this.file?.path;
    if (!path) return;
    const next: Orientation = this.orientation === "vertical" ? "horizontal" : "vertical";
    this.plugin.settings.viewState[path] = { ...this.plugin.settings.viewState[path], orientation: next };
    void this.plugin.saveSettings();
    this.render();
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("story-planner");

    if (this.loadError || !this.story) {
      const box = root.createDiv({ cls: "story-planner-error" });
      box.createEl("h3", { text: "This story could not be opened" });
      box.createEl("p", { text: this.loadError ?? "Unknown error." });
      box.createEl("p", {
        text: "The note has not been changed. You can open it as Markdown, or restore an earlier version with File recovery.",
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
    this.button(toolbar, "Add plot line", () =>
      new TextPromptModal(this.app, "New plot line", "", (name) =>
        this.mutate((s) => {
          s.plotLines.push({ id: newId("p"), name, color: PALETTE[s.plotLines.length % PALETTE.length]! });
        }),
      ).open(),
    );
    this.button(toolbar, "Add chapter", () =>
      new TextPromptModal(this.app, "New chapter", `Chapter ${story.chapters.length + 1}`, (name) =>
        this.mutate((s) => {
          s.chapters.push({ id: newId("c"), name });
        }),
      ).open(),
    );

    if (story.plotLines.length === 0) {
      root.createDiv({ cls: "story-planner-empty", text: "Add a plot line to start planning." });
      return;
    }

    const layout = computeBoardLayout(story, this.orientation);
    const grid = root.createDiv({ cls: `story-planner-grid is-${this.orientation}` });
    grid.style.gridTemplateRows = `repeat(${layout.rows}, auto)`;
    grid.style.gridTemplateColumns =
      this.orientation === "vertical"
        ? `var(--story-planner-header-size) repeat(${layout.columns - 1}, minmax(var(--story-planner-card-width), 1fr))`
        : `var(--story-planner-header-size) repeat(${layout.columns - 1}, var(--story-planner-card-width))`;

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
        this.makeDropTarget(el, "plotLine", "lane", (after) =>
          this.mutate((s) => moveInList(s.plotLines, this.dragged!.id, neighbour(s.plotLines, item.plotLineId, after))),
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
          this.makeDropTarget(el, "chapter", "slot", (after) =>
            this.mutate((s) => moveInList(s.chapters, this.dragged!.id, neighbour(s.chapters, chapter.id, after))),
          );
        } else {
          el.addClass("is-off-page");
        }
        return el;
      }

      case "add-card": {
        const el = grid.createDiv({ cls: "story-planner-add-card", text: "+" });
        el.setAttr("aria-label", "Add card");
        el.addEventListener("click", () => this.addCard(item.chapterId, item.plotLineId));
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

      case "chapter-end": {
        const el = grid.createDiv({ cls: "story-planner-chapter-end" });
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
        if (card.synopsis) el.createDiv({ cls: "story-planner-card-synopsis", text: card.synopsis });
        el.addEventListener("click", () => this.editCard(card.id));
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
        el.addEventListener("click", () => this.editCard(card.id));
        this.makeCardDropTarget(el, card, item.plotLineId);
        return el;
      }
    }
  }

  private button(parent: HTMLElement, text: string, onClick: () => void, disabled = false): void {
    const el = parent.createEl("button", { text });
    el.disabled = disabled;
    el.addEventListener("click", onClick);
  }

  // -------------------------------------------------------------------------
  // Drag and drop (desktop HTML5 drag and drop; a touch implementation can replace this later)

  private makeDraggable(el: HTMLElement, dragged: Dragged): void {
    el.draggable = true;
    el.addEventListener("dragstart", (e) => {
      this.dragged = dragged;
      e.dataTransfer?.setData("text/plain", dragged.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      el.addClass("is-dragging");
      this.contentEl.addClass("is-drag-active");
    });
    el.addEventListener("dragend", () => {
      el.removeClass("is-dragging");
      this.endDrag();
    });
  }

  /** Also called on drop, because a drop re-renders the board and the dragged element may never get its dragend. */
  private endDrag(): void {
    this.dragged = null;
    this.contentEl.removeClass("is-drag-active");
  }

  /**
   * Accepts drops of one kind. With an axis, the drop lands before or after the
   * target depending on which half the pointer is in: "slot" is the axis scenes
   * run along, "lane" the axis plot lines run along.
   */
  private makeDropTarget(
    el: HTMLElement,
    accepts: Dragged["kind"],
    axis: "slot" | "lane" | null,
    onDrop: (after: boolean) => void,
  ): void {
    const isAfter = (e: DragEvent) => {
      if (!axis) return false;
      const rect = el.getBoundingClientRect();
      const alongY = (axis === "slot") === (this.orientation === "vertical");
      return alongY ? e.clientY > rect.top + rect.height / 2 : e.clientX > rect.left + rect.width / 2;
    };
    const clearMarks = () => el.removeClass("is-drop-target", "is-drop-before", "is-drop-after");

    el.addEventListener("dragover", (e) => {
      if (this.dragged?.kind !== accepts) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      clearMarks();
      el.addClass(axis ? (isAfter(e) ? "is-drop-after" : "is-drop-before") : "is-drop-target");
    });
    el.addEventListener("dragleave", clearMarks);
    el.addEventListener("drop", (e) => {
      clearMarks();
      if (this.dragged?.kind !== accepts) return;
      e.preventDefault();
      onDrop(isAfter(e));
      this.endDrag();
    });
  }

  /** A card (or echo) as a drop target: the dropped card goes before or after it, in the target's plot line. */
  private makeCardDropTarget(el: HTMLElement, target: Card, plotLine: string): void {
    this.makeDropTarget(el, "card", "slot", (after) =>
      this.mutate((s) => {
        const draggedId = this.dragged!.id;
        let beforeCardId: string | null = target.id;
        if (after) {
          const siblings = chapterCards(s, target.chapter).filter((c) => c.id !== draggedId);
          const index = siblings.findIndex((c) => c.id === target.id);
          beforeCardId = siblings[index + 1]?.id ?? null;
        }
        return moveCard(s, draggedId, { chapter: target.chapter, plotLine, beforeCardId });
      }),
    );
  }
}

/** The id to insert before, for a drop on `targetId`: the target itself, or the item after it. */
function neighbour<T extends { id: string }>(list: T[], targetId: string, after: boolean): string | null {
  if (!after) return targetId;
  const index = list.findIndex((x) => x.id === targetId);
  return list[index + 1]?.id ?? null;
}

const PALETTE = ["#4a90d9", "#d9534f", "#5cb85c", "#f0ad4e", "#9b59b6", "#1abc9c", "#e67e22", "#7f8c8d"];
