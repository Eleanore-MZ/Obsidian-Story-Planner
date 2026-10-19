import { setIcon } from "obsidian";
import { reorderHandle } from "./reorder";
import { colorSwatch } from "./colorPicker";
import { formatOffset, formatStoryDate, parseOffset } from "../model/calendar";
import { DATE_TOKENS, defaultFormats, TIME_TOKENS } from "../model/dateFormat";
import { CALENDAR_PRESETS } from "../model/defaults";
import {
  addCategory,
  deleteCategory,
  plotLineColor,
  plotLinesInCategory,
  setPlotLineCategory,
  addChapter,
  addCharacter,
  addLocation,
  addPlotLine,
  addTag,
  addZone,
  applyCalendar,
  cardsWithBadDates,
  cardsWithDates,
  deleteLocation,
  deleteTag,
  deleteZone,
  cardsAtLocation,
  cardsWithTag,
  locationTree,
  nestLocation,
  shiftLocation,
  setReferenceZone,
  zoneUses,
  cardsInChapter,
  cardsInPlotLine,
  cardsWithCharacter,
  deleteChapter,
  deleteCharacter,
  deletePlotLine,
  mergeCharacters,
  moveIndex,
  movedIndex,
} from "../model/setup";
import { noteName, setEntityNote } from "../model/links";
import {
  actHeading,
  chapterHeading,
  chapterNumbers,
  chaptersInAct,
  chapterTitle,
  deleteAct,
  moveOutlineEntry,
  outlineEntries,
  startActAt,
} from "../model/chapters";
import { newId } from "../model/defaults";
import { SnapshotInfo } from "../model/snapshots";
import { Act, Calendar, Id, Story } from "../model/types";
import type { NoteHost } from "./CardPanel";

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
  /** Asks the writer to pick one option, for example where a deleted chapter's scenes should go. */
  choose(choice: Choice): void;
  notice(message: string): void;
  /** Keeps a safety snapshot of the story before a large destructive edit. */
  snapshot(reason: string): void;
  /** This story's safety snapshots, newest first; empty when snapshots are off. */
  listSnapshots(): Promise<SnapshotInfo[]>;
  restore(snapshot: SnapshotInfo): void;
  notes: NoteHost;
  /** Opens the editor for a chapter's title, number label and synopsis, or an act's. */
  editChapter(chapterId: Id): void;
  editAct(actId: Id): void;
  /** The section of setup last open for this story, kept with the board's view state. */
  section(): SetupSection | undefined;
  setSection(section: SetupSection): void;
}

/** The parts of story setup, each a page of its own. */
export type SetupSection = "story" | "chapters" | "characters" | "time" | "safety";

const SECTIONS: [SetupSection, string, string][] = [
  ["story", "Story", "book-open"],
  ["chapters", "Acts & chapters", "list-ordered"],
  ["characters", "Characters", "users"],
  ["time", "Time & location", "map-pin"],
  ["safety", "Safety", "shield-check"],
];

/** Sections remembered from before the sections were split up. */
const OLD_SECTIONS: Record<string, SetupSection> = { cast: "characters" };

/** Icons for the actions kept in each row's "⋯" menu. */
const ACTION_ICONS: Record<string, string> = { "✎": "pencil", "⚑": "milestone", "➕": "text", "×": "trash-2", "⇥": "indent", "⇤": "outdent", "\u{1F517}": "link", "⊘": "unlink" };

const DELETE_CARDS = "\u0000delete";

/**
 * The story setup page, shown in the Setup tab: the story's title, plot
 * lines, chapters and characters, each in its own section.
 */
export class SetupPanel {
  readonly el: HTMLElement;
  private story: Story | null = null;
  private open = false;
  /** One snapshot covers a whole visit to the calendar settings, not every keystroke. */
  private calendarSnapshotTaken = false;
  /** The scrolling column the sections are drawn in. */
  private body: HTMLElement | null = null;
  /** The list whose "+ New …" row is open as a text box, so it stays open after each add. */
  private adding: string | null = null;
  /** Chapters whose synopsis line is shown while still empty, after "Add a synopsis". */
  private synopsisOpen = new Set<string>();
  /** Folded parts of the calendar that are open, for as long as setup is. */
  private openFolds = new Set<string>(["calendar:Date format"]);

  constructor(parent: HTMLElement, private host: SetupPanelHost) {
    this.el = parent.createDiv({ cls: "story-planner-setup" });
    this.el.hidden = true;
  }

  get isOpen(): boolean {
    return this.open;
  }

  /**
   * Shows or hides the page. It is called on every redraw of the board, so it
   * redraws the page only when it opens or closes: rebuilding it while someone
   * types would replace the field under the cursor (and break input methods).
   */
  setOpen(open: boolean, story: Story | null): void {
    const opening = open && !this.open;
    if (opening) this.calendarSnapshotTaken = false;
    const was = this.open;
    this.open = open && !!story;
    if (this.open !== was || !this.open) this.refresh(story);
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
    const scroll = this.body?.scrollTop ?? 0;
    const shown = this.body?.dataset.section;
    this.build(story);
    // Stay where you were, unless another section is now showing.
    if (this.body && this.body.dataset.section === shown) this.body.scrollTop = scroll;
    if (focused) {
      this.el.querySelector<HTMLElement>(`[data-field="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
    }
  }

  /** A list of sections on the left, and the chosen one in a single column on the right. */
  private build(story: Story): void {
    const el = this.el;
    el.empty();
    const saved = this.host.section() as string | undefined;
    const current: SetupSection = SECTIONS.some(([key]) => key === saved) ? (saved as SetupSection) : (saved && OLD_SECTIONS[saved]) || "story";

    const nav = el.createDiv({ cls: "story-planner-setup-nav" });
    nav.setAttr("role", "tablist");
    nav.setAttr("aria-orientation", "vertical");
    for (const [key, label, icon] of SECTIONS) {
      const item = nav.createEl("button", { cls: "story-planner-setup-nav-item" });
      item.setAttr("role", "tab");
      item.setAttr("aria-selected", String(key === current));
      item.toggleClass("is-active", key === current);
      setIcon(item.createSpan({ cls: "story-planner-setup-nav-icon" }), icon);
      item.createSpan({ text: label });
      item.addEventListener("click", () => {
        if (key === current) return;
        this.adding = null;
        this.host.setSection(key);
      });
    }

    this.body = el.createDiv({ cls: "story-planner-setup-body" });
    this.body.dataset.section = current;
    const column = this.body.createDiv({ cls: "story-planner-setup-column" });
    this.column = column;

    if (current === "story") {
      const titleField = this.section("Title", "The title shown on the board and in the note's outline.");
      const title = this.textInput(titleField, story.title, "story-title");
      title.addEventListener("input", () => {
        if (title.value.trim()) this.host.edit((s) => void (s.title = title.value.trim()), "story-title");
      });
      this.buildPlotLines(story);
      this.buildCategories(story);
      this.buildTags(story);
    } else if (current === "chapters") {
      this.buildChapters(story);
    } else if (current === "characters") {
      this.buildCharacters(story);
    } else if (current === "time") {
      this.buildCalendar(story);
      this.buildZones(story);
      this.buildLocations(story);
    } else {
      this.buildSnapshots();
    }
  }

  /** Where sections are drawn: the content column. */
  private column: HTMLElement | null = null;

  private buildSnapshots(): void {
    const section = this.section(
      "Safety snapshots",
      "A copy of the whole story is kept before large deletions and merges. Restoring one can itself be undone.",
    );
    const list = section.createDiv({ cls: "story-planner-snapshots" });
    void this.host.listSnapshots().then((snapshots) => {
      if (!list.isConnected) return;
      if (snapshots.length === 0) {
        list.createDiv({ cls: "story-planner-panel-hint", text: "No snapshots yet." });
        return;
      }
      for (const snapshot of snapshots) {
        const row = list.createDiv({ cls: "story-planner-setup-row" });
        const text = row.createDiv({ cls: "story-planner-snapshot-text" });
        text.createDiv({ text: snapshot.reason });
        text.createDiv({ cls: "story-planner-panel-hint", text: new Date(snapshot.takenAt).toLocaleString() });
        row.createEl("button", { text: "Restore" }).addEventListener("click", () => this.host.restore(snapshot));
      }
    });
  }

  private buildPlotLines(story: Story): void {
    const section = this.section("Plot lines", "The columns of the board. The number is how many cards live in each.");
    story.plotLines.forEach((plotLine, i) => {
      const row = section.createDiv({ cls: "story-planner-setup-row" });
      // While the story colours by category, a plot line in a category shows that colour instead of its own.
      const byCategory = story.colorByCategory && story.plotLineCategories.some((c) => c.id === plotLine.category);
      const color = this.colorInput(row, plotLineColor(story, plotLine) ?? plotLine.color, (value) =>
        this.host.edit((s) => void (s.plotLines.find((p) => p.id === plotLine.id)!.color = value)),
      );
      if (byCategory) {
        color.disabled = true;
        color.setAttr("title", "Category colour");
      }
      const name = this.textInput(row, plotLine.name, `plotline:${plotLine.id}`);
      name.addEventListener("input", () => {
        const value = name.value.trim();
        if (value) this.host.edit((s) => void (s.plotLines.find((p) => p.id === plotLine.id)!.name = value), `plotline:${plotLine.id}`);
      });
      if (story.plotLineCategories.length > 0) {
        const category = this.dropdown(
          row,
          [["", "No category"], ...story.plotLineCategories.map((c): [string, string] => [c.id, c.name])],
          plotLine.category ?? "",
          (value) => this.host.edit((s) => setPlotLineCategory(s, plotLine.id, value || undefined)),
        );
        category.setAttr("aria-label", `Category of ${plotLine.name}`);
      }
      this.count(row, cardsInPlotLine(story, plotLine.id).length);
      this.dragHandle(row, "plotlines", i, (to) => this.host.edit((s) => moveIndex(s.plotLines, i, to)));
      this.iconButton(row, "×", `Delete ${plotLine.name}`, story.plotLines.length > 1, () => this.removePlotLine(story, plotLine.id));
    });
    this.addRow(section, "New plot line", "add-plotline", (name) => this.host.edit((s) => void addPlotLine(s, name)));
  }

  /** Groups of plot lines, such as "Main story lines", which can give their plot lines one colour. */
  private buildCategories(story: Story): void {
    const section = this.section(
      "Plot line categories",
      "Group plot lines, such as \"Main story lines\" or \"Subplots\". Choose each plot line's category above. The number is how many plot lines are in each.",
    );
    const toggle = section.createDiv({ cls: "story-planner-setup-row" });
    this.checkbox(toggle, "Colour plot lines by category", story.colorByCategory, (on) =>
      this.host.edit((s) => void (s.colorByCategory = on)),
    ).dataset.field = "color-by-category";
    story.plotLineCategories.forEach((category, i) => {
      const row = section.createDiv({ cls: "story-planner-setup-row" });
      this.colorInput(row, category.color, (color) =>
        this.host.edit((s) => void (s.plotLineCategories.find((c) => c.id === category.id)!.color = color)),
      );
      const name = this.textInput(row, category.name, `category:${category.id}`);
      name.addEventListener("input", () => {
        const value = name.value.trim();
        if (value) {
          this.host.edit((s) => void (s.plotLineCategories.find((c) => c.id === category.id)!.name = value), `category:${category.id}`);
        }
      });
      const n = plotLinesInCategory(story, category.id).length;
      const count = row.createSpan({ cls: "story-planner-setup-count", text: String(n) });
      count.setAttr("title", `${n} ${n === 1 ? "plot line" : "plot lines"}`);
      this.dragHandle(row, "categories", i, (to) => this.host.edit((s) => moveIndex(s.plotLineCategories, i, to)));
      this.iconButton(row, "×", `Delete ${category.name} (its plot lines are kept)`, true, () => {
        this.host.edit((s) => deleteCategory(s, category.id));
        this.host.notice(`Deleted the category ${category.name}${n ? `; its ${n === 1 ? "plot line keeps" : "plot lines keep"} their own colours` : ""}. Press Ctrl+Z to undo.`);
      });
    });
    this.addRow(section, "New category", "add-category", (name) => this.host.edit((s) => void addCategory(s, name)));
  }

  /**
   * Acts and chapters as one list: each act's row sits just above its first
   * chapter. Dragging an act's row moves where the act begins; a chapter
   * belongs to the act above it, so dragging a chapter past an act's row moves
   * it into that act. Chapters above the first act's row are in no act.
   */
  private buildChapters(story: Story): void {
    const section = this.section(
      "Acts and chapters",
      "In reading order, numbered automatically. Drag an act's row to move where it begins; a chapter belongs to the act above it. The number on the right is how many scenes each chapter has.",
    );
    // Acts can be switched off for a story; they are kept, and come back when switched on.
    const useActs = section.createDiv({ cls: "story-planner-setup-row" });
    this.checkbox(useActs, "Use acts", story.actsEnabled !== false, (on) => this.host.edit((s) => void (s.actsEnabled = on))).dataset.field = "use-acts";
    const showActs = story.actsEnabled !== false;
    if (!showActs && story.acts.length > 0) {
      useActs.createSpan({ cls: "story-planner-panel-hint", text: `${story.acts.length} ${story.acts.length === 1 ? "act is" : "acts are"} kept, hidden.` });
    }
    const numbers = chapterNumbers(story);
    // Without acts, the list is just the chapters, and dragging reorders them.
    const entries = showActs ? outlineEntries(story) : story.chapters.map((c) => ({ kind: "chapter" as const, id: c.id }));
    const move = (from: number) => (to: number) =>
      this.host.edit((s) => (showActs ? moveOutlineEntry(s, from, to) : moveIndex(s.chapters, from, to)));
    entries.forEach((entry, i) => {
      if (entry.kind === "act") {
        const act = story.acts.find((a) => a.id === entry.id)!;
        const row = section.createDiv({ cls: "story-planner-setup-row story-planner-setup-act" });
        row.createSpan({ cls: "story-planner-setup-tag is-act", text: actHeading(story, act) });
        const title = this.textInput(row, act.title ?? "", `act:${act.id}`);
        title.placeholder = "Act title";
        title.addEventListener("input", () =>
          this.host.edit((s) => {
            const target = s.acts.find((a) => a.id === act.id)!;
            const value = title.value.trim();
            if ((target.title ?? "") === value) return false;
            if (value) target.title = value;
            else delete target.title;
          }, `act:${act.id}`),
        );
        const n = chaptersInAct(story, act.id).length;
        const count = row.createSpan({ cls: "story-planner-setup-count", text: String(n) });
        count.setAttr("title", `${n} ${n === 1 ? "chapter" : "chapters"}`);
        this.dragHandle(row, "outline", i, move(i));
        this.iconButton(row, "✎", "Edit title and synopsis…", true, () => this.host.editAct(act.id));
        this.iconButton(row, "×", `Delete ${actHeading(story, act)} (its chapters are kept)`, true, () => {
          this.host.edit((s) => deleteAct(s, act.id));
          this.host.notice(`Deleted ${actHeading(story, act)}; its chapters are kept. Press Ctrl+Z to undo.`);
        });
        // The act's synopsis, as a quiet line under its title.
        this.synopsisLine(section, act.summary ?? "", "What happens in this act", `act-summary:${act.id}`, (value) =>
          this.host.edit((s) => {
            const target = s.acts.find((a) => a.id === act.id)!;
            if ((target.summary ?? "") === value) return false;
            if (value.trim()) target.summary = value;
            else delete target.summary;
          }, `act-summary:${act.id}`),
        );
        return;
      }
      const chapter = story.chapters.find((c) => c.id === entry.id)!;
      const row = section.createDiv({ cls: "story-planner-setup-row" });
      row.toggleClass("is-in-act", !!chapter.act);
      row.createSpan({ cls: "story-planner-setup-tag", text: chapterHeading(story, chapter, numbers).replace(/^Chapter /, "") });
      const name = this.textInput(row, chapter.name, `chapter:${chapter.id}`);
      name.placeholder = "No title";
      name.addEventListener("input", () => {
        const value = name.value.trim();
        this.host.edit((s) => {
          const target = s.chapters.find((c) => c.id === chapter.id)!;
          if (target.name === value) return false;
          target.name = value;
        }, `chapter:${chapter.id}`);
      });
      this.count(row, cardsInChapter(story, chapter.id).length);
      this.dragHandle(row, "outline", i, move(i));
      this.iconButton(row, "✎", "Edit title, number and synopsis…", true, () => this.host.editChapter(chapter.id));
      if (!chapter.summary?.trim() && !this.synopsisOpen.has(chapter.id)) {
        this.iconButton(row, "➕", "Add a synopsis", true, () => {
          this.synopsisOpen.add(chapter.id);
          this.refresh(this.story);
          this.el.querySelector<HTMLElement>(`[data-field="${CSS.escape(`chapter-summary:${chapter.id}`)}"]`)?.focus();
        });
      }
      if (showActs) this.iconButton(row, "⚑", "Start a new act here", true, () => this.host.edit((s) => startActAt(s, chapter.id) !== null));
      this.iconButton(row, "×", `Delete ${chapterTitle(story, chapter, numbers)}`, story.chapters.length > 1, () => this.removeChapter(story, chapter.id));
      // A chapter's synopsis shows as a quiet line under it once it has one (or is being written).
      if (chapter.summary?.trim() || this.synopsisOpen.has(chapter.id)) {
        this.synopsisLine(section, chapter.summary ?? "", "What happens in this chapter", `chapter-summary:${chapter.id}`, (value) =>
          this.host.edit((s) => {
            const target = s.chapters.find((c) => c.id === chapter.id)!;
            if ((target.summary ?? "") === value) return false;
            if (value.trim()) target.summary = value;
            else delete target.summary;
          }, `chapter-summary:${chapter.id}`),
        );
      }
    });
    this.addRow(section, "New chapter (title optional)", "add-chapter", (name) => this.host.edit((s) => void addChapter(s, name.trim())), true);
    if (showActs) this.addRow(section, "New act", "add-act", (name) =>
      this.host.edit((s) => {
        const act: Act = { id: newId("a") };
        if (name.trim()) act.title = name.trim();
        s.acts.push(act);
      }),
    );
  }

  private buildCharacters(story: Story): void {
    const section = this.section(
      "Characters",
      "Characters added on cards appear here too.",
    );
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
      if (story.zones.length > 0) {
        const zone = this.dropdown(
          row,
          [["", "No zone"], ...story.zones.map((z): [string, string] => [z.id, z.name])],
          character.zone ?? "",
          (value) =>
            this.host.edit((s) => {
              const c = s.characters.find((c) => c.id === character.id)!;
              if (value) c.zone = value;
              else delete c.zone;
            }),
        );
        zone.setAttr("aria-label", `Time zone for scenes from ${character.name}'s point of view`);
      }
      this.noteButtons(row, "character", character.id, character.name, character.note);
      this.count(row, cardsWithCharacter(story, character.id).length);
      this.dragHandle(row, "characters", i, (to) => this.host.edit((s) => moveIndex(s.characters, i, to)));
      this.iconButton(row, "⇥", `Merge ${character.name} into another character`, story.characters.length > 1, () =>
        this.mergeCharacter(story, character.id),
      );
      this.iconButton(row, "×", `Delete ${character.name}`, true, () => {
        const used = cardsWithCharacter(story, character.id).length;
        if (used > 0) this.host.snapshot(`Before deleting character ${character.name}`);
        this.host.edit((s) => deleteCharacter(s, character.id));
        this.host.notice(
          `Deleted ${character.name}${used ? ` from ${used} ${used === 1 ? "card" : "cards"}` : ""}. Press Ctrl+Z to undo.`,
        );
      });
    });
    this.addRow(section, "New character", "add-character", (name) => this.host.edit((s) => void addCharacter(s, name)));
  }

  private buildLocations(story: Story): void {
    const section = this.section(
      "Locations",
      "Places, nested like a room inside a house inside a city. A zone set on a place covers everything inside it. ⇥ puts a place inside the one above; ⇤ takes it out.",
    );
    for (const { location, depth } of locationTree(story)) {
      const row = section.createDiv({ cls: "story-planner-setup-row" });
      row.style.paddingLeft = `calc(${depth} * var(--size-4-4, 16px))`;
      const name = this.textInput(row, location.name, `location:${location.id}`);
      name.addEventListener("input", () => {
        const value = name.value.trim();
        if (value) this.host.edit((s) => void (s.locations.find((l) => l.id === location.id)!.name = value), `location:${location.id}`);
      });
      if (story.zones.length > 0) {
        const zone = this.dropdown(row, [["", "Zone from above"], ...story.zones.map((z): [string, string] => [z.id, z.name])], location.zone ?? "", (value) =>
          this.calendarEdit((s) => {
            const l = s.locations.find((x) => x.id === location.id)!;
            if (value) l.zone = value;
            else delete l.zone;
          }),
        );
        zone.setAttr("aria-label", `Time zone of ${location.name}`);
      }
      this.noteButtons(row, "location", location.id, location.name, location.note);
      this.count(row, cardsAtLocation(story, location.id).length);
      const siblings = story.locations.filter((l) => l.parent === location.parent);
      const index = siblings.indexOf(location);
      // Places reorder among the places beside them, inside the same place.
      this.dragHandle(row, `locations:${location.parent ?? ""}`, index, (to) =>
        this.host.edit((s) => {
          let moved = false;
          for (let step = 0; step < Math.abs(to - index); step++) moved = shiftLocation(s, location.id, to > index ? 1 : -1) || moved;
          return moved;
        }),
      );
      this.iconButton(row, "⇤", `Take ${location.name} out of the place it is in`, !!location.parent, () =>
        this.host.edit((s) => nestLocation(s, location.id, false)),
      );
      this.iconButton(row, "⇥", `Put ${location.name} inside the place above`, index > 0, () => this.host.edit((s) => nestLocation(s, location.id, true)));
      this.iconButton(row, "×", `Delete ${location.name}`, true, () => {
        const used = cardsAtLocation(story, location.id).length;
        this.host.edit((s) => deleteLocation(s, location.id));
        this.host.notice(`Deleted ${location.name}${used ? `; ${used} ${used === 1 ? "card has" : "cards have"} no location now` : ""}. Press Ctrl+Z to undo.`);
      });
    }
    this.addRow(section, "New place", "add-location", (name) => this.host.edit((s) => void addLocation(s, name)));
  }

  private buildTags(story: Story): void {
    const section = this.section("Scene tags");
    story.tags.forEach((tag, i) => {
      const row = section.createDiv({ cls: "story-planner-setup-row" });
      this.colorInput(row, tag.color, (color) => this.host.edit((s) => void (s.tags.find((t) => t.id === tag.id)!.color = color)));
      const name = this.textInput(row, tag.name, `tag:${tag.id}`);
      name.addEventListener("input", () => {
        const value = name.value.trim();
        if (value) this.host.edit((s) => void (s.tags.find((t) => t.id === tag.id)!.name = value), `tag:${tag.id}`);
      });
      this.count(row, cardsWithTag(story, tag.id).length);
      this.dragHandle(row, "tags", i, (to) => this.host.edit((s) => moveIndex(s.tags, i, to)));
      this.iconButton(row, "×", `Delete ${tag.name}`, true, () => {
        const used = cardsWithTag(story, tag.id).length;
        this.host.edit((s) => deleteTag(s, tag.id));
        this.host.notice(`Deleted the tag ${tag.name}${used ? ` from ${used} ${used === 1 ? "card" : "cards"}` : ""}. Press Ctrl+Z to undo.`);
      });
    });
    this.addRow(section, "New tag", "add-tag", (name) => this.host.edit((s) => void addTag(s, name)));
  }

  // -------------------------------------------------------------------------
  // Calendar and time zones

  /** Applies a calendar or zone edit, keeping one snapshot first when cards are dated. */
  private calendarEdit(change: (story: Story, calendar: Calendar) => boolean | void, coalesce?: string): void {
    if (!this.calendarSnapshotTaken && this.story && cardsWithDates(this.story).length > 0) {
      this.host.snapshot("Before editing the calendar");
      this.calendarSnapshotTaken = true;
    }
    this.host.edit((s) => change(s, s.calendars[0]!), coalesce);
  }

  private buildCalendar(story: Story): void {
    const calendar = story.calendars[0]!;
    const dated = cardsWithDates(story).length;
    const section = this.section(
      "Calendar",
      dated > 0
        ? `${dated} ${dated === 1 ? "card is" : "cards are"} dated. Dates keep their day, month and year when the calendar changes, and a snapshot is kept before the first change.`
        : "The story's own calendar. Every part can be changed, and nothing assumes the real-world calendar.",
    );
    const bad = cardsWithBadDates(story);
    if (bad.length > 0) {
      section.createDiv({
        cls: "story-planner-panel-hint is-problem",
        text: `${bad.length === 1 ? "This card has a date" : "These cards have dates"} the calendar cannot show: ${bad
          .map((c) => c.title)
          .join(", ")}.`,
      });
    }

    const presetRow = section.createDiv({ cls: "story-planner-setup-row" });
    const preset = this.dropdown(presetRow, CALENDAR_PRESETS.map((p, i): [string, string] => [String(i), p.name]), "0", () => {});
    presetRow.createEl("button", { text: "Start from preset" }).addEventListener("click", () => {
      const chosen = CALENDAR_PRESETS[Number(preset.value)]!;
      const apply = () => this.calendarEdit((s) => applyCalendar(s, chosen.create()));
      if (dated === 0) return apply();
      this.host.choose({
        title: `Replace the calendar with "${chosen.name}"`,
        message: `${dated} ${dated === 1 ? "card keeps its date" : "cards keep their dates"} as written, which may then fall on other days of the week or not exist at all. A snapshot is kept first.`,
        options: [{ value: "replace", label: "Replace the calendar" }],
        confirm: "Replace",
        onChoose: apply,
      });
    });

    const name = this.labelled(section, "Name");
    const nameInput = this.textInput(name, calendar.name, "calendar-name");
    nameInput.addEventListener("input", () => {
      if (nameInput.value.trim()) this.calendarEdit((_, c) => void (c.name = nameInput.value.trim()), "calendar-name");
    });

    this.buildFormats(section, story);

    this.subheading(section, "Months");
    calendar.months.forEach((month, i) => {
      const row = section.createDiv({ cls: "story-planner-setup-row" });
      const monthName = this.textInput(row, month.name, `month:${i}`);
      monthName.addEventListener("input", () => {
        if (monthName.value.trim()) this.calendarEdit((_, c) => void (c.months[i]!.name = monthName.value.trim()), `month:${i}`);
      });
      this.numberInput(row, month.days, `month-days:${i}`, 1, 1000, "days", (days) => this.calendarEdit((_, c) => void (c.months[i]!.days = days), `month-days:${i}`));
      this.dragHandle(row, "months", i, (to) =>
        this.calendarEdit((_, c) => {
          if (!moveIndex(c.months, i, to)) return false;
          // The leap day stays with its month.
          if (c.leap) c.leap.monthIndex = movedIndex(c.leap.monthIndex, i, to);
        }),
      );
      this.iconButton(row, "×", `Delete ${month.name}`, calendar.months.length > 1, () =>
        this.calendarEdit((_, c) => {
          c.months.splice(i, 1);
          if (c.leap && c.leap.monthIndex >= c.months.length) c.leap.monthIndex = c.months.length - 1;
          else if (c.leap && c.leap.monthIndex > i) c.leap.monthIndex--;
        }),
      );
    });
    this.addRow(section, `Month ${calendar.months.length + 1}`, "add-month", (n) => this.calendarEdit((_, c) => void c.months.push({ name: n, days: 30 })), true);

    this.subheading(section, "Leap years");
    const leapRow = section.createDiv({ cls: "story-planner-setup-row story-planner-setup-sentence" });
    const leapOn = this.checkbox(leapRow, "Every", !!calendar.leap, (on) =>
      this.calendarEdit((_, c) => {
        if (on) c.leap = { everyYears: 4, monthIndex: Math.min(1, c.months.length - 1), extraDays: 1 };
        else delete c.leap;
      }),
    );
    leapOn.dataset.field = "leap-on";
    if (calendar.leap) {
      this.numberInput(leapRow, calendar.leap.everyYears, "leap-years", 1, 10000, "years,", (n) => this.calendarEdit((_, c) => void (c.leap!.everyYears = n), "leap-years"));
      this.dropdown(leapRow, calendar.months.map((m, i): [string, string] => [String(i), m.name]), String(calendar.leap.monthIndex), (v) =>
        this.calendarEdit((_, c) => void (c.leap!.monthIndex = Number(v))),
      );
      this.numberInput(leapRow, calendar.leap.extraDays, "leap-days", 1, 1000, calendar.leap.extraDays === 1 ? "more day" : "more days", (n) =>
        this.calendarEdit((_, c) => void (c.leap!.extraDays = n), "leap-days"),
      );
    } else {
    }

    this.subheading(section, "Week");
    const weekOn = this.checkbox(section, "This world has weeks", (calendar.weekdays ?? []).length > 0, (on) =>
      this.calendarEdit((_, c) => {
        if (on) {
          c.weekdays = ["First day", "Second day", "Third day", "Fourth day", "Fifth day", "Sixth day", "Seventh day"];
          c.weekAnchor = { year: 1, month: 1, day: 1, weekdayIndex: 0 };
        } else {
          delete c.weekdays;
          delete c.weekAnchor;
        }
      }),
    );
    weekOn.dataset.field = "week-on";
    const weekdays = calendar.weekdays ?? [];
    if (weekdays.length > 0) {
      weekdays.forEach((day, i) => {
        const row = section.createDiv({ cls: "story-planner-setup-row" });
        const dayName = this.textInput(row, day, `weekday:${i}`);
        dayName.addEventListener("input", () => {
          if (dayName.value.trim()) this.calendarEdit((_, c) => void (c.weekdays![i] = dayName.value.trim()), `weekday:${i}`);
        });
        this.dragHandle(row, "weekdays", i, (to) => this.calendarEdit((_, c) => moveIndex(c.weekdays!, i, to)));
        this.iconButton(row, "×", `Delete ${day}`, weekdays.length > 1, () =>
          this.calendarEdit((_, c) => {
            c.weekdays!.splice(i, 1);
            if (c.weekAnchor && c.weekAnchor.weekdayIndex >= c.weekdays!.length) c.weekAnchor.weekdayIndex = 0;
          }),
        );
      });
      this.addRow(section, "New weekday", "add-weekday", (n) => this.calendarEdit((_, c) => void c.weekdays!.push(n)));
      const anchor = calendar.weekAnchor ?? { year: 1, month: 1, day: 1, weekdayIndex: 0 };
      const anchorRow = section.createDiv({ cls: "story-planner-setup-row story-planner-setup-sentence" });
      const setAnchor = (fields: Partial<typeof anchor>) =>
        this.calendarEdit((_, c) => void (c.weekAnchor = { ...(c.weekAnchor ?? anchor), ...fields }), "week-anchor");
      this.numberInput(anchorRow, anchor.day, "anchor-day", 1, 1000, "", (n) => setAnchor({ day: n }));
      this.dropdown(anchorRow, calendar.months.map((m, i): [string, string] => [String(i + 1), m.name]), String(anchor.month), (v) =>
        this.calendarEdit((_, c) => void (c.weekAnchor = { ...(c.weekAnchor ?? anchor), month: Number(v) })),
      );
      this.numberInput(anchorRow, anchor.year, "anchor-year", -1000000, 1000000, "was a", (n) => setAnchor({ year: n }));
      this.dropdown(anchorRow, weekdays.map((w, i): [string, string] => [String(i), w]), String(anchor.weekdayIndex), (v) =>
        this.calendarEdit((_, c) => void (c.weekAnchor = { ...(c.weekAnchor ?? anchor), weekdayIndex: Number(v) })),
      );
    }

    this.subheading(section, "Day");
    const dayRow = section.createDiv({ cls: "story-planner-setup-row story-planner-setup-sentence" });
    this.numberInput(dayRow, calendar.hoursPerDay, "hours-per-day", 1, 1000, "hours of", (n) => this.calendarEdit((_, c) => void (c.hoursPerDay = n), "hours-per-day"));
    this.numberInput(dayRow, calendar.minutesPerHour, "minutes-per-hour", 1, 1000, "minutes", (n) =>
      this.calendarEdit((_, c) => void (c.minutesPerHour = n), "minutes-per-hour"),
    );

    this.subheading(section, "Parts of the day");
    (calendar.dayParts ?? []).forEach((part, i) => {
      const row = section.createDiv({ cls: "story-planner-setup-row story-planner-setup-sentence" });
      const partName = this.textInput(row, part.name, `daypart:${part.id}`);
      partName.addEventListener("input", () => {
        if (partName.value.trim()) this.calendarEdit((_, c) => void (c.dayParts![i]!.name = partName.value.trim()), `daypart:${part.id}`);
      });
      this.numberInput(row, part.startHour, `daypart-start:${part.id}`, 0, calendar.hoursPerDay, "to", (n) =>
        this.calendarEdit((_, c) => void (c.dayParts![i]!.startHour = n), `daypart-start:${part.id}`),
      );
      this.numberInput(row, part.endHour, `daypart-end:${part.id}`, 0, calendar.hoursPerDay, "", (n) =>
        this.calendarEdit((_, c) => void (c.dayParts![i]!.endHour = n), `daypart-end:${part.id}`),
      );
      this.iconButton(row, "×", `Delete ${part.name}`, true, () => this.calendarEdit((_, c) => void c.dayParts!.splice(i, 1)));
    });
    this.addRow(section, "New part of the day", "add-daypart", (n) =>
      this.calendarEdit((_, c) => {
        const id = n.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "part";
        const taken = new Set((c.dayParts ?? []).map((p) => p.id));
        let unique = id;
        for (let k = 2; taken.has(unique); k++) unique = `${id}-${k}`;
        (c.dayParts ??= []).push({ id: unique, name: n, startHour: 0, endHour: 1 });
      }),
    );

    this.subheading(section, "Eras");
    section.createDiv({
      cls: "story-planner-panel-hint",
      text: "Optional, in order. Years count from the first era that counts up; an era before it may count down, like BC. Give other eras their length so later eras follow them.",
    });
    const eras = calendar.eras ?? [];
    eras.forEach((era, i) => {
      const row = section.createDiv({ cls: "story-planner-setup-row story-planner-setup-sentence" });
      const eraName = this.textInput(row, era.name, `era:${era.id}`);
      eraName.addEventListener("input", () => {
        if (eraName.value.trim()) this.calendarEdit((_, c) => void (c.eras![i]!.name = eraName.value.trim()), `era:${era.id}`);
      });
      this.checkbox(row, "counts down", !!era.countsDown, (on) =>
        this.calendarEdit((_, c) => {
          if (on) c.eras![i]!.countsDown = true;
          else delete c.eras![i]!.countsDown;
        }),
      );
      this.numberInput(row, era.years ?? "", `era-years:${era.id}`, 1, 100000000, "years", (n) =>
        this.calendarEdit((_, c) => void (c.eras![i]!.years = n), `era-years:${era.id}`),
      );
      this.dragHandle(row, "eras", i, (to) => this.calendarEdit((_, c) => moveIndex(c.eras!, i, to)));
      this.iconButton(row, "×", `Delete ${era.name}`, true, () => this.calendarEdit((_, c) => void c.eras!.splice(i, 1)));
    });
    this.addRow(section, "New era", "add-era", (n) =>
      this.calendarEdit((_, c) => void (c.eras ??= []).push({ id: `e${Math.random().toString(36).slice(2, 8)}`, name: n })),
    );
    // Months, leap years, the week and so on fold away below the preset and the name.
    this.foldSubsections(section, "calendar");

    const sample = Object.values(story.cards).find((c) => c.date);
  }

  private buildZones(story: Story): void {
    const calendar = story.calendars[0]!;
    const section = this.section(
      "Time zones",
      "For events in different places at the same time. Offsets are hours and minutes of this story's day, measured from the reference zone. Cards take their zone from the card, its location, or the point-of-view character.",
    );
    for (const zone of story.zones) {
      const row = section.createDiv({ cls: "story-planner-setup-row" });
      const isReference = story.referenceZone === zone.id;
      const radio = row.createEl("input");
      radio.type = "radio";
      radio.name = "story-planner-reference-zone";
      radio.checked = isReference;
      radio.setAttr("aria-label", `Make ${zone.name} the reference zone`);
      radio.addEventListener("change", () => this.calendarEdit((s) => setReferenceZone(s, zone.id)));
      const zoneName = this.textInput(row, zone.name, `zone:${zone.id}`);
      zoneName.addEventListener("input", () => {
        const value = zoneName.value.trim();
        if (value) this.calendarEdit((s) => void (s.zones.find((z) => z.id === zone.id)!.name = value), `zone:${zone.id}`);
      });
      const offset = row.createEl("input", { cls: "story-planner-setup-number" });
      offset.type = "text";
      offset.value = formatOffset(calendar, zone.offsetMinutes);
      offset.dataset.field = `zone-offset:${zone.id}`;
      offset.disabled = isReference;
      offset.setAttr("aria-label", isReference ? "The reference zone has no offset" : "Offset from the reference zone, such as +2:30");
      offset.addEventListener("input", () => {
        const minutes = parseOffset(calendar, offset.value);
        offset.toggleClass("is-problem", minutes === null);
        if (minutes !== null) this.calendarEdit((s) => void (s.zones.find((z) => z.id === zone.id)!.offsetMinutes = minutes), `zone-offset:${zone.id}`);
      });
      this.count(row, zoneUses(story, zone.id));
      this.iconButton(row, "×", `Delete ${zone.name}`, true, () => this.calendarEdit((s) => deleteZone(s, zone.id)));
    }
    this.addRow(section, story.zones.length === 0 ? "Reference zone, e.g. Harbour Time" : "New zone", "add-zone", (n) =>
      this.calendarEdit((s) => void addZone(s, n)),
    );
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
      onChoose: (value) => {
        this.host.snapshot(`Before deleting plot line ${plotLine.name}`);
        this.host.edit((s) => deletePlotLine(s, id, value === DELETE_CARDS ? null : value));
      },
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
      title: `Delete ${chapterTitle(story, chapter)}`,
      message: `This chapter has ${count} ${count === 1 ? "scene" : "scenes"}. Where should ${count === 1 ? "it" : "they"} go?`,
      options: [
        ...story.chapters
          .filter((c) => c.id !== id)
          .map((c) => ({ value: c.id, label: `Move to the end of ${chapterTitle(story, c)}` })),
        { value: "off-page", label: "Move off-page" },
        { value: DELETE_CARDS, label: `Delete ${count === 1 ? "the scene" : `all ${count} scenes`}` },
      ],
      confirm: "Delete chapter",
      onChoose: (value) => {
        this.host.snapshot(`Before deleting ${chapterTitle(story, chapter)}`);
        this.host.edit((s) => deleteChapter(s, id, value === DELETE_CARDS ? null : value));
      },
    });
  }

  private mergeCharacter(story: Story, id: Id): void {
    const character = story.characters.find((c) => c.id === id)!;
    this.host.choose({
      title: `Merge "${character.name}"`,
      message: `Every card with ${character.name} will have the character you pick instead, and ${character.name} is removed. Use this for duplicates.`,
      options: story.characters.filter((c) => c.id !== id).map((c) => ({ value: c.id, label: `Merge into ${c.name}` })),
      confirm: "Merge",
      onChoose: (value) => {
        this.host.snapshot(`Before merging ${character.name}`);
        this.host.edit((s) => mergeCharacters(s, id, value));
      },
    });
  }

  // -------------------------------------------------------------------------
  // Small builders

  /** This story's own date and time formats, overriding the plugin's, with a preview. */
  private buildFormats(section: HTMLElement, story: Story): void {
    this.subheading(section, "Date format");
    const fallback = defaultFormats();
    // A date from the story, or the first day of the calendar, to show the format on.
    const calendar = story.calendars[0]!;
    const sample = cardsWithDates(story)[0]?.date ?? {
      calendar: calendar.id,
      year: 1,
      month: 1,
      day: 1,
      minutes: 9 * calendar.minutesPerHour + 30,
    };
    const preview = section.createDiv({ cls: "story-planner-format-preview" });
    const showPreview = (s: Story) => {
      const shown = { ...sample, approximate: false, zone: undefined };
      if (shown.minutes === undefined && shown.dayPart === undefined) shown.minutes = 9 * calendar.minutesPerHour + 30;
      preview.setText(`For example: ${formatStoryDate(s, shown)}`);
    };
    showPreview(story);
    for (const [label, key, placeholder] of [
      ["Date", "dateFormat", fallback.date],
      ["Time", "timeFormat", fallback.time],
    ] as const) {
      const row = this.labelled(section, label);
      const input = this.textInput(row, story[key] ?? "", `format:${key}`);
      input.placeholder = placeholder;
      input.addEventListener("input", () => {
        const value = input.value.trim();
        this.host.edit((s) => {
          if ((s[key] ?? "") === value) return false;
          if (value) s[key] = value;
          else delete s[key];
          showPreview(s);
        }, `format:${key}`);
      });
    }
  }

  private subheading(parent: HTMLElement, text: string): void {
    parent.createEl("h4", { cls: "story-planner-setup-subheading", text });
  }

  private labelled(parent: HTMLElement, label: string): HTMLElement {
    const row = parent.createDiv({ cls: "story-planner-setup-row story-planner-setup-sentence" });
    row.createSpan({ text: label });
    return row;
  }

  /** A short number field followed by a word, e.g. "[31] days". Out-of-range values are not saved. */
  private numberInput(
    parent: HTMLElement,
    value: number | "",
    field: string,
    min: number,
    max: number,
    after: string,
    onChange: (n: number) => void,
  ): HTMLInputElement {
    const input = parent.createEl("input", { cls: "story-planner-setup-number" });
    input.type = "text";
    input.inputMode = "numeric";
    input.value = String(value);
    input.dataset.field = field;
    input.addEventListener("input", () => {
      const n = Number(input.value.trim());
      const ok = input.value.trim() !== "" && Number.isInteger(n) && n >= min && n <= max;
      input.toggleClass("is-problem", !ok);
      if (ok) onChange(n);
    });
    if (after) parent.createSpan({ text: after });
    return input;
  }

  private checkbox(parent: HTMLElement, label: string, checked: boolean, onChange: (on: boolean) => void): HTMLInputElement {
    const el = parent.createEl("label", { cls: "story-planner-panel-check" });
    const box = el.createEl("input");
    box.type = "checkbox";
    box.checked = checked;
    box.addEventListener("change", () => onChange(box.checked));
    el.createSpan({ text: label });
    return box;
  }

  private dropdown(parent: HTMLElement, options: [string, string][], value: string, onChange: (value: string) => void): HTMLSelectElement {
    const select = parent.createEl("select", { cls: "dropdown" });
    for (const [key, label] of options) select.createEl("option", { text: label }).value = key;
    select.value = value;
    select.addEventListener("change", () => onChange(select.value));
    return select;
  }

  private section(label: string, hint?: string): HTMLElement {
    const section = (this.column ?? this.el).createDiv({ cls: "story-planner-setup-section" });
    section.createEl("h3", { cls: "story-planner-setup-heading", text: label });
    return section;
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

  /** A colour square that opens the colour board (see colorPicker.ts). */
  private colorInput(parent: HTMLElement, value: string, onChange: (color: string) => void): HTMLButtonElement {
    return colorSwatch(parent, value, onChange);
  }

  private count(parent: HTMLElement, n: number): void {
    const el = parent.createSpan({ cls: "story-planner-setup-count", text: String(n) });
    el.setAttr("title", `${n} ${n === 1 ? "card" : "cards"}`);
  }

  /** A grip for dragging a row up or down its list; see reorderHandle. */
  private dragHandle(row: HTMLElement, group: string, index: number, moveTo: (to: number) => void): void {
    reorderHandle(row, group, index, moveTo);
  }

  /** Links a character or place to a note of its own, or opens and unlinks the one it has. */
  private noteButtons(row: HTMLElement, kind: "character" | "location", id: Id, name: string, note: string | undefined): void {
    const notes = this.host.notes;
    if (!note) {
      this.iconButton(row, "\u{1F517}", `Link a note to ${name}`, true, () =>
        notes.pick(`Link a note to ${name}…`, (path) => this.host.edit((s) => setEntityNote(s, kind, id, path))),
      );
      return;
    }
    const exists = notes.exists(note);
    const link = row.createEl("a", { cls: "story-planner-setup-note", text: noteName(note) });
    link.toggleClass("is-broken", !exists);
    link.setAttr("title", exists ? `Open ${note} (Ctrl+click opens it in a new tab)` : `${note} is missing. It may have been deleted or moved outside Obsidian.`);
    link.addEventListener("click", (e) => {
      e.preventDefault();
      notes.open(note, e.ctrlKey || e.metaKey);
    });
    this.iconButton(row, "⊘", `Unlink ${noteName(note)} from ${name} (the note itself is kept)`, true, () =>
      this.host.edit((s) => setEntityNote(s, kind, id, undefined)),
    );
  }

  /**
   * An action for a row, such as delete, merge or nest: a small icon on the
   * row itself, one click away. They show when the row is hovered or has the
   * keyboard focus, to keep the list quiet.
   */
  private iconButton(parent: HTMLElement, text: string, label: string, enabled: boolean, onClick: () => void): void {
    let actions = parent.querySelector<HTMLElement>(":scope > .story-planner-row-actions");
    if (!actions) actions = parent.createDiv({ cls: "story-planner-row-actions" });
    const icon = ACTION_ICONS[text] ?? "circle";
    const button = actions.createEl("button", { cls: "clickable-icon story-planner-row-action" });
    setIcon(button, icon);
    button.setAttr("aria-label", label);
    button.toggleClass("is-danger", icon === "trash-2");
    button.disabled = !enabled;
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
  }

  /**
   * The quiet "+ New …" row at the end of a list. Clicking it opens a text
   * box: Enter adds (and the box stays open for the next one), Escape or
   * leaving it empty closes it.
   */
  private addRow(parent: HTMLElement, placeholder: string, field: string, onAdd: (name: string) => void, placeholderIsDefault = false): void {
    const row = parent.createDiv({ cls: "story-planner-setup-add" });
    if (this.adding !== field) {
      const open = row.createEl("button", { cls: "story-planner-setup-add-button" });
      setIcon(open.createSpan({ cls: "story-planner-setup-add-icon" }), "plus");
      open.createSpan({ text: placeholder });
      open.dataset.field = `${field}:open`;
      open.addEventListener("click", () => {
        this.adding = field;
        row.empty();
        this.addInput(row, placeholder, field, onAdd, placeholderIsDefault).focus();
      });
      return;
    }
    this.addInput(row, placeholder, field, onAdd, placeholderIsDefault);
  }

  private addInput(row: HTMLElement, placeholder: string, field: string, onAdd: (name: string) => void, placeholderIsDefault: boolean): HTMLInputElement {
    const input = row.createEl("input");
    input.type = "text";
    input.placeholder = `${placeholder}, then Enter`;
    input.dataset.field = field;
    const close = () => {
      if (this.adding === field) this.adding = null;
      this.refresh(this.story);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const name = input.value.trim() || (placeholderIsDefault ? placeholder : "");
        if (name) onAdd(name);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    });
    // Leaving an empty box closes it. (After Enter the panel is redrawn with a
    // fresh box that has the cursor, and this one is no longer on the page.)
    input.addEventListener("blur", () =>
      window.setTimeout(() => {
        if (input.isConnected && document.activeElement !== input && !input.value.trim()) close();
      }, 0),
    );
    return input;
  }

  /** A borderless line of text under a row's title that grows as it is written in. */
  private synopsisLine(parent: HTMLElement, value: string, placeholder: string, field: string, onChange: (value: string) => void): void {
    const line = parent.createEl("textarea", { cls: "story-planner-setup-synopsis" });
    line.rows = 1;
    line.placeholder = placeholder;
    line.value = value;
    line.dataset.field = field;
    const grow = () => {
      line.style.height = "auto";
      line.style.height = `${line.scrollHeight}px`;
    };
    line.addEventListener("input", () => {
      grow();
      onChange(line.value);
    });
    window.requestAnimationFrame(grow);
  }

  /**
   * Folds a section's parts: everything after each subheading, up to the
   * next, goes into a fold that remembers being open while setup is.
   */
  private foldSubsections(section: HTMLElement, key: string): void {
    let fold: HTMLDetailsElement | null = null;
    for (const child of Array.from(section.children) as HTMLElement[]) {
      if (child.tagName === "H4") {
        const name = child.textContent ?? "";
        const id = `${key}:${name}`;
        fold = createEl("details", { cls: "story-planner-setup-fold" });
        fold.open = this.openFolds.has(id);
        const folded = fold;
        fold.addEventListener("toggle", () => (folded.open ? this.openFolds.add(id) : this.openFolds.delete(id)));
        fold.createEl("summary", { cls: "story-planner-setup-subheading", text: name });
        child.replaceWith(fold);
        continue;
      }
      if (fold) fold.appendChild(child);
    }
  }
}
