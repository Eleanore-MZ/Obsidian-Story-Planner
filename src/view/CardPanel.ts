import { moveCard } from "../model/moves";
import {
  addCharacterByName,
  deleteCard,
  removeCardCharacter,
  setEcho,
  updateCard,
  updateCardCharacter,
} from "../model/edits";
import { compareDates, effectiveZone, ZoneSource } from "../model/calendar";
import { setCardDate, setCardLocation, setCardTag, setRelationshipState } from "../model/edits";
import { locationTree, relationshipOf } from "../model/setup";
import { CardStatus, CharacterRole, Id, Story } from "../model/types";
import { DateEditor } from "./DateEditor";
import { addCardNote, noteName, removeCardNote } from "../model/links";

export const STATUS_LABELS: Record<CardStatus, string> = {
  idea: "Idea",
  outlined: "Outlined",
  drafted: "Drafted",
  revised: "Revised",
};

const ROLE_LABELS: Record<CharacterRole, string> = {
  pov: "Point of view",
  present: "Present",
  mentioned: "Mentioned",
};

/** Linked notes, as the board offers them to its panels. */
export interface NoteHost {
  exists(path: string): boolean;
  /** Opens a note beside the board, or in a new tab. */
  open(path: string, newTab: boolean): void;
  pick(placeholder: string, onPick: (path: string) => void): void;
  /** Makes a new note from the card, links it and opens it. */
  createFromCard(cardId: Id): void;
}

/** What the panel needs from the board that hosts it. */
export interface CardPanelHost {
  /**
   * Applies an edit with undo support. Edits that share a `coalesce` key in a
   * row become one undo step, so typing a title is undone as a whole.
   */
  edit(change: (story: Story) => boolean | void, coalesce?: string): void;
  /** Closes the panel and clears the selection. */
  close(): void;
  /** Called after the card was deleted from the panel. */
  deleted(title: string): void;
  notes: NoteHost;
}

/**
 * The side panel that edits the selected card. Text fields save as you type
 * and are never rebuilt while you are in them, so the board can redraw
 * freely behind the panel without stealing focus.
 */
export class CardPanel {
  readonly el: HTMLElement;
  private cardId: Id | null = null;
  private story: Story | null = null;

  constructor(parent: HTMLElement, private host: CardPanelHost) {
    this.el = parent.createDiv({ cls: "story-planner-panel" });
    this.el.hidden = true;
  }

  get selected(): Id | null {
    return this.cardId;
  }

  /**
   * Shows a card, or hides the panel for null. A `soft` refresh, used while
   * typing in the panel, only updates the fields that are not being edited.
   */
  show(story: Story, cardId: Id | null, soft = false): void {
    this.story = story;
    if (!cardId || !story.cards[cardId]) {
      this.cardId = null;
      this.el.hidden = true;
      this.el.empty();
      return;
    }
    const sameCard = cardId === this.cardId;
    this.cardId = cardId;
    this.el.hidden = false;
    if (sameCard && soft) {
      this.syncFields();
      return;
    }
    // Rebuild, but keep the cursor where it was if the same card stays open.
    const active = document.activeElement;
    const focused = sameCard && active instanceof HTMLElement && this.el.contains(active) ? active.dataset.field : undefined;
    const selection = isTextField(active) ? [(active as HTMLInputElement).selectionStart, (active as HTMLInputElement).selectionEnd] : null;
    const scroll = sameCard ? this.el.scrollTop : 0;
    this.build();
    this.el.scrollTop = scroll;
    if (focused) {
      const again = this.el.querySelector<HTMLInputElement>(`[data-field="${CSS.escape(focused)}"]`);
      again?.focus({ preventScroll: true });
      if (again && selection) again.setSelectionRange(selection[0] ?? null, selection[1] ?? null);
    }
  }

  /** Puts the cursor in the title, with the text selected, as for a new card. */
  focusTitle(): void {
    const input = this.el.querySelector<HTMLInputElement>("input.story-planner-panel-title");
    input?.focus();
    input?.select();
  }

  private get card() {
    return this.cardId && this.story ? this.story.cards[this.cardId] : undefined;
  }

  /** Updates the values of fields that are not being edited. */
  private syncFields(): void {
    const card = this.card;
    if (!card) return;
    for (const el of Array.from(this.el.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-field]"))) {
      if (el === document.activeElement) continue;
      const field = el.dataset.field!;
      if (field === "title") el.value = card.title;
      else if (field === "synopsis") el.value = card.synopsis;
      else if (field === "relationship") el.value = card.relationshipState ?? "";
      else if (field.startsWith("note:")) {
        el.value = card.characters.find((c) => `note:${c.id}` === field)?.note ?? "";
      }
    }
  }

  private build(): void {
    const card = this.card!;
    const story = this.story!;
    const id = card.id;
    const el = this.el;
    el.empty();

    const header = el.createDiv({ cls: "story-planner-panel-header" });
    header.createDiv({ cls: "story-planner-panel-heading", text: "Card" });
    const close = header.createEl("button", { cls: "story-planner-panel-close clickable-icon", text: "×" });
    close.setAttr("aria-label", "Close");
    close.addEventListener("click", () => this.host.close());

    // Title and synopsis save as you type.
    const title = this.field("Title").createEl("input", { cls: "story-planner-panel-title" });
    title.type = "text";
    title.value = card.title;
    title.dataset.field = "title";
    title.addEventListener("input", () =>
      this.host.edit((s) => updateCard(s, id, { title: title.value }), `title:${id}`),
    );
    title.addEventListener("blur", () => {
      if (!title.value.trim()) {
        title.value = "Untitled";
        this.host.edit((s) => updateCard(s, id, { title: "Untitled" }), `title:${id}`);
      }
    });
    title.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        (this.el.querySelector("textarea") as HTMLTextAreaElement | null)?.focus();
      }
    });

    const synopsis = this.field("Synopsis").createEl("textarea", { cls: "story-planner-panel-synopsis" });
    synopsis.rows = 6;
    synopsis.value = card.synopsis;
    synopsis.dataset.field = "synopsis";
    synopsis.addEventListener("input", () =>
      this.host.edit((s) => updateCard(s, id, { synopsis: synopsis.value }), `synopsis:${id}`),
    );

    this.select(this.field("Status"), STATUS_LABELS, card.status, (value) =>
      this.host.edit((s) => updateCard(s, id, { status: value as CardStatus })),
    );

    // Where the card sits on the board.
    const plotLines = Object.fromEntries(story.plotLines.map((p) => [p.id, p.name]));
    this.select(this.field("Plot line"), plotLines, card.plotLine, (value) =>
      // Beside itself: same row, new plot line.
      this.host.edit((s) => moveCard(s, id, { chapter: s.cards[id]!.chapter, plotLine: value, besideCardId: id })),
    );

    const chapterIds = new Set(story.chapters.map((c) => c.id));
    const chapters: Record<string, string> = Object.fromEntries(story.chapters.map((c) => [c.id, c.name]));
    chapters[OFF_PAGE] = "Off-page";
    const currentChapter = card.chapter && chapterIds.has(card.chapter) ? card.chapter : OFF_PAGE;
    this.select(this.field("Chapter"), chapters, currentChapter, (value) =>
      // A new chapter puts the card at its end.
      this.host.edit((s) =>
        moveCard(s, id, { chapter: value === OFF_PAGE ? null : value, plotLine: s.cards[id]!.plotLine }),
      ),
    );

    this.buildDates();
    this.buildPlace();

    const others = story.plotLines.filter((p) => p.id !== card.plotLine);
    if (others.length > 0) {
      const echoes = this.field("Also in", "Shows a title-only echo of the card in these plot lines.");
      for (const plotLine of others) {
        const label = echoes.createEl("label", { cls: "story-planner-panel-check" });
        const box = label.createEl("input");
        box.type = "checkbox";
        box.checked = card.alsoIn.includes(plotLine.id);
        box.addEventListener("change", () => this.host.edit((s) => setEcho(s, id, plotLine.id, box.checked)));
        label.createSpan({ text: plotLine.name });
      }
    }

    this.buildCharacters(this.field("Characters"));
    this.buildTagsAndState();
    this.buildNotes();

    const footer = el.createDiv({ cls: "story-planner-panel-footer" });
    const remove = footer.createEl("button", { cls: "mod-warning", text: "Delete card" });
    remove.addEventListener("click", () => {
      const name = card.title;
      this.host.edit((s) => deleteCard(s, id));
      this.host.deleted(name);
    });
  }

  /** The card's date and, for events that take time, its end date. */
  private buildDates(): void {
    const card = this.card!;
    const story = this.story!;
    const id = card.id;
    const fallback = effectiveZone(story, { ...card, date: card.date && { ...card.date, zone: undefined } });
    const defaultZone = fallback.zone ? `Zone: ${fallback.zone.name} (${ZONE_SOURCES[fallback.source]})` : "Zone: default";

    const when = this.field(card.chapter === null ? "When (off-page event)" : "When");
    new DateEditor(when, story, card.date, "date", defaultZone, (date) => {
      const hadDate = !!this.story!.cards[id]?.date;
      // Typing a date is one undo step, from the first digit of the year on.
      this.host.edit((s) => setCardDate(s, id, "date", date), date ? `date:${id}` : undefined);
      // A first date brings the end-date button, so the panel is rebuilt around the cursor.
      if (!hadDate && date && this.story) this.show(this.story, id);
    });
    if (!card.date) return;

    if (card.endDate) {
      const until = this.field("Until");
      new DateEditor(
        until,
        story,
        card.endDate,
        "end",
        defaultZone,
        (date) => this.host.edit((s) => setCardDate(s, id, "endDate", date), date ? `end:${id}` : undefined),
        (date) => {
          const start = this.story?.cards[id]?.date;
          return start && compareDates(this.story!, date, start) < 0 ? "The end is before the start." : null;
        },
      );
    } else {
      const add = when.createEl("button", { cls: "story-planner-date-add", text: "Add an end date" });
      add.addEventListener("click", () => this.host.edit((s) => setCardDate(s, id, "endDate", { ...s.cards[id]!.date! })));
    }
  }

  private buildPlace(): void {
    const card = this.card!;
    const story = this.story!;
    if (story.locations.length === 0) return;
    const options: Record<string, string> = { "": "No location" };
    for (const { location, depth } of locationTree(story)) options[location.id] = `${"\u2003".repeat(depth)}${location.name}`;
    const select = this.select(this.field("Where"), options, card.location ?? "", (value) =>
      this.host.edit((s) => setCardLocation(s, card.id, value || undefined)),
    );
    select.dataset.field = "location";
  }

  private buildTagsAndState(): void {
    const card = this.card!;
    const story = this.story!;
    const id = card.id;
    if (story.tagsEnabled && story.tags.length > 0) {
      const field = this.field("Story tags");
      const chips = field.createDiv({ cls: "story-planner-tag-chips" });
      for (const tag of story.tags) {
        const on = card.tags.includes(tag.id);
        const chip = chips.createEl("button", { cls: "story-planner-tag-chip", text: tag.name });
        chip.toggleClass("is-on", on);
        chip.style.setProperty("--tag-color", tag.color);
        chip.setAttr("aria-pressed", String(on));
        chip.addEventListener("click", () => this.host.edit((s) => setCardTag(s, id, tag.id, !on)));
      }
    }
    const relationship = relationshipOf(story, card);
    if (relationship) {
      const field = this.field("Relationship", `How things stand in "${relationship.name}" after this scene.`);
      const input = field.createEl("input");
      input.type = "text";
      input.placeholder = "e.g. allies, trust broken";
      input.value = card.relationshipState ?? "";
      input.dataset.field = "relationship";
      const listId = `story-planner-states-${id}`;
      input.setAttr("list", listId);
      const list = field.createEl("datalist");
      list.id = listId;
      const states = new Set(Object.values(story.cards).map((c) => c.relationshipState?.trim()).filter((x): x is string => !!x));
      for (const state of states) list.createEl("option").value = state;
      input.addEventListener("input", () => this.host.edit((s) => setRelationshipState(s, id, input.value), `relationship:${id}`));
    }
  }

  /** Notes linked to the card, such as a draft of the scene or research. */
  private buildNotes(): void {
    const card = this.card!;
    const id = card.id;
    const notes = this.host.notes;
    const field = this.field("Notes", card.notes.length === 0 ? "Link a draft, research or any other note. Linked notes open beside the board." : undefined);
    for (const path of card.notes) {
      const row = field.createDiv({ cls: "story-planner-panel-note" });
      const exists = notes.exists(path);
      const link = row.createEl("a", { cls: "story-planner-panel-note-link", text: noteName(path) });
      link.setAttr("title", exists ? `${path} (Ctrl+click opens it in a new tab)` : `${path} is missing. It may have been deleted or moved outside Obsidian.`);
      link.toggleClass("is-broken", !exists);
      link.addEventListener("click", (e) => {
        e.preventDefault();
        notes.open(path, e.ctrlKey || e.metaKey);
      });
      if (!exists) row.createSpan({ cls: "story-planner-panel-note-missing", text: "missing" });
      const remove = row.createEl("button", { cls: "clickable-icon", text: "×" });
      remove.setAttr("aria-label", `Unlink ${noteName(path)} (the note itself is kept)`);
      remove.addEventListener("click", () => this.host.edit((s) => removeCardNote(s, id, path)));
    }
    const actions = field.createDiv({ cls: "story-planner-panel-note-actions" });
    actions.createEl("button", { text: "Link a note" }).addEventListener("click", () =>
      notes.pick("Link a note to this card…", (path) => this.host.edit((s) => addCardNote(s, id, path))),
    );
    actions.createEl("button", { text: "Create note from card" }).addEventListener("click", () => notes.createFromCard(id));
  }

  private buildCharacters(section: HTMLElement): void {
    const card = this.card!;
    const story = this.story!;
    const id = card.id;
    const names = new Map(story.characters.map((c) => [c.id, c]));

    for (const entry of card.characters) {
      const character = names.get(entry.id);
      const row = section.createDiv({ cls: "story-planner-panel-character" });
      const top = row.createDiv({ cls: "story-planner-panel-character-top" });
      const name = top.createSpan({ cls: "story-planner-panel-character-name", text: character?.name ?? "Unknown" });
      name.style.setProperty("--character-color", character?.color ?? "var(--text-faint)");
      this.select(top, ROLE_LABELS, entry.role, (value) =>
        this.host.edit((s) => updateCardCharacter(s, id, entry.id, { role: value as CharacterRole })),
      );
      const remove = top.createEl("button", { cls: "clickable-icon", text: "×" });
      remove.setAttr("aria-label", `Remove ${character?.name ?? "character"}`);
      remove.addEventListener("click", () => this.host.edit((s) => removeCardCharacter(s, id, entry.id)));

      const note = row.createEl("input", { cls: "story-planner-panel-character-note" });
      note.type = "text";
      note.placeholder = "What they do in this scene";
      note.value = entry.note ?? "";
      note.dataset.field = `note:${entry.id}`;
      note.addEventListener("input", () =>
        this.host.edit((s) => updateCardCharacter(s, id, entry.id, { note: note.value }), `note:${id}:${entry.id}`),
      );
    }

    const add = section.createDiv({ cls: "story-planner-panel-add-character" });
    const input = add.createEl("input");
    input.type = "text";
    input.dataset.field = "add-character";
    input.placeholder = "Add a character";
    const listId = `story-planner-characters-${id}`;
    input.setAttr("list", listId);
    const list = add.createEl("datalist");
    list.id = listId;
    for (const c of story.characters) {
      if (!card.characters.some((e) => e.id === c.id)) list.createEl("option").value = c.name;
    }
    const submit = () => {
      const value = input.value;
      if (!value.trim()) return;
      // The panel rebuilds and puts the cursor back in this (now empty) field.
      this.host.edit((s) => addCharacterByName(s, id, value));
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
    add.createEl("button", { text: "Add" }).addEventListener("click", submit);
  }

  private field(label: string, hint?: string): HTMLElement {
    const field = this.el.createDiv({ cls: "story-planner-panel-field" });
    field.createDiv({ cls: "story-planner-panel-label", text: label });
    if (hint) field.createDiv({ cls: "story-planner-panel-hint", text: hint });
    return field;
  }

  private select(parent: HTMLElement, options: Record<string, string>, value: string, onChange: (value: string) => void) {
    const select = parent.createEl("select", { cls: "dropdown" });
    for (const [key, label] of Object.entries(options)) {
      const option = select.createEl("option", { text: label });
      option.value = key;
    }
    select.value = value;
    select.addEventListener("change", () => onChange(select.value));
    return select;
  }
}

const ZONE_SOURCES: Record<ZoneSource, string> = {
  card: "set on the card",
  location: "from the location",
  character: "from the point-of-view character",
  reference: "reference zone",
};

/** Dropdown value for the off-page group, which has no chapter id. */
const OFF_PAGE = "";

function isTextField(el: Element | null): boolean {
  return el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type === "text");
}
