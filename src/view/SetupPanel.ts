import {
  addChapter,
  addCharacter,
  addPlotLine,
  cardsInChapter,
  cardsInPlotLine,
  cardsWithCharacter,
  deleteChapter,
  deleteCharacter,
  deletePlotLine,
  mergeCharacters,
  shiftInList,
} from "../model/setup";
import { Id, Story } from "../model/types";

/** A choice offered before an edit that affects cards, such as deleting a plot line that has cards. */
export interface Choice {
  title: string;
  message: string;
  options: { value: string; label: string }[];
  confirm: string;
  onChoose: (value: string) => void;
}

/** What the setup panel needs from the board that hosts it. */
export interface SetupPanelHost {
  /** Applies an edit with undo support; see CardPanelHost.edit. */
  edit(change: (story: Story) => boolean | void, coalesce?: string): void;
  close(): void;
  /** Asks the writer to pick one option, for example where a deleted chapter's scenes should go. */
  choose(choice: Choice): void;
  notice(message: string): void;
}

const DELETE_CARDS = "\u0000delete";

/**
 * The story setup panel: the story's title, plot lines, chapters and
 * characters. It shares the side area with the card panel; only one of the
 * two is open at a time.
 */
export class SetupPanel {
  readonly el: HTMLElement;
  private story: Story | null = null;
  private open = false;

  constructor(parent: HTMLElement, private host: SetupPanelHost) {
    this.el = parent.createDiv({ cls: "story-planner-panel story-planner-setup" });
    this.el.hidden = true;
  }

  get isOpen(): boolean {
    return this.open;
  }

  setOpen(open: boolean, story: Story | null): void {
    this.open = open && !!story;
    this.refresh(story);
  }

  /** Redraws the panel for the current story. `soft` (typing in the panel) leaves it as it is. */
  refresh(story: Story | null, soft = false): void {
    this.story = story;
    this.el.hidden = !this.open;
    if (!this.open || !story) {
      this.el.empty();
      return;
    }
    if (soft && this.el.childElementCount > 0) return;

    const active = document.activeElement;
    const focused = active instanceof HTMLElement && this.el.contains(active) ? active.dataset.field : undefined;
    const scroll = this.el.scrollTop;
    this.build(story);
    this.el.scrollTop = scroll;
    if (focused) {
      this.el.querySelector<HTMLElement>(`[data-field="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
    }
  }

  private build(story: Story): void {
    const el = this.el;
    el.empty();

    const header = el.createDiv({ cls: "story-planner-panel-header" });
    header.createDiv({ cls: "story-planner-panel-heading", text: "Story setup" });
    const close = header.createEl("button", { cls: "story-planner-panel-close clickable-icon", text: "×" });
    close.setAttr("aria-label", "Close");
    close.addEventListener("click", () => this.host.close());

    const titleField = this.section("Title");
    const title = this.textInput(titleField, story.title, "story-title");
    title.addEventListener("input", () => {
      if (title.value.trim()) this.host.edit((s) => void (s.title = title.value.trim()), "story-title");
    });

    this.buildPlotLines(story);
    this.buildChapters(story);
    this.buildCharacters(story);
  }

  private buildPlotLines(story: Story): void {
    const section = this.section("Plot lines");
    story.plotLines.forEach((plotLine, i) => {
      const row = section.createDiv({ cls: "story-planner-setup-row" });
      this.colorInput(row, plotLine.color, (color) =>
        this.host.edit((s) => void (s.plotLines.find((p) => p.id === plotLine.id)!.color = color)),
      );
      const name = this.textInput(row, plotLine.name, `plotline:${plotLine.id}`);
      name.addEventListener("input", () => {
        const value = name.value.trim();
        if (value) this.host.edit((s) => void (s.plotLines.find((p) => p.id === plotLine.id)!.name = value), `plotline:${plotLine.id}`);
      });
      this.count(row, cardsInPlotLine(story, plotLine.id).length);
      this.reorderButtons(row, i, story.plotLines.length, (by) => this.host.edit((s) => shiftInList(s.plotLines, plotLine.id, by)));
      this.iconButton(row, "×", `Delete ${plotLine.name}`, story.plotLines.length > 1, () => this.removePlotLine(story, plotLine.id));
    });
    this.addRow(section, "New plot line", "add-plotline", (name) => this.host.edit((s) => void addPlotLine(s, name)));
  }

  private buildChapters(story: Story): void {
    const section = this.section("Chapters");
    story.chapters.forEach((chapter, i) => {
      const row = section.createDiv({ cls: "story-planner-setup-row" });
      const name = this.textInput(row, chapter.name, `chapter:${chapter.id}`);
      name.addEventListener("input", () => {
        const value = name.value.trim();
        if (value) this.host.edit((s) => void (s.chapters.find((c) => c.id === chapter.id)!.name = value), `chapter:${chapter.id}`);
      });
      this.count(row, cardsInChapter(story, chapter.id).length);
      this.reorderButtons(row, i, story.chapters.length, (by) => this.host.edit((s) => shiftInList(s.chapters, chapter.id, by)));
      this.iconButton(row, "×", `Delete ${chapter.name}`, story.chapters.length > 1, () => this.removeChapter(story, chapter.id));
    });
    // An empty name takes the suggested one.
    this.addRow(section, `Chapter ${story.chapters.length + 1}`, "add-chapter", (name) => this.host.edit((s) => void addChapter(s, name)), true);
  }

  private buildCharacters(story: Story): void {
    const section = this.section("Characters");
    if (story.characters.length === 0) {
      section.createDiv({ cls: "story-planner-panel-hint", text: "Characters added to cards appear here too." });
    }
    story.characters.forEach((character, i) => {
      const row = section.createDiv({ cls: "story-planner-setup-row" });
      this.colorInput(row, character.color, (color) =>
        this.host.edit((s) => void (s.characters.find((c) => c.id === character.id)!.color = color)),
      );
      const name = this.textInput(row, character.name, `character:${character.id}`);
      name.addEventListener("input", () => {
        const value = name.value.trim();
        if (value) {
          this.host.edit((s) => void (s.characters.find((c) => c.id === character.id)!.name = value), `character:${character.id}`);
        }
      });
      this.count(row, cardsWithCharacter(story, character.id).length);
      this.reorderButtons(row, i, story.characters.length, (by) => this.host.edit((s) => shiftInList(s.characters, character.id, by)));
      this.iconButton(row, "⇥", `Merge ${character.name} into another character`, story.characters.length > 1, () =>
        this.mergeCharacter(story, character.id),
      );
      this.iconButton(row, "×", `Delete ${character.name}`, true, () => {
        const used = cardsWithCharacter(story, character.id).length;
        this.host.edit((s) => deleteCharacter(s, character.id));
        this.host.notice(
          `Deleted ${character.name}${used ? ` from ${used} ${used === 1 ? "card" : "cards"}` : ""}. Press Ctrl+Z to undo.`,
        );
      });
    });
    this.addRow(section, "New character", "add-character", (name) => this.host.edit((s) => void addCharacter(s, name)));
  }

  // -------------------------------------------------------------------------
  // Deleting things that cards depend on

  private removePlotLine(story: Story, id: Id): void {
    const plotLine = story.plotLines.find((p) => p.id === id)!;
    const count = cardsInPlotLine(story, id).length;
    if (count === 0) {
      this.host.edit((s) => deletePlotLine(s, id, null));
      return;
    }
    this.host.choose({
      title: `Delete "${plotLine.name}"`,
      message: `This plot line has ${count} ${count === 1 ? "card" : "cards"}. Where should ${count === 1 ? "it" : "they"} go?`,
      options: [
        ...story.plotLines.filter((p) => p.id !== id).map((p) => ({ value: p.id, label: `Move to ${p.name}` })),
        { value: DELETE_CARDS, label: `Delete ${count === 1 ? "the card" : `all ${count} cards`}` },
      ],
      confirm: "Delete plot line",
      onChoose: (value) => this.host.edit((s) => deletePlotLine(s, id, value === DELETE_CARDS ? null : value)),
    });
  }

  private removeChapter(story: Story, id: Id): void {
    const chapter = story.chapters.find((c) => c.id === id)!;
    const count = cardsInChapter(story, id).length;
    if (count === 0) {
      this.host.edit((s) => deleteChapter(s, id, null));
      return;
    }
    this.host.choose({
      title: `Delete "${chapter.name}"`,
      message: `This chapter has ${count} ${count === 1 ? "scene" : "scenes"}. Where should ${count === 1 ? "it" : "they"} go?`,
      options: [
        ...story.chapters
          .filter((c) => c.id !== id)
          .map((c) => ({ value: c.id, label: `Move to the end of ${c.name}` })),
        { value: "off-page", label: "Move off-page" },
        { value: DELETE_CARDS, label: `Delete ${count === 1 ? "the scene" : `all ${count} scenes`}` },
      ],
      confirm: "Delete chapter",
      onChoose: (value) => this.host.edit((s) => deleteChapter(s, id, value === DELETE_CARDS ? null : value)),
    });
  }

  private mergeCharacter(story: Story, id: Id): void {
    const character = story.characters.find((c) => c.id === id)!;
    this.host.choose({
      title: `Merge "${character.name}"`,
      message: `Every card with ${character.name} will have the character you pick instead, and ${character.name} is removed. Use this for duplicates.`,
      options: story.characters.filter((c) => c.id !== id).map((c) => ({ value: c.id, label: `Merge into ${c.name}` })),
      confirm: "Merge",
      onChoose: (value) => this.host.edit((s) => mergeCharacters(s, id, value)),
    });
  }

  // -------------------------------------------------------------------------
  // Small builders

  private section(label: string): HTMLElement {
    const field = this.el.createDiv({ cls: "story-planner-panel-field" });
    field.createDiv({ cls: "story-planner-panel-label", text: label });
    return field;
  }

  private textInput(parent: HTMLElement, value: string, field: string): HTMLInputElement {
    const input = parent.createEl("input");
    input.type = "text";
    input.value = value;
    input.dataset.field = field;
    // Leaving a name empty puts the saved name back.
    input.addEventListener("blur", () => {
      if (!input.value.trim()) this.refresh(this.story);
    });
    return input;
  }

  private colorInput(parent: HTMLElement, value: string, onChange: (color: string) => void): void {
    const input = parent.createEl("input", { cls: "story-planner-setup-color" });
    input.type = "color";
    input.value = value;
    input.addEventListener("change", () => onChange(input.value));
  }

  private count(parent: HTMLElement, n: number): void {
    const el = parent.createSpan({ cls: "story-planner-setup-count", text: String(n) });
    el.setAttr("title", `${n} ${n === 1 ? "card" : "cards"}`);
  }

  private reorderButtons(parent: HTMLElement, index: number, length: number, shift: (by: -1 | 1) => void): void {
    this.iconButton(parent, "↑", "Move up", index > 0, () => shift(-1));
    this.iconButton(parent, "↓", "Move down", index < length - 1, () => shift(1));
  }

  private iconButton(parent: HTMLElement, text: string, label: string, enabled: boolean, onClick: () => void): void {
    const button = parent.createEl("button", { cls: "clickable-icon story-planner-setup-button", text });
    button.setAttr("aria-label", label);
    button.disabled = !enabled;
    button.addEventListener("click", onClick);
  }

  private addRow(parent: HTMLElement, placeholder: string, field: string, onAdd: (name: string) => void, placeholderIsDefault = false): void {
    const row = parent.createDiv({ cls: "story-planner-setup-add" });
    const input = row.createEl("input");
    input.type = "text";
    input.placeholder = placeholder;
    input.dataset.field = field;
    const submit = () => {
      const name = input.value.trim() || (placeholderIsDefault ? placeholder : "");
      if (name) onAdd(name);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
    row.createEl("button", { text: "Add" }).addEventListener("click", submit);
  }
}
