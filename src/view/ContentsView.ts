import { ItemView, WorkspaceLeaf } from "obsidian";
import type StoryPlannerPlugin from "../main";
import { outlineContents } from "../format/outline";
import type { StoryBoardView } from "./StoryBoardView";

export const STORY_CONTENTS_VIEW = "story-planner-contents";

/**
 * The story's contents, in the sidebar, for the board last in front: its
 * parts, characters, organizations, plot lines, acts, chapters and events.
 * Clicking one goes there on the board, which stays a board (Obsidian's own
 * Outline would open the note as Markdown).
 */
export class ContentsView extends ItemView {
  private board: StoryBoardView | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: StoryPlannerPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return STORY_CONTENTS_VIEW;
  }

  getDisplayText(): string {
    return "Story contents";
  }

  getIcon(): string {
    return "list-tree";
  }

  async onOpen(): Promise<void> {
    this.show(this.plugin.lastBoard());
  }

  /** Lists the contents of this board's story, or says there is no story in front. */
  show(board: StoryBoardView | null): void {
    this.board = board;
    const root = this.contentEl;
    root.empty();
    root.addClass("story-planner-contents");
    const story = board?.currentStory;
    if (!board || !story) {
      root.createDiv({ cls: "story-planner-contents-empty", text: "Open a story board to see its contents here." });
      return;
    }
    root.createDiv({ cls: "story-planner-contents-title", text: story.title });
    for (const entry of outlineContents(story)) {
      const item = root.createDiv({ cls: "story-planner-contents-item tree-item-self is-clickable", text: entry.label });
      item.style.setProperty("--depth", String(entry.depth));
      item.toggleClass("is-part", entry.depth === 0);
      item.addEventListener("click", () => {
        const target = this.board;
        if (!target) return;
        this.app.workspace.setActiveLeaf(target.leaf, { focus: true });
        target.goTo(entry);
      });
    }
  }
}
