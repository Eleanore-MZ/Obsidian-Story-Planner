import { setIcon } from "obsidian";
import { moveCard } from "../model/moves";
import {
  addCharacterByName,
  deleteCard,
  duringChapter,
  removeCardCharacter,
  setCardDate,
  setCardDuring,
  setCardLocation,
  setCardTag,
  setEcho,
  updateCard,
  updateCardCharacter,
} from "../model/edits";
import { compareDates, effectiveZone, ZoneSource } from "../model/calendar";
import { locationTree, plotLineColor } from "../model/setup";
import { chapterTitle } from "../model/chapters";
import { Card, CharacterRole, Id, Story } from "../model/types";
import {
  addCharacterToCards,
  common,
  deleteCards,
  moveCardsToChapter,
  moveCardsToPlotLine,
  selectedCards,
  setDateOnCards,
  setLocationOnCards,
  setTagOnCards,
  characterRoles,
  nextRole,
  setRoleOnCards,
  setWrittenOnCards,
  tagState,
} from "../model/groupEdits";
import { isUntitled } from "../model/defaults";
import { fold } from "../model/search";
import { DateEditor } from "./DateEditor";
import { addCardNote, noteName, removeCardNote } from "../model/links";

const ROLE_LABELS: Record<CharacterRole, string> = {
  pov: "POV",
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
  /** Called after several selected cards were deleted from the panel. */
  deletedMany?(count: number): void;
  /** True when the card opens as a page in the middle of the board rather than in the side panel. */
  centre?(): boolean;
  notes: NoteHost;
}

/**
 * The panel that edits the selected card, beside the board or as a page in
 * the middle of it. Like a page in Notion: the title, the scene tags and the
 * synopsis first, then the card's properties, one row each. Text fields save
 * as you type and are never rebuilt while you are in them, so the board can
 * redraw freely behind the panel without stealing focus.
 */
export class CardPanel {
  readonly el: HTMLElement;
  private cardId: Id | null = null;
  private story: Story | null = null;
  /** Whether "Also in" is unfolded; reset when another card is shown. */
  private echoesOpen = false;
  /** The character picker, kept open (with what was typed) while the panel redraws around it. */
  private picker: { query: string } | null = null;
  private closePicker: (() => void) | null = null;

  constructor(parent: HTMLElement, private host: CardPanelHost) {
    this.el = parent.createDiv({ cls: "story-planner-panel" });
    this.el.hidden = true;
  }

  get selected(): Id | null {
    return this.cardId;
  }

  /**
   * Shows the editor for several selected cards: what they share, and
   * changes that apply to all of them, each as one undo step.
   */
  showGroup(story: Story, ids: Id[]): void {
    this.story = story;
    this.cardId = null;
    const cards = selectedCards(story, ids);
    if (cards.length < 2) {
      this.el.hidden = true;
      this.el.empty();
      return;
    }
    const scroll = this.el.dataset.group === "true" ? this.el.scrollTop : 0;
    const active = document.activeElement;
    const focused = active instanceof HTMLElement && this.el.contains(active) ? active.dataset.field : undefined;
    this.el.hidden = false;
    this.el.dataset.group = "true";
    this.buildGroup(story, cards);
    this.el.scrollTop = scroll;
    if (focused) this.el.querySelector<HTMLElement>(`[data-field="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  }

  private buildGroup(story: Story, cards: Card[]): void {
    const el = this.el;
    const reopen = this.picker;
    this.closePicker?.();
    this.picker = reopen;
    el.empty();
    el.toggleClass("is-centre", !!this.host.centre?.());
    const ids = cards.map((c) => c.id);
    const edit = (change: (s: Story) => boolean) => this.host.edit((s) => change(s));

    const written = common(cards, (c) => c.written);
    this.header(`${cards.length} cards`, written === "mixed" ? "mixed" : written, () => edit((s) => setWrittenOnCards(s, ids, written !== true)), "Clear the selection");

    const list = el.createDiv({ cls: "story-planner-panel-group-list" });
    for (const card of cards) list.createDiv({ cls: "story-planner-panel-group-item", text: isUntitled(card.title) ? card.synopsis.split(/\r?\n/)[0] || "Untitled" : card.title });

    if (story.tags.length > 0) {
      const chips = el.createDiv({ cls: "story-planner-tag-chips story-planner-panel-tags" });
      for (const tag of story.tags) {
        const state = tagState(cards, tag.id);
        const chip = chips.createEl("button", { cls: "story-planner-tag-chip", text: tag.name });
        chip.toggleClass("is-on", state === "all");
        chip.toggleClass("is-partial", state === "some");
        chip.style.setProperty("--tag-color", tag.color);
        chip.setAttr("aria-pressed", state === "all" ? "true" : state === "some" ? "mixed" : "false");
        chip.setAttr("title", state === "all" ? "On every selected card. Click to take it off." : state === "some" ? "On some of them. Click to put it on all." : "Click to put it on all.");
        chip.addEventListener("click", () => edit((s) => setTagOnCards(s, ids, tag.id, state !== "all")));
      }
    }

    const props = el.createDiv({ cls: "story-planner-props" });
    const mixed = (options: Record<string, string>, value: string | "mixed") =>
      value === "mixed" ? { [MIXED]: "(mixed)", ...options } : options;
    const plotLine = common(cards, (c) => c.plotLine);
    this.select(this.prop(props, "Plot line", "git-branch"), mixed(Object.fromEntries(story.plotLines.map((p) => [p.id, p.name])), plotLine), plotLine === "mixed" ? MIXED : plotLine, (value) => {
      if (value !== MIXED) edit((s) => moveCardsToPlotLine(s, ids, value));
    });

    const chapterIds = new Set(story.chapters.map((c) => c.id));
    const chapters: Record<string, string> = Object.fromEntries(story.chapters.map((c) => [c.id, chapterTitle(story, c)]));
    chapters[OFF_PAGE] = "Off-page";
    const chapter = common(cards, (c) => (c.chapter && chapterIds.has(c.chapter) ? c.chapter : OFF_PAGE));
    this.select(this.prop(props, "Chapter", "book-open"), mixed(chapters, chapter), chapter === "mixed" ? MIXED : chapter, (value) => {
      if (value !== MIXED) edit((s) => moveCardsToChapter(s, ids, value === OFF_PAGE ? null : value));
    });

    const date = common(cards, (c) => c.date);
    const when = this.prop(props, "When", "calendar");
    if (date === "mixed") when.createDiv({ cls: "story-planner-date-hint", text: "Dates differ; a date set here goes on all of them." });
    new DateEditor(when, story, date === "mixed" ? undefined : date, "group-date", "Zone: default", (value) => {
      // An empty field never clears dates that differed.
      if (!value && date === "mixed") return;
      edit((s) => setDateOnCards(s, ids, value));
    });

    if (story.locations.length > 0) {
      const location = common(cards, (c) => c.location ?? "");
      const options: Record<string, string> = { "": "No location" };
      for (const { location: l, depth } of locationTree(story)) options[l.id] = `${" ".repeat(depth)}${l.name}`;
      this.select(this.prop(props, "Where", "map-pin"), mixed(options, location), location === "mixed" ? MIXED : location, (value) => {
        if (value !== MIXED) edit((s) => setLocationOnCards(s, ids, value || undefined));
      });
    }

    // Every character on any selected card shows as a chip with its role there ("mixed" when the
    // cards differ); clicking the role sets the next one on all of them. Picking one in the list puts
    // it on all the cards.
    const value = this.prop(props, "Characters", "users");
    const roles = characterRoles(story, cards);
    this.characterPicker(value, story, roles.map((r) => ({ id: r.id, role: r.role, partial: !r.onAll })), {
      cycle: (characterId, role) => edit((s) => setRoleOnCards(s, ids, characterId, nextRole(role))),
      toggle: (characterId, on) => {
        if (on) edit((s) => addCharacterToCards(s, ids, story.characters.find((c) => c.id === characterId)!.name));
        else edit((s) => cards.reduce((changed, card) => removeCardCharacter(s, card.id, characterId) || changed, false));
      },
      create: (name) => edit((s) => addCharacterToCards(s, ids, name)),
    });

    const footer = el.createDiv({ cls: "story-planner-panel-footer" });
    const remove = footer.createEl("button", { cls: "story-planner-delete", text: `Delete ${cards.length} cards` });
    remove.addEventListener("click", () => {
      edit((s) => deleteCards(s, ids));
      this.host.deletedMany?.(cards.length);
    });
    if (reopen) this.el.querySelector<HTMLElement>(".story-planner-multi")?.click();
  }

  /**
   * Shows a card, or hides the panel for null. A `soft` refresh, used while
   * typing in the panel, only updates the fields that are not being edited.
   */
  show(story: Story, cardId: Id | null, soft = false): void {
    this.story = story;
    if (!cardId || !story.cards[cardId]) {
      this.cardId = null;
      this.picker = null;
      this.closePicker?.();
      this.el.hidden = true;
      this.el.empty();
      delete this.el.dataset.group;
      return;
    }
    const sameCard = cardId === this.cardId;
    if (!sameCard) {
      this.echoesOpen = false;
      this.picker = null;
    }
    delete this.el.dataset.group;
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
      if (field === "title") el.value = isUntitled(card.title) ? "" : card.title;
      else if (field === "synopsis") el.value = card.synopsis;
      else if (field.startsWith("note:")) {
        el.value = card.characters.find((c) => `note:${c.id}` === field)?.note ?? "";
      }
    }
  }

  /** The top line: what is shown, whether it is written, and the close button. */
  private header(heading: string, written: boolean | "mixed", toggle: () => void, closeLabel: string): void {
    const story = this.story!;
    const header = this.el.createDiv({ cls: "story-planner-panel-header" });
    header.createDiv({ cls: "story-planner-panel-heading", text: heading });
    const card = this.card;
    header.style.setProperty("--lane-color", (card && plotLineColor(story, story.plotLines.find((p) => p.id === card.plotLine))) ?? "var(--interactive-accent)");
    const label = header.createEl("label", { cls: "story-planner-panel-written" });
    label.toggleClass("is-written", written === true);
    label.createSpan({ text: "Written" });
    const box = label.createEl("button", { cls: "story-planner-written" });
    box.dataset.field = "written";
    box.setAttr("role", "checkbox");
    box.setAttr("aria-checked", written === "mixed" ? "mixed" : String(written));
    box.toggleClass("is-mixed", written === "mixed");
    if (written === true) setIcon(box, "check");
    else if (written === "mixed") setIcon(box, "minus");
    box.addEventListener("click", (e) => {
      e.preventDefault();
      toggle();
    });
    const close = header.createEl("button", { cls: "story-planner-panel-close clickable-icon", text: "×" });
    close.setAttr("aria-label", closeLabel);
    close.addEventListener("click", () => this.host.close());
  }

  private build(): void {
    const card = this.card!;
    const story = this.story!;
    const id = card.id;
    const el = this.el;
    const reopen = this.picker;
    this.closePicker?.();
    this.picker = reopen;
    el.empty();
    el.toggleClass("is-centre", !!this.host.centre?.());

    this.header("Card", card.written, () => this.host.edit((s) => updateCard(s, id, { written: !s.cards[id]!.written })), "Close");

    // The text: the title as a heading, the scene tags under it, then the synopsis. All save as you type.
    const title = el.createEl("input", { cls: "story-planner-panel-title" });
    title.type = "text";
    title.value = isUntitled(card.title) ? "" : card.title;
    title.placeholder = "Untitled";
    title.dataset.field = "title";
    title.setAttr("aria-label", "Title");
    title.addEventListener("input", () =>
      this.host.edit((s) => updateCard(s, id, { title: title.value }), `title:${id}`),
    );
    title.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        (this.el.querySelector("textarea.story-planner-panel-synopsis") as HTMLTextAreaElement | null)?.focus();
      }
    });

    if (story.tags.length > 0) {
      const chips = el.createDiv({ cls: "story-planner-tag-chips story-planner-panel-tags" });
      for (const tag of story.tags) {
        const on = card.tags.includes(tag.id);
        const chip = chips.createEl("button", { cls: "story-planner-tag-chip", text: tag.name });
        chip.toggleClass("is-on", on);
        chip.style.setProperty("--tag-color", tag.color);
        chip.setAttr("aria-pressed", String(on));
        chip.addEventListener("click", () => this.host.edit((s) => setCardTag(s, id, tag.id, !on)));
      }
    }

    const synopsis = el.createEl("textarea", { cls: "story-planner-panel-synopsis" });
    synopsis.rows = 8;
    synopsis.value = card.synopsis;
    synopsis.placeholder = "What happens in this scene";
    synopsis.dataset.field = "synopsis";
    synopsis.setAttr("aria-label", "Synopsis");
    // At least eight lines, and taller as the text grows.
    const grow = () => {
      synopsis.style.height = "auto";
      synopsis.style.height = `${synopsis.scrollHeight + 2}px`;
    };
    synopsis.addEventListener("input", () => {
      grow();
      this.host.edit((s) => updateCard(s, id, { synopsis: synopsis.value }), `synopsis:${id}`);
    });
    window.requestAnimationFrame(grow);

    // The properties, one row each.
    const props = el.createDiv({ cls: "story-planner-props" });

    const plotLines = Object.fromEntries(story.plotLines.map((p) => [p.id, p.name]));
    const plotLineValue = this.prop(props, "Plot line", "git-branch");
    this.select(plotLineValue, plotLines, card.plotLine, (value) =>
      // Beside itself: same row, new plot line.
      this.host.edit((s) => moveCard(s, id, { chapter: s.cards[id]!.chapter, plotLine: value, besideCardId: id })),
    );
    this.buildEchoes(plotLineValue);

    const chapterIds = new Set(story.chapters.map((c) => c.id));
    const chapters: Record<string, string> = Object.fromEntries(story.chapters.map((c) => [c.id, chapterTitle(story, c)]));
    chapters[OFF_PAGE] = "Off-page";
    const currentChapter = card.chapter && chapterIds.has(card.chapter) ? card.chapter : OFF_PAGE;
    const chapterValue = this.prop(props, "Chapter", "book-open");
    this.select(chapterValue, chapters, currentChapter, (value) =>
      // A new chapter puts the card at its end.
      this.host.edit((s) =>
        moveCard(s, id, { chapter: value === OFF_PAGE ? null : value, plotLine: s.cards[id]!.plotLine }),
      ),
    );
    // An off-page event can happen during a chapter: in its background, untold.
    if (currentChapter === OFF_PAGE && story.chapters.length > 0) {
      const during: Record<string, string> = { "": "During no chapter" };
      for (const c of story.chapters) during[c.id] = `During ${chapterTitle(story, c)}`;
      const select = this.select(chapterValue, during, duringChapter(story, card) ?? "", (value) =>
        this.host.edit((s) => setCardDuring(s, id, value || undefined)),
      );
      select.addClass("story-planner-panel-during");
      select.dataset.field = "during";
    }

    this.buildDates(props);
    this.buildPlace(props);
    this.buildCharacters(props);
    this.buildNotes(props);

    const footer = el.createDiv({ cls: "story-planner-panel-footer" });
    const remove = footer.createEl("button", { cls: "story-planner-delete", text: "Delete card" });
    remove.addEventListener("click", () => {
      const name = card.title;
      this.host.edit((s) => deleteCard(s, id));
      this.host.deleted(name);
    });
    if (reopen) this.el.querySelector<HTMLElement>(".story-planner-multi")?.click();
  }

  /**
   * "Also in": the plot lines that show an echo of the card, folded away under
   * the plot line by default. It stays open while the panel shows this card.
   */
  private buildEchoes(parent: HTMLElement): void {
    const card = this.card!;
    const id = card.id;
    const others = this.story!.plotLines.filter((p) => p.id !== card.plotLine);
    if (others.length === 0) return;
    const details = parent.createEl("details", { cls: "story-planner-panel-echoes" });
    details.open = this.echoesOpen;
    details.addEventListener("toggle", () => (this.echoesOpen = details.open));
    const names = others.filter((p) => card.alsoIn.includes(p.id)).map((p) => p.name);
    details.createEl("summary", { text: names.length > 0 ? `Also in: ${names.join(", ")}` : "Also in other plot lines" });
    for (const plotLine of others) {
      const label = details.createEl("label", { cls: "story-planner-panel-check" });
      const box = label.createEl("input");
      box.type = "checkbox";
      box.checked = card.alsoIn.includes(plotLine.id);
      box.addEventListener("change", () => this.host.edit((s) => setEcho(s, id, plotLine.id, box.checked)));
      label.createSpan({ text: plotLine.name });
    }
  }

  /**
   * The card's date and, for events that take time, its end date. In the side
   * panel the end has its own row; on the page in the middle it follows the
   * start on the same line, after an arrow.
   */
  private buildDates(props: HTMLElement): void {
    const card = this.card!;
    const story = this.story!;
    const id = card.id;
    const fallback = effectiveZone(story, { ...card, date: card.date && { ...card.date, zone: undefined } });
    const defaultZone = fallback.zone ? `Zone: ${fallback.zone.name} (${ZONE_SOURCES[fallback.source]})` : "Zone: default";
    const centre = !!this.host.centre?.();

    const when = this.prop(props, card.chapter === null ? "When (off-page)" : "When", "calendar");
    const line = when.createDiv({ cls: "story-planner-date-range" });
    const start = line.createDiv({ cls: "story-planner-date-part-of-range" });
    new DateEditor(start, story, card.date, "date", defaultZone, (date) => {
      const hadDate = !!this.story!.cards[id]?.date;
      // Each saved date (Enter, or leaving the field) is one undo step.
      this.host.edit((s) => setCardDate(s, id, "date", date));
      // A first date brings the end-date button, so the panel is rebuilt around the cursor.
      if (!hadDate && date && this.story) this.show(this.story, id);
    });
    if (!card.date) return;

    if (card.endDate) {
      let end: HTMLElement;
      if (centre) {
        line.createSpan({ cls: "story-planner-date-arrow", text: "→" }).setAttr("aria-label", "until");
        end = line.createDiv({ cls: "story-planner-date-part-of-range" });
      } else {
        end = this.prop(props, "Until", "calendar-range");
      }
      new DateEditor(
        end,
        story,
        card.endDate,
        "end",
        defaultZone,
        (date) => this.host.edit((s) => setCardDate(s, id, "endDate", date)),
        (date) => {
          const startDate = this.story?.cards[id]?.date;
          return startDate && compareDates(this.story!, date, startDate) < 0 ? "The end is before the start." : null;
        },
        () => this.story?.cards[id]?.date,
      );
    } else {
      const add = when.createEl("button", { cls: "story-planner-date-add", text: "Add an end date" });
      add.addEventListener("click", () => this.host.edit((s) => setCardDate(s, id, "endDate", { ...s.cards[id]!.date! })));
    }
  }

  private buildPlace(props: HTMLElement): void {
    const card = this.card!;
    const story = this.story!;
    if (story.locations.length === 0) return;
    const options: Record<string, string> = { "": "No location" };
    for (const { location, depth } of locationTree(story)) options[location.id] = `${" ".repeat(depth)}${location.name}`;
    const select = this.select(this.prop(props, "Where", "map-pin"), options, card.location ?? "", (value) =>
      this.host.edit((s) => setCardLocation(s, card.id, value || undefined)),
    );
    select.dataset.field = "location";
  }

  /** Notes linked to the card, such as a draft of the scene or research. */
  private buildNotes(props: HTMLElement): void {
    const card = this.card!;
    const id = card.id;
    const notes = this.host.notes;
    const field = this.prop(props, "Notes", "file-text");
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

  /**
   * The card's characters as chips in one box, like a multi-select property
   * in Notion: clicking the box opens a list to pick from, with a field that
   * filters it and makes a new character on Enter. Each chip shows the
   * character's role; clicking it moves on to the next role. New characters
   * are present.
   */
  private buildCharacters(props: HTMLElement): void {
    const card = this.card!;
    const story = this.story!;
    const id = card.id;
    const value = this.prop(props, "Characters", "users");
    this.characterPicker(value, story, card.characters.map((c) => ({ id: c.id, role: c.role, partial: false })), {
      cycle: (characterId, role) => this.host.edit((s) => updateCardCharacter(s, id, characterId, { role: nextRole(role) })),
      note: {
        get: (characterId) => card.characters.find((c) => c.id === characterId)?.note ?? "",
        set: (characterId, note) => this.host.edit((s) => updateCardCharacter(s, id, characterId, { note }), `note:${id}:${characterId}`),
      },
      toggle: (characterId, on) => {
        if (on) this.host.edit((s) => addCharacterByName(s, id, story.characters.find((c) => c.id === characterId)!.name));
        else this.host.edit((s) => removeCardCharacter(s, id, characterId));
      },
      create: (name) => this.host.edit((s) => addCharacterByName(s, id, name)),
    });
  }

  /** The chip box and its drop-down list, shared by one card and by several selected cards. */
  private characterPicker(
    parent: HTMLElement,
    story: Story,
    entries: { id: Id; role: CharacterRole | "mixed"; partial: boolean }[],
    on: {
      /** The role was clicked: move on to the next one. */
      cycle: (characterId: Id, role: CharacterRole | "mixed") => void;
      /** What each character does in the scene, for a single card. */
      note?: { get: (characterId: Id) => string; set: (characterId: Id, note: string) => void };
      toggle: (characterId: Id, on: boolean) => void;
      create: (name: string) => void;
    },
  ): void {
    // In the list, ticked means on the card (on every selected card).
    const chosen = new Set(entries.filter((e) => !e.partial).map((e) => e.id));
    // One row per character: the name, what they do here (on the page in the
    // middle, beside the name; in the side panel, on a line below), the role at the right.
    const box = parent.createDiv({ cls: "story-planner-multi is-rows" });
    box.tabIndex = 0;
    box.setAttr("role", "combobox");
    box.setAttr("aria-label", "Characters");
    const chosenList = entries
      .map((e) => ({ entry: e, character: story.characters.find((c) => c.id === e.id) }))
      .filter((x): x is { entry: (typeof entries)[number]; character: NonNullable<typeof x.character> } => !!x.character);
    for (const { entry, character } of chosenList) {
      const chip = box.createSpan({ cls: `story-planner-multi-chip story-planner-role-chip role-${entry.role}` });
      chip.toggleClass("is-partial", entry.partial);
      chip.style.setProperty("--chip-color", character.color);
      chip.createSpan({ cls: "story-planner-multi-chip-name", text: character.name });
      if (entry.partial) chip.setAttr("title", "On some of the selected cards");
      if (on.note) {
        const note = chip.createEl("input", { cls: "story-planner-multi-chip-note" });
        note.type = "text";
        note.placeholder = "What they do here";
        note.value = on.note.get(character.id);
        note.dataset.field = `note:${character.id}`;
        note.addEventListener("click", (e) => e.stopPropagation());
        note.addEventListener("keydown", (e) => e.stopPropagation());
        note.addEventListener("input", () => on.note!.set(character.id, note.value));
      }
      const role = chip.createEl("button", { cls: "story-planner-role-cycle", text: entry.role === "mixed" ? "Mixed" : ROLE_LABELS[entry.role] });
      role.setAttr("aria-label", `Role: ${entry.role === "mixed" ? "mixed" : ROLE_LABELS[entry.role]}. Click for the next one.`);
      role.addEventListener("click", (e) => {
        e.stopPropagation();
        on.cycle(character.id, entry.role);
      });
      const x = chip.createSpan({ cls: "story-planner-multi-chip-remove", text: "×" });
      x.setAttr("aria-label", `Remove ${character.name}`);
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        on.toggle(character.id, false);
      });
    }
    if (chosenList.length === 0) box.createSpan({ cls: "story-planner-multi-empty", text: "Empty" });

    const open = () => {
      if (box.hasClass("is-open")) return;
      box.addClass("is-open");
      this.picker = this.picker ?? { query: "" };
      const pop = parent.createDiv({ cls: "story-planner-multi-pop" });
      const input = pop.createEl("input", { cls: "story-planner-multi-search" });
      input.type = "text";
      input.placeholder = "Search, or type a new name";
      input.value = this.picker.query;
      input.dataset.field = "character-search";
      const list = pop.createDiv({ cls: "story-planner-multi-list" });
      let active = 0;
      const items = () => {
        const q = fold(input.value.trim());
        return story.characters.filter((c) => !q || fold(c.name).includes(q));
      };
      const draw = () => {
        list.empty();
        const shown = items();
        const exact = story.characters.some((c) => fold(c.name) === fold(input.value.trim()));
        shown.forEach((c, i) => {
          const row = list.createDiv({ cls: "story-planner-multi-option" });
          row.toggleClass("is-active", i === active);
          row.toggleClass("is-chosen", chosen.has(c.id));
          const chip = row.createSpan({ cls: "story-planner-multi-chip", text: c.name });
          chip.style.setProperty("--chip-color", c.color);
          if (chosen.has(c.id)) setIcon(row.createSpan({ cls: "story-planner-multi-check" }), "check");
          row.addEventListener("mousedown", (e) => e.preventDefault());
          row.addEventListener("click", () => on.toggle(c.id, !chosen.has(c.id)));
        });
        if (input.value.trim() && !exact) {
          const row = list.createDiv({ cls: "story-planner-multi-option is-create" });
          row.toggleClass("is-active", active === shown.length);
          row.createSpan({ text: "Create " });
          row.createSpan({ cls: "story-planner-multi-chip", text: input.value.trim() });
          row.addEventListener("mousedown", (e) => e.preventDefault());
          row.addEventListener("click", () => on.create(input.value.trim()));
        }
      };
      input.addEventListener("input", () => {
        this.picker = { query: input.value };
        active = 0;
        draw();
      });
      input.addEventListener("keydown", (e) => {
        const shown = items();
        const count = shown.length + (input.value.trim() && !story.characters.some((c) => fold(c.name) === fold(input.value.trim())) ? 1 : 0);
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          active = count === 0 ? 0 : (active + (e.key === "ArrowDown" ? 1 : -1) + count) % count;
          draw();
        } else if (e.key === "Enter") {
          e.preventDefault();
          const c = shown[active];
          if (c) on.toggle(c.id, !chosen.has(c.id));
          else if (input.value.trim()) on.create(input.value.trim());
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close();
          box.focus();
        } else if (e.key === "Backspace" && !input.value && chosenList.length > 0) {
          on.toggle(chosenList[chosenList.length - 1]!.character.id, false);
        }
      });
      const outside = (e: PointerEvent) => {
        if (!pop.contains(e.target as Node) && !box.contains(e.target as Node)) close();
      };
      const close = () => {
        pop.remove();
        box.removeClass("is-open");
        document.removeEventListener("pointerdown", outside, true);
        this.picker = null;
        if (this.closePicker === close) this.closePicker = null;
      };
      // A redraw of the panel drops the list without forgetting it was open.
      this.closePicker = () => {
        pop.remove();
        document.removeEventListener("pointerdown", outside, true);
      };
      document.addEventListener("pointerdown", outside, true);
      draw();
      input.focus();
    };
    box.addEventListener("click", open);
    box.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        open();
      }
    });
  }

  /** A property row: a small icon and label on the left, the value on the right. Returns the value's cell. */
  private prop(parent: HTMLElement, label: string, icon: string): HTMLElement {
    const row = parent.createDiv({ cls: "story-planner-prop" });
    const name = row.createDiv({ cls: "story-planner-prop-label" });
    setIcon(name.createSpan({ cls: "story-planner-prop-icon" }), icon);
    name.createSpan({ text: label });
    return row.createDiv({ cls: "story-planner-prop-value" });
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

/** Dropdown value shown when the selected cards differ. */
const MIXED = "\u0000mixed";

function isTextField(el: Element | null): boolean {
  return el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type === "text");
}
