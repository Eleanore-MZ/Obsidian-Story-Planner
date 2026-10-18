import { Notice, TextFileView, WorkspaceLeaf } from "obsidian";
import type StoryPlannerPlugin from "../main";
import { createCard, newId } from "../model/defaults";
import { Card, Story } from "../model/types";
import { outlineWasEdited, parseStory, serializeStory } from "../format/storyFile";
import { BoardItem, computeBoardLayout, Orientation } from "./layout";
import { CardEditModal, TextPromptModal } from "./modals";

export const STORY_BOARD_VIEW = "story-planner-board";

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

  constructor(leaf: WorkspaceLeaf, private plugin: StoryPlannerPlugin) {
    super(leaf);
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
    return serializeStory(this.story, this.frontmatter);
  }

  setViewData(data: string, clear: boolean): void {
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
    this.contentEl.empty();
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
    this.button(toolbar, "Add plot line", () =>
      new TextPromptModal(this.app, "New plot line", "", (name) => {
        story.plotLines.push({ id: newId("p"), name, color: PALETTE[story.plotLines.length % PALETTE.length]! });
        this.changed();
      }).open(),
    );
    this.button(toolbar, "Add chapter", () =>
      new TextPromptModal(this.app, "New chapter", `Chapter ${story.chapters.length + 1}`, (name) => {
        story.chapters.push({ id: newId("c"), name });
        this.changed();
      }).open(),
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
          new TextPromptModal(this.app, "Rename plot line", plotLine.name, (name) => {
            plotLine.name = name;
            this.changed();
          }).open();
        });
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
            new TextPromptModal(this.app, "Rename chapter", chapter.name, (name) => {
              chapter.name = name;
              this.changed();
            }).open();
          });
        } else {
          el.addClass("is-off-page");
        }
        return el;
      }

      case "add-card": {
        const el = grid.createDiv({ cls: "story-planner-add-card", text: "+" });
        el.setAttr("aria-label", "Add card");
        el.addEventListener("click", () => this.addCard(story, item.chapterId, item.plotLineId));
        return el;
      }

      case "card": {
        const card = story.cards[item.cardId]!;
        const plotLine = story.plotLines.find((p) => p.id === card.plotLine);
        const el = grid.createDiv({ cls: `story-planner-card status-${card.status}` });
        el.style.setProperty("--lane-color", plotLine?.color ?? "var(--interactive-accent)");
        el.createDiv({ cls: "story-planner-card-title", text: card.title });
        if (card.synopsis) el.createDiv({ cls: "story-planner-card-synopsis", text: card.synopsis });
        el.addEventListener("click", () => this.editCard(story, card));
        return el;
      }

      case "echo": {
        const card = story.cards[item.cardId]!;
        const home = story.plotLines.find((p) => p.id === card.plotLine);
        const el = grid.createDiv({ cls: "story-planner-echo", text: card.title });
        el.style.setProperty("--lane-color", home?.color ?? "var(--interactive-accent)");
        el.setAttr("aria-label", `Also in ${home?.name ?? "another plot line"}`);
        el.addEventListener("click", () => this.editCard(story, card));
        return el;
      }
    }
  }

  private button(parent: HTMLElement, text: string, onClick: () => void): void {
    parent.createEl("button", { text }).addEventListener("click", onClick);
  }

  // -------------------------------------------------------------------------
  // Editing

  private addCard(story: Story, chapterId: string | null, plotLineId: string): void {
    const draft = { title: "", synopsis: "", status: "idea" as const };
    new CardEditModal(this.app, draft, (edit) => {
      const siblings = Object.values(story.cards).filter((c) => c.chapter === chapterId);
      const order = siblings.reduce((max, c) => Math.max(max, c.order), 0) + 1;
      const card = createCard({ ...edit, plotLine: plotLineId, chapter: chapterId, order });
      story.cards[card.id] = card;
      this.changed();
    }).open();
  }

  private editCard(story: Story, card: Card): void {
    new CardEditModal(
      this.app,
      card,
      (edit) => {
        Object.assign(card, edit, { modified: new Date().toISOString() });
        this.changed();
      },
      () => {
        delete story.cards[card.id];
        this.changed();
        new Notice(`Deleted "${card.title}"`);
      },
    ).open();
  }

  private changed(): void {
    this.outlineEdited = false;
    this.requestSave();
    this.render();
  }
}

const PALETTE = ["#4a90d9", "#d9534f", "#5cb85c", "#f0ad4e", "#9b59b6", "#1abc9c", "#e67e22", "#7f8c8d"];
