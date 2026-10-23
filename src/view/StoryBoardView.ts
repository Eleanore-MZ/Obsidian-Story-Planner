import { MarkdownRenderer, Menu, Notice, Scope, setIcon, TextFileView, TFile, WorkspaceLeaf } from "obsidian";
import type StoryPlannerPlugin from "../main";
import { orderedTabs, type StoryTab } from "../settings";
import { cardShows, type CardShow } from "../model/cardShows";
import { addCardAt, addCharacterByName, deleteCard, duringChapter, echoByDrop, setCardDate, setCardDuring, updateCard } from "../model/edits";
import { History } from "../model/history";
import { CardTarget, chapterCards, moveCard, moveInList } from "../model/moves";
import { SnapshotInfo } from "../model/snapshots";
import { cardMoment, compareDates, dateInZone, mainCalendar, effectiveZone, formatDateRange, formatStoryDate, precisionOf, stackedDateParts } from "../model/calendar";
import { Clash, dropWithinSpan, findClashes, placeLastInTime, reorderInTime, referenceDate, timeSorted } from "../model/storyTime";
import { Card, Character, CharacterRole, Id, Organization, OrgRole, Story, StoryDate, StoryEvent } from "../model/types";
import { isUntitled } from "../model/defaults";
import { outlineWasEdited, parseStory, safeMarkdown, serializeStory } from "../format/storyFile";
import { ContentsEntry, outlineContents } from "../format/outline";
import { createEvent, NewEventPlace } from "../model/eventCreation";
import { addChapter, addPlotLine, locationAndInside, locationPath, locationTree, plotLineColor } from "../model/setup";
import { addCardNote, linkedPaths, renameLinkedPath } from "../model/links";
import { cardMatches, cardsInReadingOrder, queryTerms, searchCards } from "../model/search";
import { deleteCards, moveCardsTo, setEventOnCards } from "../model/groupEdits";
import { addEvent, emptyEvents, eventCards, eventColor, eventPath, eventTree, setCardEvent, setEventPlotLine, toggleExpanded } from "../model/events";
import { orgDescendants, orgTree, setCardOrg } from "../model/entities";
import { CardPanel, NoteHost } from "./CardPanel";
import { Minimap } from "./Minimap";
import { guardComposition } from "./composition";
import { STORY_ICON } from "../icon";
import { SetupPanel } from "./SetupPanel";
import { ProfilesView } from "./ProfilesView";
import { OutlineView } from "./OutlineView";
import { BoardItem, computeBoardLayout, Orientation } from "./layout";
import { ChoiceModal, DateModal, FormField, FormModal, LaneModal, TextPromptModal } from "./modals";
import {
  actHeading,
  actsShown,
  actTitle,
  chapterHeading,
  chapterNumbers,
  chaptersInAct,
  chapterTitle,
  deleteAct,
  orderedActs,
  setChapterAct,
  startActAt,
} from "../model/chapters";
import { blockLabel, Bucket, bucketDate, computeTimeLayout, MAX_EXPANDED_ROWS, TimeItem, timeBlock, Zoom, ZOOM_LABELS, zoomSteps } from "./timeLayout";
import { computeMatrix, computeTrackLayout, TrackAxis, TrackItem } from "./trackLayout";

export const STORY_BOARD_VIEW = "story-planner-board";

/** What is being dragged. */
type Dragged = { kind: "card" | "plotLine" | "chapter" | "character" | "event"; id: string };

/** Where a drop lands relative to its target. */
type DropPlace = "before" | "after" | "on";

interface DropTargetSpec {
  accepts: Dragged["kind"];
  /** The plot line a card target is in, so a card dropped there with the echo key held becomes an echo. */
  plotLine?: Id;
  axis: "slot" | "lane" | null;
  /** With an axis, the middle half of the target means "on" rather than before or after. */
  middle: boolean;
  onDrop: (place: DropPlace) => void;
  /** The same element taking another kind of thing. */
  also?: DropTargetSpec;
  /** On the main board: where a drop here puts cards, for dropping several selected cards at once. */
  board?: (place: DropPlace) => { target: CardTarget; background?: boolean };
}

/** The view tabs: label and Lucide icon name. Their order is the writer's, set by dragging. */
const TABS: Record<StoryTab, [string, string]> = {
  board: ["Main", "columns-3"],
  time: ["Story time", "calendar-clock"],
  characters: ["Characters", "users"],
  organizations: ["Organizations", "landmark"],
  outline: ["Outline", "scroll-text"],
  setup: ["Setup", "settings-2"],
};

/** Board elements that count as empty space: clicking them clears the selection. */
const EMPTY_SPACE =
  ".story-planner-grid, .story-planner-corner, .story-planner-folded-cell, .story-planner-cell, .story-planner-chapter-end, .story-planner-tray, .story-planner-time-empty, .story-planner-matrix-wrap, .story-planner-track-note";

const ROLE_LABELS: Record<CharacterRole, string> = { pov: "Point of view", present: "Present", mentioned: "Mentioned" };

/** Pixels the pointer must move before a press becomes a drag. */
const DRAG_THRESHOLD = 5;

/** Lanes are plot lines (main board, story time) or characters (character track). */
type LaneKind = "plotLine" | "character";

/** How close to the board's edge a dragged card starts scrolling it, and the fastest it scrolls (pixels per frame). */
const EDGE_ZONE = 56;
const EDGE_SPEED = 24;

/** How wide a folded lane is, and the narrowest a lane can be dragged. */
const FOLDED_LANE = "34px";
const MIN_LANE_WIDTH = 120;

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
  /** Which lanes each drawn grid has, for resizing a lane while it is dragged. */
  /** Lanes can have several tracks, where a long card runs beside others in story time. */
  private gridLanes = new WeakMap<HTMLElement, { kind: LaneKind; ids: string[]; tracks: number[]; lead: number }>();
  /** The zoom at which the whole timeline was last found too long to show, so that is said only once. */
  private tooLongNoticed: string | null = null;
  /** The cards being dragged together, while several selected cards are. */
  private draggedMany: Id[] | null = null;
  /** Set while a drag has Ctrl+Alt held: an off-page event dropped in a chapter stays off-page, during it. */
  private backgroundDrop = false;
  /** The spans the story's start and end fall in, as story time last drew them. */
  private storySpan: { start?: string; end?: string } = {};
  /** The Outline tab: the story as a page, written in place. */
  private outline = new OutlineView({
    edit: (change, coalesce) => this.mutate(change, coalesce),
    reveal: (id) => this.revealCard(id),
    choose: (choice) => new ChoiceModal(this.app, choice).open(),
    notice: (message) => new Notice(message),
    folded: () => new Set(this.viewState()?.foldedOutline ?? []),
    toggleFold: (key) => {
      const set = new Set(this.viewState()?.foldedOutline ?? []);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      this.setViewState({ foldedOutline: [...set] });
    },
    dimmed: (card) => !!this.story && this.highlighted(card, this.story) === false,
    axis: () => this.viewState()?.outlineAxis ?? "chapters",
    // Made safe the same way as in the exported outline, so it reads the same and nothing in it is a tag or link.
    renderMarkdown: (text, el) => void MarkdownRenderer.render(this.app, safeMarkdown(text), el, this.file?.path ?? "", this),
  });
  /** Character and organization profiles, in the Characters view. */
  private profiles = new ProfilesView({
    edit: (change, coalesce) => this.mutate(change, coalesce),
    openCard: (id) => this.revealCard(id),
    shown: (kind) => ({ id: kind === "organization" ? this.viewState()?.orgProfileId : this.viewState()?.profileId }),
    // A profile of the other kind (an organization from a character's, say) opens in its own tab.
    show: (kind, id) =>
      this.setViewState(
        kind === "organization"
          ? { orgProfileId: id, orgMode: "profiles", tab: "organizations" }
          : { profileId: id, characterMode: "profiles", tab: "characters" },
      ),
    notes: this.noteHost(),
  });
  /** When Ctrl+wheel last zoomed, so one notch is one step. */
  private lastWheel = 0;
  /** Cards selected together with Ctrl+click or Shift+click; two or more open the group editor. */
  private multi = new Set<Id>();
  /** The card a Shift+click selects from. */
  private anchor: Id | null = null;

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
    // Delete removes the selected card, the same undoable way as the panel's button,
    // but never while typing or with a dialog open.
    this.scope.register([], "Delete", () => {
      if ((!this.panel.selected && this.multi.size < 2) || this.tab === "setup" || isTyping() || document.querySelector(".modal-container")) return true;
      if (this.multi.size >= 2) {
        const ids = [...this.multi];
        this.mutate((s) => deleteCards(s, ids));
        this.cardsDeleted(ids.length);
      } else this.deleteCard(this.panel.selected!);
      return false;
    });
    this.scope.register([], "Escape", () => {
      if (!this.panel.selected && !this.panel.selectedEvent && this.multi.size === 0) return true;
      this.select(null);
      return false;
    });

    this.contentEl.addClass("story-planner");
    // Fields on the board, in the card panel and in setup work with input methods.
    guardComposition(this.contentEl);
    this.headerEl = this.contentEl.createDiv({ cls: "story-planner-header" });
    this.bodyEl = this.contentEl.createDiv({ cls: "story-planner-body" });
    this.boardEl = this.bodyEl.createDiv({ cls: "story-planner-board" });
    // A single click on empty board space closes the side panel. (A double
    // click on an empty cell then goes on to create a card there.)
    this.boardEl.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target === this.boardEl || target.matches(EMPTY_SPACE)) this.select(null);
    });
    this.boardEl.addEventListener("wheel", (e) => this.wheelZoom(e), { passive: false });
    this.boardEl.addEventListener("pointerdown", (e) => this.startMarquee(e));
    this.minimap = new Minimap(this.bodyEl, this.boardEl);
    this.panel = new CardPanel(this.bodyEl, {
      edit: (change, coalesce) => this.mutate(change, coalesce),
      close: () => this.select(null),
      deleted: (title) => this.cardDeleted(title),
      deletedMany: (count) => this.cardsDeleted(count),
      centre: () => this.plugin.settings.cardOpening === "centre",
      openEvent: (id) => this.selectEvent(id),
      expanded: (id) => (this.viewState()?.expandedEvents ?? []).includes(id),
      setExpanded: (id, on) => {
        const set = new Set(this.viewState()?.expandedEvents ?? []);
        if (on) set.add(id);
        else set.delete(id);
        this.setViewState({ expandedEvents: [...set] });
      },
      openCard: (id) => this.revealCard(id),
      notes: this.noteHost(),
    });
    // Behind a card opened in the middle: dims the board, and a click on it closes the card.
    const backdrop = this.bodyEl.createDiv({ cls: "story-planner-peek-backdrop" });
    backdrop.addEventListener("click", () => this.select(null));
    this.setup = new SetupPanel(this.contentEl, {
      edit: (change, coalesce) => this.mutate(change, coalesce),
      choose: (choice) => new ChoiceModal(this.app, choice).open(),
      notice: (message) => new Notice(message),
      snapshot: (reason) => this.takeSnapshot(reason),
      listSnapshots: () => this.listSnapshots(),
      restore: (snapshot) => void this.restoreSnapshot(snapshot),
      notes: this.noteHost(),
      editChapter: (id) => this.editChapter(id),
      editAct: (id) => this.editAct(id),
      section: () => this.viewState()?.setupSection,
      cardShowDefaults: () => this.plugin.settings.cardShows,
      setSection: (section) => this.setViewState({ setupSection: section }),
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
    return STORY_ICON;
  }

  onResize(): void {
    this.fitToolbar();
    if (this.tab === "time") this.fitTimeLabels();
  }

  /**
   * Keeps the tab bar inside the pane: when it does not fit, the tabs shrink
   * to their icons; if it still does not fit, the buttons wrap onto a second
   * line (and onto more, in a very narrow pane).
   */
  private fitToolbar(): void {
    const row = this.headerEl.querySelector<HTMLElement>(":scope > .story-planner-tabs-row");
    if (!row) return;
    for (const select of Array.from(row.querySelectorAll<HTMLSelectElement>("select"))) fitSelect(select);
    row.removeClass("is-icon-tabs", "is-wrapped");
    const fits = () => row.scrollWidth <= row.clientWidth + 1;
    if (fits()) return;
    row.addClass("is-icon-tabs");
    if (fits()) return;
    row.addClass("is-wrapped");
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

  private deleteCard(cardId: Id): void {
    const title = this.story?.cards[cardId]?.title;
    if (title === undefined) return;
    this.mutate((s) => deleteCard(s, cardId));
    this.cardDeleted(title);
  }

  private cardDeleted(title: string): void {
    this.select(null);
    new Notice(`Deleted "${title}". Press Ctrl+Z to undo.`);
  }

  private cardsDeleted(count: number): void {
    this.select(null);
    new Notice(`Deleted ${count} cards. Press Ctrl+Z to undo.`);
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

  /** Selects a card and shows it in the side panel; null closes the panel. Either way it ends a selection of several. */
  private select(cardId: Id | null): void {
    if (!this.story) return;
    this.multi.clear();
    this.anchor = cardId;
    this.panel.show(this.story, cardId);
    this.markSelection();
  }

  /**
   * Goes to a line of the story's contents. On Main, a chapter scrolls the
   * board to it and an event with scenes opens its page there; anything else
   * opens the Outline tab, with the sections around it unfolded, scrolled to it.
   */
  goTo(entry: ContentsEntry): void {
    const story = this.story;
    if (!story) return;
    if (this.tab === "board" && entry.chapterId) {
      const header = this.boardEl.querySelector<HTMLElement>(`.story-planner-chapter-header[data-chapter-id="${CSS.escape(entry.chapterId)}"]`);
      if (header) {
        header.scrollIntoView({ block: "start", inline: "start", behavior: "smooth" });
        return;
      }
    }
    if (this.tab === "board" && entry.eventId) {
      const first = eventCards(story, entry.eventId, true)[0];
      if (first) {
        this.selectEvent(entry.eventId);
        const el = this.boardEl.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(entry.eventId)}"]`) ?? this.boardEl.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(first.id)}"]`);
        el?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
        return;
      }
    }
    const folded = (this.viewState()?.foldedOutline ?? []).filter((key) => !entry.unfold.includes(key) && key !== entry.anchor);
    const byChapter = /^(act|chapter|event):/.test(entry.anchor);
    this.setViewState({ tab: "outline", foldedOutline: folded, ...(byChapter ? { outlineAxis: "chapters" as const } : {}) });
    window.requestAnimationFrame(() => {
      const el = this.boardEl.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(entry.anchor)}"]`);
      el?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }

  /** Goes to a heading of the story note, such as Obsidian's Outline lists: the contents line with that name. */
  goToHeading(heading: string): void {
    if (!this.story) return;
    const plain = (text: string) => text.replace(/\\/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
    const wanted = plain(heading);
    // The note's own title and its "About the story" are the Story part.
    const story = wanted === "about the story" || wanted === plain(this.story.title) ? "story" : wanted;
    const entry = outlineContents(this.story).find((e) => plain(e.label) === story || (story === "story" && e.anchor === "story"));
    if (entry) this.goTo(entry);
  }

  /** Opens an event's page in the panel; no card stays selected. */
  private selectEvent(eventId: Id): void {
    if (!this.story) return;
    this.multi.clear();
    this.panel.showEvent(this.story, eventId);
    this.markSelection();
  }

  /**
   * A click on a card: on its own it selects the card; with Ctrl (Cmd on a
   * Mac) it adds the card to the selection or takes it out.
   */
  private clickCard(e: MouseEvent, cardId: Id): void {
    if (!this.story) return;
    if (e.ctrlKey || e.metaKey) {
      if (this.multi.size === 0 && this.panel.selected) this.multi.add(this.panel.selected);
      if (this.multi.has(cardId)) this.multi.delete(cardId);
      else this.multi.add(cardId);
      this.anchor = cardId;
      this.showSelection();
    } else {
      this.select(cardId);
    }
  }

  /**
   * Dragging over empty board space draws a rectangle and selects every card
   * it touches, as in a file explorer; with Ctrl (Cmd) held it adds them to
   * the cards already selected. Near the board's edges it scrolls the board.
   */
  private startMarquee(down: PointerEvent): void {
    const target = down.target as HTMLElement;
    if (down.button !== 0 || !this.story || this.tab === "setup") return;
    if (!(target === this.boardEl || target.matches(EMPTY_SPACE)) || target.closest("[data-card-id], button, input, select, textarea")) return;
    const board = this.boardEl;
    const base = new Set(down.ctrlKey || down.metaKey ? (this.multi.size > 0 ? this.multi : this.panel.selected ? [this.panel.selected] : []) : []);
    // Positions on the board's own content, so they hold while it scrolls.
    const at = (x: number, y: number) => {
      const r = board.getBoundingClientRect();
      return { x: x - r.left + board.scrollLeft, y: y - r.top + board.scrollTop };
    };
    const start = at(down.clientX, down.clientY);
    let pointer = { x: down.clientX, y: down.clientY };
    let box: HTMLElement | null = null;
    let hits = new Set<Id>();
    let frame = 0;

    const update = () => {
      const now = at(pointer.x, pointer.y);
      const left = Math.min(start.x, now.x);
      const top = Math.min(start.y, now.y);
      const right = Math.max(start.x, now.x);
      const bottom = Math.max(start.y, now.y);
      if (!box) {
        if (right - left < DRAG_THRESHOLD && bottom - top < DRAG_THRESHOLD) return;
        box = board.createDiv({ cls: "story-planner-marquee" });
        document.body.addClass("story-planner-marquee-active");
      }
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
      box.style.width = `${right - left}px`;
      box.style.height = `${bottom - top}px`;
      const r = board.getBoundingClientRect();
      hits = new Set();
      for (const el of Array.from(board.querySelectorAll<HTMLElement>("[data-card-id]"))) {
        const c = el.getBoundingClientRect();
        const cl = c.left - r.left + board.scrollLeft;
        const ct = c.top - r.top + board.scrollTop;
        if (cl < right && cl + c.width > left && ct < bottom && ct + c.height > top) hits.add(el.dataset.cardId!);
      }
      const shown = new Set([...base, ...hits]);
      for (const el of Array.from(board.querySelectorAll<HTMLElement>("[data-card-id]"))) el.classList.toggle("is-selected", shown.has(el.dataset.cardId!));
    };
    // Scrolls while the pointer is near an edge, and keeps the rectangle growing with it.
    const scroll = () => {
      frame = 0;
      if (!box) return;
      const r = board.getBoundingClientRect();
      const dx = pointer.x < r.left + EDGE_ZONE ? -1 : pointer.x > r.right - EDGE_ZONE ? 1 : 0;
      const dy = pointer.y < r.top + EDGE_ZONE ? -1 : pointer.y > r.bottom - EDGE_ZONE ? 1 : 0;
      if (dx || dy) {
        board.scrollLeft += dx * EDGE_SPEED / 2;
        board.scrollTop += dy * EDGE_SPEED / 2;
        update();
        frame = window.requestAnimationFrame(scroll);
      }
    };
    const move = (e: PointerEvent) => {
      pointer = { x: e.clientX, y: e.clientY };
      update();
      if (box && !frame) frame = window.requestAnimationFrame(scroll);
    };
    const up = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      if (frame) window.cancelAnimationFrame(frame);
      if (!box) return;
      box.remove();
      document.body.removeClass("story-planner-marquee-active");
      // The click that ends the drag must not clear what was just selected.
      this.suppressClick = true;
      window.setTimeout(() => (this.suppressClick = false), 0);
      this.multi = new Set([...base, ...hits]);
      this.showSelection();
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
  }

  /** Shows what is selected: the group editor for several cards, the card for one, nothing for none. */
  private showSelection(): void {
    if (!this.story) return;
    for (const id of [...this.multi]) if (!this.story.cards[id]) this.multi.delete(id);
    if (this.multi.size >= 2) {
      this.panel.showGroup(this.story, [...this.multi]);
      this.markSelection();
      return;
    }
    const only = [...this.multi][0] ?? null;
    this.select(only);
  }

  private markSelection(): void {
    for (const el of Array.from(this.boardEl.querySelectorAll<HTMLElement>("[data-card-id]"))) {
      const id = el.dataset.cardId!;
      el.classList.toggle("is-selected", this.multi.size >= 2 ? this.multi.has(id) : id === this.panel.selected);
    }
    this.minimap.refresh();
  }

  // -------------------------------------------------------------------------
  // Chapters and acts

  /** Edits a chapter's title, number label, act and synopsis; null makes a new chapter. */
  private editChapter(chapterId: Id | null): void {
    const story = this.story;
    if (!story) return;
    const chapter = chapterId ? story.chapters.find((c) => c.id === chapterId) : undefined;
    if (chapterId && !chapter) return;
    const numbers = chapterNumbers(story);
    const auto = chapter ? (numbers.get(chapter.id) ? `Chapter ${numbers.get(chapter.id)}` : "Chapter") : `Chapter ${numbers.size + 1}`;
    const fields: FormField[] = [
      { key: "name", label: "Title", kind: "text", value: chapter?.name ?? "", placeholder: "No title" },
      {
        key: "label",
        label: "Instead of a number",
        kind: "text",
        value: chapter?.label ?? "",
        placeholder: auto,
        description: "Such as Prologue or Interlude. Leave empty to number the chapter; labelled chapters do not take a number.",
      },
    ];
    if (actsShown(story)) {
      fields.push({
        key: "act",
        label: "Act",
        kind: "select",
        value: chapter?.act ?? (story.chapters[story.chapters.length - 1]?.act ?? ""),
        options: [["", "No act"], ...orderedActs(story).map((a): [string, string] => [a.id, actTitle(story, a)])],
      });
    }
    fields.push({ key: "summary", label: "Synopsis", kind: "textarea", value: chapter?.summary ?? "", placeholder: "What happens in this chapter" });
    new FormModal(this.app, chapter ? `Edit ${chapterTitle(story, chapter)}` : "New chapter", fields, (values) =>
      this.mutate((s) => {
        const id = chapter ? chapter.id : addChapter(s, values.name!.trim());
        const target = s.chapters.find((c) => c.id === id)!;
        target.name = values.name!.trim();
        const label = values.label?.trim();
        if (label) target.label = label;
        else delete target.label;
        const summary = values.summary?.trim();
        if (summary) target.summary = summary;
        else delete target.summary;
        if (values.act !== undefined) setChapterAct(s, id, values.act || undefined);
      }),
    ).open();
  }

  private editAct(actId: Id): void {
    const story = this.story;
    const act = story?.acts.find((a) => a.id === actId);
    if (!story || !act) return;
    new FormModal(
      this.app,
      `Edit ${actHeading(story, act)}`,
      [
        { key: "title", label: "Title", kind: "text", value: act.title ?? "", placeholder: "No title" },
        { key: "summary", label: "Synopsis", kind: "textarea", value: act.summary ?? "", placeholder: "What happens in this act" },
      ],
      (values) =>
        this.mutate((s) => {
          const target = s.acts.find((a) => a.id === actId)!;
          const title = values.title?.trim();
          if (title) target.title = title;
          else delete target.title;
          const summary = values.summary?.trim();
          if (summary) target.summary = summary;
          else delete target.summary;
        }),
    ).open();
  }

  /** Right-click on a chapter: edit it, start an act there, or take it out of its act. */
  private chapterMenu(e: MouseEvent, chapterId: Id): void {
    const story = this.story;
    const chapter = story?.chapters.find((c) => c.id === chapterId);
    if (!story || !chapter) return;
    e.preventDefault();
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("Edit chapter…").setIcon("pencil").onClick(() => this.editChapter(chapterId)));
    if (story.actsEnabled !== false) menu.addItem((i) =>
      i
        .setTitle("Start a new act here")
        .setIcon("milestone")
        .onClick(() => {
          let id: Id | null = null;
          this.mutate((s) => {
            id = startActAt(s, chapterId);
            return id !== null;
          });
          if (id) this.editAct(id);
        }),
    );
    if (chapter.act && actsShown(story)) {
      menu.addItem((i) => i.setTitle("Take out of its act").setIcon("log-out").onClick(() => this.mutate((s) => setChapterAct(s, chapterId, undefined))));
    }
    menu.showAtMouseEvent(e);
  }

  // -------------------------------------------------------------------------
  // Switching stories and arranging tabs

  /** Lists the vault's stories under the title; picking one opens it in this view. */
  private storyMenu(e: MouseEvent): void {
    const menu = new Menu();
    const stories = this.plugin.storyFiles().sort((a, b) => a.basename.localeCompare(b.basename));
    for (const file of stories) {
      menu.addItem((item) =>
        item
          .setTitle(file.parent && file.parent.path !== "/" ? `${file.basename}  ·  ${file.parent.path}` : file.basename)
          .setIcon(file === this.file ? "check" : STORY_ICON)
          .onClick(() => {
            if (file !== this.file) void this.openStory(file);
          }),
      );
    }
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("New story…")
        .setIcon("plus")
        .onClick(() => this.plugin.promptNewStory(this.plugin.settings.newStoryFolder)),
    );
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom });
  }

  private async openStory(file: TFile): Promise<void> {
    // Save this story first, so switching never loses an edit still waiting to be written.
    await this.save();
    await this.plugin.openAsBoard(this.leaf, file);
  }

  /**
   * Lets a tab be dragged along the row to a new place; the order is saved for
   * every story. The tabs stay where they are during the drag (moving an
   * element under the pointer loses the pointer); a marker shows where the
   * tab will go, and the order changes when it is let go.
   */
  private makeTabDraggable(row: HTMLElement, tab: HTMLElement): void {
    tab.addEventListener("pointerdown", (down) => {
      if (down.button !== 0) return;
      down.preventDefault();
      const startX = down.clientX;
      let moving = false;
      let target: { el: HTMLElement; after: boolean } | null = null;
      const tabs = () => Array.from(row.querySelectorAll<HTMLElement>(".story-planner-tab"));
      const clearMarks = () => tabs().forEach((t) => t.removeClass("is-drop-before", "is-drop-after"));

      const move = (e: PointerEvent) => {
        if (!moving) {
          if (Math.abs(e.clientX - startX) < DRAG_THRESHOLD) return;
          moving = true;
          row.addClass("is-reordering");
          tab.addClass("is-dragging");
        }
        // The tab nearest the pointer, and which side of it.
        let best: { el: HTMLElement; after: boolean; distance: number } | null = null;
        for (const t of tabs()) {
          const r = t.getBoundingClientRect();
          const middle = r.left + r.width / 2;
          const distance = Math.abs(e.clientX - middle);
          if (!best || distance < best.distance) best = { el: t, after: e.clientX > middle, distance };
        }
        clearMarks();
        target = best && best.el !== tab ? { el: best.el, after: best.after } : null;
        target?.el.addClass(target.after ? "is-drop-after" : "is-drop-before");
      };

      const up = () => {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
        window.removeEventListener("pointercancel", cancel, true);
        clearMarks();
        tab.removeClass("is-dragging");
        if (!moving) return;
        if (target) {
          const order = tabs()
            .map((t) => t.dataset.tab as StoryTab)
            .filter((id) => id !== tab.dataset.tab);
          const index = order.indexOf(target.el.dataset.tab as StoryTab) + (target.after ? 1 : 0);
          order.splice(index, 0, tab.dataset.tab as StoryTab);
          this.plugin.settings.tabOrder = orderedTabs(order);
          void this.plugin.saveSettings();
        }
        // The click that ends a drag must not also switch tabs.
        window.setTimeout(() => {
          row.removeClass("is-reordering");
          if (target) this.plugin.refreshBoards();
        }, 0);
      };
      const cancel = () => {
        target = null;
        up();
      };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
      window.addEventListener("pointercancel", cancel, true);
    });
  }

  /** Redraws the board, for settings that changed elsewhere (the tab order, say). */
  refresh(): void {
    this.render();
  }

  // -------------------------------------------------------------------------
  // Search and jumping to cards

  private searchBox(parent: HTMLElement, story: Story): HTMLInputElement {
    const box = parent.createDiv({ cls: "story-planner-search-box" });
    const input = box.createEl("input", { cls: "story-planner-search" });
    input.type = "search";
    input.placeholder = "Search cards";
    input.value = this.query;
    input.setAttr("aria-label", "Search cards");
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
    const tab = (path ? this.plugin.settings.viewState[path]?.tab : undefined) ?? "board";
    // The Events tab is gone; the board's "Show events" does what it did.
    return (tab as string) === "events" ? "board" : tab;
  }

  /**
   * Makes an event with a first scene, so it shows on the board straight
   * away, and opens its page with the cursor in its title. `at` places it (a
   * double-click's cell); from the toolbar it goes beside the selected card,
   * or in the first plot line and chapter (in story time, the first span).
   */
  private newEvent(at: NewEventPlace = {}): void {
    const story = this.story;
    if (!story) return;
    const selected = this.panel.selected ? story.cards[this.panel.selected] : undefined;
    const place: NewEventPlace = { ...at };
    if (!place.plotLine && selected) place.plotLine = selected.plotLine;
    if (place.chapter === undefined && !place.date) {
      if (this.tab === "time") place.date = selected?.date ?? [...this.buckets.values()][0]?.date;
      else if (selected) place.chapter = selected.chapter;
    }
    const made: { ids: { eventId: Id; cardId: Id } | null } = { ids: null };
    this.mutate((s) => {
      made.ids = createEvent(s, place);
      return made.ids !== null;
    });
    if (!made.ids) {
      new Notice("Add a plot line first: an event's scenes live in one.");
      return;
    }
    this.selectEvent(made.ids.eventId);
    this.panel.focusEventTitle();
  }

  /** Whether the current board shows events in place of their scenes. */
  private get showingEvents(): boolean {
    if (!this.story || this.story.events.length === 0) return false;
    return (this.tab === "board" && !!this.viewState()?.eventMode) || (this.tab === "time" && !!this.viewState()?.timeEventMode);
  }

  private showTab(tab: StoryTab): void {
    const path = this.file?.path;
    if (!path || tab === this.tab) return;
    // Remember the view setup was opened from, to go back to it.
    const lastView = this.tab === "setup" ? this.viewState()?.lastView : this.tab;
    this.plugin.settings.viewState[path] = { ...this.plugin.settings.viewState[path], tab, lastView };
    void this.plugin.saveSettings();
    this.select(null);
    this.render();
  }

  /** The chapter a card is in, for its badge; an off-page event says which chapter it happens during. */
  private chapterBadge(story: Story, card: Card): string {
    const chapter = story.chapters.find((c) => c.id === card.chapter);
    if (chapter) return chapterTitle(story, chapter);
    const during = story.chapters.find((c) => c.id === duringChapter(story, card));
    return during ? `Off-page, during ${chapterTitle(story, during)}` : "Off-page";
  }

  /** Whether cards show a piece of information, by the plugin's Layout settings. */
  private shows(what: CardShow): boolean {
    return cardShows(this.story, this.plugin.settings.cardShows, what);
  }

  /** A card's title; a card without one shows none, so its synopsis leads. */
  private cardTitle(el: HTMLElement, card: Card): void {
    if (!isUntitled(card.title)) el.createDiv({ cls: "story-planner-card-title", text: card.title });
    // A card with nothing written on it yet says so, faintly, so it is not an empty box.
    else if (!card.synopsis.trim()) el.createDiv({ cls: "story-planner-card-title is-placeholder", text: "Untitled" });
  }

  /** Replaces a card's title with a text box, for renaming it in place. */
  private editTitleInPlace(cardEl: HTMLElement, card: Card): void {
    let titleEl = cardEl.querySelector<HTMLElement>(".story-planner-card-title");
    const created = !titleEl;
    if (!titleEl) {
      // An untitled card: the box goes where the title would be.
      titleEl = createDiv({ cls: "story-planner-card-title" });
      const before = cardEl.querySelector<HTMLElement>(":scope > .story-planner-card-date, :scope > .story-planner-card-synopsis, :scope > .story-planner-card-note");
      if (before) cardEl.insertBefore(titleEl, before);
      else cardEl.appendChild(titleEl);
    }
    const input = document.createElement("input");
    input.className = "story-planner-card-title-input";
    input.type = "text";
    input.value = isUntitled(card.title) ? "" : card.title;
    titleEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      const title = input.value.trim();
      if (save && title !== card.title && (title || !isUntitled(card.title))) {
        this.mutate((s) => {
          const c = s.cards[card.id];
          if (!c) return false;
          c.title = title;
          c.modified = new Date().toISOString();
        });
      } else if (created) {
        input.remove();
      } else {
        input.replaceWith(titleEl!);
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
    if (this.tab === "characters" || this.tab === "organizations") return state?.characterOrientation ?? this.plugin.settings.defaultOrientation;
    return state?.orientation ?? this.plugin.settings.defaultOrientation;
  }

  private get zoom(): Zoom {
    const path = this.file?.path;
    return (path ? this.plugin.settings.viewState[path]?.zoom : undefined) ?? "day";
  }

  /** The clock zoom's block: the one chosen with Ctrl+wheel, or the story's shortest. */
  private clockBlock(story: Story): number {
    const finest = timeBlock(story);
    const chosen = this.viewState()?.clockBlock;
    return chosen && chosen >= finest ? chosen : finest;
  }

  /**
   * Ctrl+wheel over story time: up for finer, down for coarser, one step a
   * notch, through the zoom levels and then the clock's blocks. The time
   * under the pointer stays where it is.
   */
  private wheelZoom(e: WheelEvent): void {
    const story = this.story;
    if (!story || this.tab !== "time" || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    e.stopPropagation();
    const now = Date.now();
    if (now - this.lastWheel < 140) return;
    this.lastWheel = now;
    const steps = zoomSteps(story);
    const block = this.clockBlock(story);
    let at = steps.findIndex((s) => s.zoom === this.zoom && (s.zoom !== "clock" || s.block === block));
    if (at === -1) at = this.zoom === "clock" ? steps.length - 1 : 2;
    const next = steps[Math.max(0, Math.min(steps.length - 1, at + (e.deltaY < 0 ? 1 : -1)))]!;
    if (next === steps[at]) return;

    // The minute under the pointer, from the time header beside it, to scroll back to.
    const vertical = this.orientation === "vertical";
    const headers = Array.from(this.boardEl.querySelectorAll<HTMLElement>(".story-planner-time-header[data-start]"));
    const under = headers.find((h) => {
      const r = h.getBoundingClientRect();
      return vertical ? e.clientY >= r.top && e.clientY < r.bottom : e.clientX >= r.left && e.clientX < r.right;
    });
    const minute = under ? Number(under.dataset.start) : null;
    const offset = under ? (vertical ? under.getBoundingClientRect().top : under.getBoundingClientRect().left) : 0;

    this.setViewState(next.zoom === "clock" ? { zoom: "clock", clockBlock: next.block } : { zoom: next.zoom });
    this.zoomIndicator(next.zoom === "clock" ? `Clock · ${blockLabel(mainCalendar(story), next.block!)}` : ZOOM_LABELS[next.zoom]);
    if (minute === null) return;
    const after = Array.from(this.boardEl.querySelectorAll<HTMLElement>(".story-planner-time-header[data-start]"));
    const target = after.filter((h) => Number(h.dataset.start) <= minute).pop() ?? after[0];
    if (!target) return;
    const r = target.getBoundingClientRect();
    if (vertical) this.boardEl.scrollTop += r.top - offset;
    else this.boardEl.scrollLeft += r.left - offset;
  }

  /** A small label that says the zoom for a moment after it changes. */
  private zoomIndicator(text: string): void {
    this.contentEl.querySelector(".story-planner-zoom-indicator")?.remove();
    const el = this.contentEl.createDiv({ cls: "story-planner-zoom-indicator", text });
    window.setTimeout(() => el.addClass("is-fading"), 700);
    window.setTimeout(() => el.remove(), 1200);
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
    const key = this.tab === "time" ? "timeOrientation" : this.tab === "characters" || this.tab === "organizations" ? "characterOrientation" : "orientation";
    this.plugin.settings.viewState[path] = { ...this.plugin.settings.viewState[path], [key]: next };
    void this.plugin.saveSettings();
    this.render();
  }

  /** Redraws the toolbar and board. `typing` means the change came from typing in the panel. */
  private render(typing = false): void {
    this.plugin.boardChanged(this);
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
    // The title doubles as a story switcher.
    const title = toolbar.createEl("button", { cls: "story-planner-title" });
    title.createSpan({ text: story.title });
    setIcon(title.createSpan({ cls: "story-planner-title-chevron" }), "chevron-down");
    title.setAttr("aria-label", "Switch to another story");
    title.addEventListener("click", (e) => this.storyMenu(e));
    this.iconAction(toolbar, "undo-2", "Undo (Ctrl+Z)", () => this.undo(), !this.history.canUndo);
    this.iconAction(toolbar, "redo-2", "Redo (Ctrl+Shift+Z)", () => this.redo(), !this.history.canRedo);
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
    for (const id of orderedTabs(this.plugin.settings.tabOrder)) {
      const [label, icon] = TABS[id];
      const el = tabs.createEl("button", { cls: "story-planner-tab" });
      el.dataset.tab = id;
      el.setAttr("role", "tab");
      el.setAttr("aria-selected", String(id === tab));
      el.toggleClass("is-active", id === tab);
      iconOr(el.createSpan({ cls: "story-planner-tab-icon" }), icon, "layout-grid");
      el.createSpan({ cls: "story-planner-tab-label", text: label });
      // When the window is narrow the tabs show only their icons; the name stays as a tooltip.
      el.setAttr("aria-label", label);
      el.setAttr("title", label);
      el.addEventListener("click", () => {
        if (!tabs.hasClass("is-reordering")) this.showTab(id);
      });
      this.makeTabDraggable(tabs, el);
    }

    const onBoard = tab === "board";
    const onTime = tab === "time";
    const onCharacters = tab === "characters" || tab === "organizations";
    const onOutline = tab === "outline";
    const withPanel = onBoard || onTime || onCharacters || onOutline;
    this.bodyEl.hidden = !withPanel;
    this.setup.setOpen(tab === "setup", story);
    if (onTime) this.timeActions(tabsRow.createDiv({ cls: "story-planner-tab-actions" }), story);
    if (onCharacters) this.characterActions(tabsRow.createDiv({ cls: "story-planner-tab-actions" }), story);
    if (onOutline) {
      const actions = tabsRow.createDiv({ cls: "story-planner-tab-actions" });
      // The plot chapter by chapter, or in the order things happen; the export follows.
      const axis = actions.createEl("select", { cls: "dropdown" });
      axis.setAttr("aria-label", "Order");
      axis.createEl("option", { text: "By chapter" }).value = "chapters";
      axis.createEl("option", { text: "By story time" }).value = "time";
      axis.value = this.viewState()?.outlineAxis ?? "chapters";
      axis.addEventListener("change", () => this.setViewState({ outlineAxis: axis.value as "chapters" | "time" }));
      this.toolIcon(actions, "file-output", "Export outline", () => {
        if (this.file && this.story) void this.plugin.exportOutline(this.file, this.story, this.viewState()?.outlineAxis ?? "chapters");
      });
    }
    if (onBoard) {
      const actions = tabsRow.createDiv({ cls: "story-planner-tab-actions" });
      this.toolIcon(actions, "git-branch-plus", "Add plot line", () =>
        new TextPromptModal(this.app, "New plot line", "", (name) => this.mutate((s) => void addPlotLine(s, name))).open(),
      );
      this.toolIcon(actions, "book-plus", "Add chapter", () => this.editChapter(null));
      this.highlightPicker(actions, story);
      // Off-page events, shown or not.
      const shown = !this.viewState()?.hideOffPage;
      this.toolIcon(actions, "ghost", shown ? "Off-page events shown (click to hide)" : "Off-page events hidden (click to show)", () => this.setViewState({ hideOffPage: shown }), shown);
      this.toolIcon(actions, "rows-4", this.compact ? "Compact layout (click for cozy)" : "Compact layout", () => this.toggleCompact(), this.compact);
      // Event mode: each event's scenes as one block.
      const eventMode = !!this.viewState()?.eventMode;
      this.toolIcon(actions, "flag", eventMode ? "Showing events (click for scenes)" : "Show events instead of their scenes", () => this.setViewState({ eventMode: !eventMode, expandedEvents: [] }), eventMode);
      this.toolIcon(actions, "square-plus", "New event", () => this.newEvent());
    }

    const actions = tabsRow.querySelector<HTMLElement>(".story-planner-tab-actions") ?? tabsRow.createDiv({ cls: "story-planner-tab-actions" });
    if (withPanel && !onOutline) {
      const on = !!this.viewState()?.minimap;
      this.toolIcon(actions, "map", on ? "Minimap shown (click to hide)" : "Minimap", () => this.setViewState({ minimap: !on }), on);
    }
    // Where cards open: the side panel, or the middle over the board. The same for every story.
    if (withPanel) {
      const centre = this.plugin.settings.cardOpening === "centre";
      const opening = actions.createEl("button", { cls: "story-planner-tool story-planner-opening-toggle clickable-icon" });
      iconOr(opening, centre ? "app-window" : "panel-right", "layout");
      const label = centre ? "Cards open in the middle. Click to open them in the side panel." : "Cards open in the side panel. Click to open them in the middle.";
      opening.setAttr("aria-label", label);
      opening.setAttr("title", label);
      opening.addEventListener("click", () => {
        this.plugin.settings.cardOpening = centre ? "side" : "centre";
        void this.plugin.saveSettings();
        this.plugin.refreshBoards();
      });
    }
    this.bodyEl.toggleClass("is-peek", this.plugin.settings.cardOpening === "centre");

    // Story setup opens from a gear at the right, and closes back to the view it came from.
    const gear = actions.createEl("button", { cls: "story-planner-setup-toggle clickable-icon" });
    setIcon(gear, "settings");
    gear.setAttr("aria-label", tab === "setup" ? "Close story setup" : "Story setup");
    gear.setAttr("title", "Story setup");
    gear.setAttr("aria-pressed", String(tab === "setup"));
    gear.toggleClass("is-active", tab === "setup");
    gear.addEventListener("click", () => this.showTab(tab === "setup" ? (this.viewState()?.lastView ?? "board") : "setup"));
    this.fitToolbar();

    // Keep the panel on the selected card (or cards); it closes if the card is gone (after an undo, say).
    for (const id of [...this.multi]) if (!story.cards[id]) this.multi.delete(id);
    if (withPanel && this.multi.size >= 2) this.panel.showGroup(story, [...this.multi]);
    else if (withPanel && this.panel.selectedEvent && story.events.some((e) => e.id === this.panel.selectedEvent)) {
      this.panel.showEvent(story, this.panel.selectedEvent, typing);
    } else {
      if (this.multi.size > 0) this.multi.clear();
      this.panel.show(story, withPanel ? this.panel.selected : null, typing);
    }
    this.setup.refresh(story, typing);
    // While typing on the board itself (a profile, the outline), it is not redrawn under the cursor.
    const typingOnBoard = typing && this.boardEl.contains(document.activeElement);
    if (withPanel && !typingOnBoard) this.renderBoard(story);
    this.minimap.setVisible(withPanel && !onOutline && !!this.viewState()?.minimap);
  }

  /**
   * Draws the board off-screen and swaps it in, so it is never empty for a
   * moment, and keeps the scroll position: an edit must not move the view.
   */
  private renderBoard(story: Story): void {
    const { scrollTop, scrollLeft } = this.boardEl;
    // A field on the board being edited (a profile's, the outline's) gets the cursor back after the redraw.
    const active = document.activeElement;
    const focused = active instanceof HTMLElement && this.boardEl.contains(active) ? active.dataset.field : undefined;
    const caret =
      active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? [active.selectionStart, active.selectionEnd] : null;
    const content = document.createElement("div");
    if (this.tab === "time") this.fillTime(content, story);
    else if (this.tab === "characters" || this.tab === "organizations") this.fillCharacters(content, story);
    else if (this.tab === "outline") this.fillOutline(content, story);
    else this.fillBoard(content, story);
    this.boardEl.replaceChildren(...Array.from(content.childNodes));
    if (this.tab === "time") this.fitTimeLabels();
    this.boardEl.scrollTop = scrollTop;
    this.boardEl.scrollLeft = scrollLeft;
    if (focused) {
      const again = this.boardEl.querySelector<HTMLElement>(`[data-field="${CSS.escape(focused)}"]`);
      again?.focus({ preventScroll: true });
      if (caret && (again instanceof HTMLInputElement || again instanceof HTMLTextAreaElement)) again.setSelectionRange(caret[0] ?? null, caret[1] ?? null);
    }
    // Act and chapter labels stay just below the header row while their rows scroll past.
    const grid = this.boardEl.querySelector<HTMLElement>(".story-planner-grid");
    const headerRow = grid?.querySelector<HTMLElement>(".story-planner-lane-header");
    if (grid && headerRow) {
      const size = this.orientation === "vertical" ? headerRow.offsetHeight : headerRow.offsetWidth;
      grid.style.setProperty("--story-planner-head-size", `${size}px`);
    }
    // A chapter's label shows in full beside the chapter; only one that does not fit fades out.
    for (const wrap of Array.from(this.boardEl.querySelectorAll<HTMLElement>(".story-planner-chapter-wrap"))) {
      wrap.toggleClass("is-clipped", wrap.scrollHeight > wrap.clientHeight + 1);
    }
    this.markSelection();
  }

  private fillBoard(parent: HTMLElement, story: Story): void {
    if (story.plotLines.length === 0) {
      parent.createDiv({ cls: "story-planner-empty", text: "No plot lines yet" });
      return;
    }

    const eventMode = !!this.viewState()?.eventMode && story.events.length > 0;
    const layout = computeBoardLayout(
      story,
      this.orientation,
      this.compact,
      this.foldedChapters,
      !this.viewState()?.hideOffPage,
      eventMode ? { expanded: new Set(this.viewState()?.expandedEvents ?? []) } : undefined,
    );
    // Events without scenes have no place on the grid: they wait in a strip above it.
    if (eventMode) {
      const empty = emptyEvents(story).filter((e) => !e.chapter || !story.chapters.some((c) => c.id === e.chapter));
      if (empty.length > 0) {
        const strip = parent.createDiv({ cls: "story-planner-event-strip" });
        strip.createSpan({ cls: "story-planner-profile-detail", text: "Events without scenes or chapter:" });
        for (const event of empty) {
          const chip = strip.createSpan({ cls: "story-planner-event-chip", text: event.title || "Untitled event" });
          chip.style.setProperty("--event-color", eventColor(story, event.id));
          const chapter = event.chapter ? story.chapters.find((c) => c.id === event.chapter) : undefined;
          if (chapter) chip.createSpan({ cls: "story-planner-profile-detail", text: ` (${chapterTitle(story, chapter)})` });
          chip.addEventListener("click", () => this.selectEvent(event.id));
          // A scene dropped on it joins the event.
          this.makeDropTarget(chip, "card", null, () => {
            const ids = this.draggedMany ?? [this.dragged!.id];
            this.mutate((s) => setEventOnCards(s, ids, event.id));
          });
        }
      }
    }
    const cls = [this.compact ? "is-compact" : "", layout.acts ? "has-acts" : ""].filter(Boolean).join(" ");
    const grid = this.spanGrid(parent, cls, layout.rows, layout.columns, "plotLine", story.plotLines.map((p) => p.id), undefined, layout.acts ? 2 : 1);

    for (const placed of layout.items) {
      const el = this.renderItem(grid, placed.item, story);
      // On top of an event's card: drawn a step in, so the event's card shows beside it.
      if (placed.depth) {
        el.addClass("is-nested");
        el.style.setProperty("--depth", String(Math.min(placed.depth, 3)));
      }
      const vertical = this.orientation === "vertical";
      const along = placed.span && placed.span > 1 ? ` / span ${placed.span}` : "";
      el.style.gridRow = String(placed.row) + (vertical ? along : "");
      el.style.gridColumn = String(placed.column) + (vertical ? "" : along);
      // The line between acts runs across the whole board; with acts, the corner covers the act column too.
      if (placed.item.kind === "act-divider") {
        if (vertical) el.style.gridColumn = "1 / -1";
        else el.style.gridRow = "1 / -1";
      } else if (placed.item.kind === "corner" && layout.acts) {
        if (vertical) el.style.gridColumn = "1 / span 2";
        else el.style.gridRow = "1 / span 2";
      }
    }
    this.markFoldedLanes(grid);
  }

  private renderItem(grid: HTMLElement, item: BoardItem, story: Story): HTMLElement {
    switch (item.kind) {
      case "corner": {
        const el = grid.createDiv({ cls: "story-planner-corner" });
        if (this.tab === "time" && this.buckets.size > 0) {
          const ids = [...this.buckets.keys()];
          const folded = new Set(this.viewState()?.foldedTimes ?? []);
          const allFolded = ids.every((id) => folded.has(id));
          const all = el.createEl("button", { cls: "story-planner-fold clickable-icon is-fold-all" });
          const vertical = this.orientation === "vertical";
          iconOr(
            all,
            allFolded ? (vertical ? "unfold-vertical" : "unfold-horizontal") : vertical ? "fold-vertical" : "fold-horizontal",
            allFolded ? "chevrons-up-down" : "chevrons-down-up",
          );
          all.setAttr("aria-label", allFolded ? "Unfold everything" : "Fold everything");
          all.setAttr("title", allFolded ? "Unfold everything" : "Fold everything");
          stopBoardGestures(all);
          all.addEventListener("click", (e) => {
            e.stopPropagation();
            this.toggleTimeFold(ids);
          });
        }
        if (this.tab === "board" && story.chapters.length > 0) {
          const allFolded = story.chapters.every((c) => this.foldedChapters.has(c.id));
          const all = el.createEl("button", { cls: "story-planner-fold clickable-icon" });
          const vertical = this.orientation === "vertical";
          iconOr(
            all,
            allFolded ? (vertical ? "unfold-vertical" : "unfold-horizontal") : vertical ? "fold-vertical" : "fold-horizontal",
            allFolded ? "chevrons-up-down" : "chevrons-down-up",
          );
          all.setAttr("aria-label", allFolded ? "Unfold all chapters" : "Fold all chapters");
          all.setAttr("title", allFolded ? "Unfold all chapters" : "Fold all chapters");
          all.addClass("is-fold-all");
          stopBoardGestures(all);
          all.addEventListener("click", (e) => {
            e.stopPropagation();
            this.toggleAllChapters(story);
          });
        }
        return el;
      }

      case "lane-header": {
        const plotLine = story.plotLines.find((p) => p.id === item.plotLineId);
        const el = grid.createDiv({ cls: "story-planner-lane-header" });
        el.createSpan({ cls: "story-planner-lane-name", text: plotLine?.name ?? "" });
        this.laneControls(el, "plotLine", item.plotLineId, plotLine?.name ?? "this plot line");
        el.style.setProperty("--lane-color", plotLineColor(story, plotLine) ?? "var(--interactive-accent)");
        if (plotLine?.synopsis?.trim()) el.setAttr("title", `${plotLine.name}

${plotLine.synopsis.trim()}`);
        // Double-click edits its name and synopsis.
        el.addEventListener("dblclick", () => {
          if (!plotLine) return;
          new FormModal(
            this.app,
            `Edit ${plotLine.name}`,
            [
              { key: "name", label: "Name", kind: "text", value: plotLine.name },
              { key: "synopsis", label: "Synopsis", kind: "textarea", value: plotLine.synopsis ?? "", placeholder: "What this plot line is about" },
            ],
            (values) =>
              this.mutate((s) => {
                const p = s.plotLines.find((x) => x.id === plotLine.id)!;
                if (values.name?.trim()) p.name = values.name.trim();
                const synopsis = values.synopsis?.trim();
                if (synopsis) p.synopsis = synopsis;
                else delete p.synopsis;
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
        const el = grid.createDiv({ cls: "story-planner-chapter-header" });
        if (item.chapterId) el.dataset.chapterId = item.chapterId;
        // The first chapter of an act (and off-page after an act) carries the line between acts.
        if (actsShown(story)) {
          const index = chapter ? story.chapters.indexOf(chapter) : story.chapters.length;
          const previous = story.chapters[index - 1];
          if (index > 0 && (previous?.act ?? null) !== (chapter?.act ?? null)) el.addClass("is-act-start");
        }
        // "Chapter 3" small, the writer's title below it, then the synopsis, as
        // one label that stays in view while the chapter scrolls past. The label
        // floats over the chapter's cell, so a long synopsis never makes the
        // chapter's rows taller; one that does not fit fades out at the bottom.
        const wrap = el.createDiv({ cls: "story-planner-chapter-wrap" });
        const block = wrap.createDiv({ cls: "story-planner-chapter-block" });
        const text = block.createDiv({ cls: "story-planner-chapter-text" });
        if (chapter) {
          const head = text.createDiv({ cls: "story-planner-chapter-head" });
          head.createDiv({ cls: "story-planner-chapter-number", text: chapterHeading(story, chapter) });
          if (chapter.name.trim()) head.createDiv({ cls: "story-planner-chapter-name", text: chapter.name });
          if (chapter.summary?.trim()) {
            const synopsis = text.createDiv({ cls: "story-planner-chapter-synopsis", text: chapter.summary });
            synopsis.setAttr("title", chapter.summary);
          }
        } else {
          text.createDiv({ cls: "story-planner-chapter-head" }).createDiv({ cls: "story-planner-chapter-name", text: "Off-page" });
        }
        this.chapterControls(el, item.chapterId, story);
        // The fold button and a folded chapter's count go into the label, so they move with it.
        const fold = el.querySelector<HTMLElement>(":scope > .story-planner-fold");
        if (fold) block.prepend(fold);
        const count = el.querySelector<HTMLElement>(":scope > .story-planner-fold-count");
        if (count) text.appendChild(count);
        if (chapter) {
          el.addEventListener("dblclick", () => this.editChapter(chapter.id));
          el.addEventListener("contextmenu", (e) => this.chapterMenu(e, chapter.id));
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
        el.addEventListener("click", () => this.addCard({ chapter: item.chapterId, plotLine: item.plotLineId }));
        // Dropping here puts the card first in the chapter.
        this.makeDropTarget(el, "card", null, () =>
          this.mutate((s) =>
            moveToChapter(s, this.dragged!.id, this.backgroundDrop, {
              chapter: item.chapterId,
              plotLine: item.plotLineId,
              beforeCardId: chapterCards(s, item.chapterId).find((c) => c.id !== this.dragged!.id)?.id ?? null,
            }),
          ),
        );
        this.boardTarget(el, () => ({
          target: {
            chapter: item.chapterId,
            plotLine: item.plotLineId,
            beforeCardId: chapterCards(story, item.chapterId).find((c) => !this.multi.has(c.id))?.id ?? null,
          },
          background: this.backgroundDrop,
        }));
        this.echoLane(el, item.plotLineId);
        return el;
      }

      case "empty": {
        // Empty space in a plot line, in the row of a scene in another plot
        // line: the middle puts the dropped card in that row, beside the scene;
        // the edges put it in a new row just before or after.
        const el = grid.createDiv({ cls: "story-planner-cell" });
        const card = story.cards[item.cardId]!;
        this.makeCardDropTarget(el, card, item.plotLineId, true);
        // Double-click creates a card here, in this row; while showing events, an event.
        el.addEventListener("dblclick", () => {
          if (this.showingEvents) this.newEvent({ plotLine: item.plotLineId, chapter: card.chapter });
          else this.addCard({ chapter: card.chapter, plotLine: item.plotLineId, besideCardId: card.id });
        });
        return el;
      }

      case "act-band": {
        // The act column: one cell beside all of an act's chapters, with its
        // number and title turned on their side. Chapters in no act get an empty cell.
        const el = grid.createDiv({ cls: "story-planner-act-band" });
        const act = item.actId ? story.acts.find((a) => a.id === item.actId) : undefined;
        if (!act) {
          el.addClass("is-empty");
          return el;
        }
        const chapters = chaptersInAct(story, act.id);
        const folded = this.foldedChapters;
        const allFolded = chapters.length > 0 && chapters.every((c) => folded.has(c.id));
        const fold = el.createEl("button", { cls: "story-planner-fold clickable-icon" });
        setIcon(fold, allFolded ? "chevron-right" : "chevron-down");
        fold.setAttr("aria-label", allFolded ? "Unfold this act's chapters" : "Fold this act's chapters");
        fold.setAttr("title", allFolded ? "Unfold this act's chapters" : "Fold this act's chapters");
        stopBoardGestures(fold);
        fold.addEventListener("click", (e) => {
          e.stopPropagation();
          const ids = new Set(chapters.map((c) => c.id));
          const rest = (this.viewState()?.foldedChapters ?? []).filter((id) => !ids.has(id));
          this.setViewState({ foldedChapters: allFolded ? rest : [...rest, ...ids] });
        });
        const label = el.createDiv({ cls: "story-planner-act-label" });
        label.createSpan({ cls: "story-planner-act-number", text: actHeading(story, act) });
        if (act.title?.trim()) label.createSpan({ cls: "story-planner-act-title", text: act.title });
        el.setAttr("title", [actTitle(story, act), act.summary?.trim()].filter(Boolean).join("\n\n"));
        el.addEventListener("dblclick", () => this.editAct(act.id));
        el.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          const menu = new Menu();
          menu.addItem((i) => i.setTitle("Edit act…").setIcon("pencil").onClick(() => this.editAct(act.id)));
          menu.addItem((i) =>
            i
              .setTitle("Delete act (keeps its chapters)")
              .setIcon("trash-2")
              .onClick(() => {
                this.mutate((s) => deleteAct(s, act.id));
                new Notice(`Deleted ${actTitle(story, act)}. Its chapters are kept. Press Ctrl+Z to undo.`);
              }),
          );
          menu.showAtMouseEvent(e);
        });
        return el;
      }

      case "event-card": {
        // An event shown as one card, in place of its scenes: built like a card, in the event's colour.
        const event = story.events.find((e) => e.id === item.eventId)!;
        const el = grid.createDiv({ cls: "story-planner-card story-planner-event-card" });
        el.style.setProperty("--lane-color", eventColor(story, event.id));
        el.dataset.eventId = event.id;
        el.toggleClass("is-selected", this.panel.selectedEvent === event.id);
        // Written or not, as for a card.
        el.toggleClass("is-written", !!event.written);
        if (this.shows("written")) {
          const box = el.createEl("button", { cls: "story-planner-written" });
          box.setAttr("role", "checkbox");
          box.setAttr("aria-checked", String(!!event.written));
          box.setAttr("aria-label", event.written ? "Written. Click to mark it not written." : "Not written yet. Click to mark it written.");
          if (event.written) setIcon(box, "check");
          stopBoardGestures(box);
          box.addEventListener("click", (e) => {
            e.stopPropagation();
            this.mutate((s) => {
              const ev = s.events.find((x) => x.id === event.id)!;
              if (ev.written) delete ev.written;
              else ev.written = true;
            });
          });
        }
        const parentEvent = event.parent ? story.events.find((e) => e.id === event.parent) : undefined;
        if (parentEvent) el.createDiv({ cls: "story-planner-card-badge", text: parentEvent.title || "Untitled arc" });
        el.createDiv({ cls: "story-planner-card-title", text: event.title || "Untitled event" });
        if (event.synopsis?.trim() && this.shows("synopsis")) el.createDiv({ cls: "story-planner-card-synopsis", text: event.synopsis });
        const foot = el.createDiv({ cls: "story-planner-event-card-foot" });
        foot.createSpan({ cls: "story-planner-profile-detail", text: item.cardIds.length > 0 ? `${item.cardIds.length} ${item.cardIds.length === 1 ? "scene" : "scenes"}` : "No scenes yet" });
        // The arrow shows this event's scenes as cards in its place.
        if (item.cardIds.length > 0) {
          const open = foot.createEl("button", { cls: "story-planner-fold clickable-icon" });
          setIcon(open, "chevrons-up-down");
          open.setAttr("aria-label", "Show its scenes");
          open.setAttr("title", "Show its scenes");
          stopBoardGestures(open);
          open.addEventListener("click", (e) => {
            e.stopPropagation();
            this.setViewState({ expandedEvents: toggleExpanded(this.viewState()?.expandedEvents ?? [], event.id) });
          });
        }
        const matches = item.cardIds.map((id) => story.cards[id]).filter((c): c is Card => !!c).map((c) => this.highlighted(c, story));
        if (matches.length > 0 && matches.every((m) => m === false)) el.addClass("is-dimmed");
        el.addEventListener("click", () => this.selectEvent(event.id));
        // Dragged to another plot line, it lives there; its scenes stay where they are.
        this.makeDraggable(el, { kind: "event", id: event.id });
        // A scene dropped on it joins the event.
        this.makeDropTarget(el, "card", null, () => {
          const ids = this.draggedMany ?? [this.dragged!.id];
          this.mutate((s) => setEventOnCards(s, ids, event.id));
        });
        return el;
      }

      case "event-echo": {
        // Where the event's scenes are in another plot line: an echo of it, like a card's.
        const event = story.events.find((e) => e.id === item.eventId)!;
        const el = grid.createDiv({ cls: "story-planner-echo story-planner-event-echo", text: event.title || "Untitled event" });
        el.style.setProperty("--lane-color", eventColor(story, event.id));
        el.setAttr("title", `${event.title || "Untitled event"}: ${item.cardIds.length} ${item.cardIds.length === 1 ? "scene" : "scenes"} here`);
        el.addEventListener("click", () => this.selectEvent(event.id));
        this.makeDropTarget(el, "card", null, () => {
          const ids = this.draggedMany ?? [this.dragged!.id];
          this.mutate((s) => setEventOnCards(s, ids, event.id));
        });
        return el;
      }

      case "act-divider":
        return grid.createDiv({ cls: "story-planner-act-divider" });

      case "background-cell": {
        // Space in a chapter's background rows: what lands here happens off-page, during the chapter.
        const el = grid.createDiv({ cls: "story-planner-cell is-background" });
        const during = (s: Story, id: Id) => {
          moveCard(s, id, { chapter: null, plotLine: item.plotLineId });
          setCardDuring(s, id, item.chapterId);
        };
        this.makeDropTarget(el, "card", null, () => this.mutate((s) => during(s, this.dragged!.id)));
        this.boardTarget(el, () => ({ target: { chapter: item.chapterId, plotLine: item.plotLineId }, background: true }));
        this.echoLane(el, item.plotLineId);
        el.addEventListener("dblclick", () => {
          let id: Id | null = null;
          this.mutate((s) => {
            id = addCardAt(s, { chapter: null, plotLine: item.plotLineId });
            setCardDuring(s, id, item.chapterId);
          });
          if (id) {
            this.select(id);
            this.panel.focusTitle();
          }
        });
        return el;
      }

      case "chapter-folded": {
        const el = grid.createDiv({
          cls: "story-planner-folded-cell",
          text: item.count > 0 ? `${item.count} ${item.count === 1 ? "card" : "cards"}` : "",
        });
        el.addEventListener("dblclick", () => this.toggleChapterFold(item.chapterId));
        this.makeDropTarget(el, "card", null, () =>
          this.mutate((s) => moveToChapter(s, this.dragged!.id, this.backgroundDrop, { chapter: item.chapterId, plotLine: item.plotLineId })),
        );
        this.boardTarget(el, () => ({ target: { chapter: item.chapterId, plotLine: item.plotLineId }, background: this.backgroundDrop }));
        this.echoLane(el, item.plotLineId);
        return el;
      }

      case "chapter-end": {
        const el = grid.createDiv({ cls: "story-planner-chapter-end" });
        el.addEventListener("dblclick", () => {
          if (this.showingEvents) this.newEvent({ plotLine: item.plotLineId, chapter: item.chapterId });
          else this.addCard({ chapter: item.chapterId, plotLine: item.plotLineId });
        });
        this.makeDropTarget(el, "card", null, () =>
          this.mutate((s) => moveToChapter(s, this.dragged!.id, this.backgroundDrop, { chapter: item.chapterId, plotLine: item.plotLineId })),
        );
        this.boardTarget(el, () => ({ target: { chapter: item.chapterId, plotLine: item.plotLineId }, background: this.backgroundDrop }));
        this.echoLane(el, item.plotLineId);
        return el;
      }

      case "card": {
        const card = story.cards[item.cardId]!;
        const plotLine = story.plotLines.find((p) => p.id === card.plotLine);
        const el = grid.createDiv({ cls: "story-planner-card" });
        el.style.setProperty("--lane-color", plotLineColor(story, plotLine) ?? "var(--interactive-accent)");
        if (!story.chapters.some((c) => c.id === card.chapter)) el.addClass("is-off-page");
        this.writtenToggle(el, card);
        if (item.background) {
          el.addClass("is-background");
          el.createDiv({ cls: "story-planner-card-badge", text: "Background" });
        }
        this.cardTitle(el, card);
        if (card.date) {
          if (this.shows("date")) el.createDiv({ cls: "story-planner-card-date", text: formatDateRange(story, card.date, card.endDate) });
        }
        if (card.synopsis && this.shows("synopsis")) el.createDiv({ cls: "story-planner-card-synopsis", text: card.synopsis });
        this.cardExtras(el, card, story);
        el.dataset.cardId = card.id;
        el.addEventListener("click", (e) => this.clickCard(e, card.id));
        el.addEventListener("dblclick", () => this.editTitleInPlace(el, card));
        this.makeDraggable(el, { kind: "card", id: card.id });
        this.makeCardDropTarget(el, card, card.plotLine);
        return el;
      }

      case "echo": {
        const card = story.cards[item.cardId]!;
        const home = story.plotLines.find((p) => p.id === card.plotLine);
        const el = grid.createDiv({ cls: "story-planner-echo", text: echoText(card) });
        el.style.setProperty("--lane-color", plotLineColor(story, home) ?? "var(--interactive-accent)");
        el.setAttr("aria-label", `Also in ${home?.name ?? "another plot line"}`);
        if (this.highlighted(card, story) === false) el.addClass("is-dimmed");
        if (item.background) el.addClass("is-background");
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
  // Outline: the story composed as a document, act by act and chapter by
  // chapter, with each chapter's scenes in board order and its background.

  private fillOutline(parent: HTMLElement, story: Story): void {
    this.outline.render(parent, story);
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
    group(
      "Organizations",
      orgTree(story).flatMap(({ org, depth }): [string, string][] => [
        [`org:${org.id}`, `${" ".repeat(depth)}${org.name}`],
        [`orgmembers:${org.id}`, `${" ".repeat(depth)}${org.name} and its members`],
      ]),
    );
    group("Events", eventTree(story).flatMap(({ event, children }): [string, string][] => [
      [`event:${event.id}`, event.title || "Untitled event"],
      ...children.map((c): [string, string] => [`event:${c.id}`, ` ${c.title || "Untitled event"}`]),
    ]));
    group("Scene tags", story.tags.map((t) => [`tag:${t.id}`, t.name]));
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
    if (kind === "org" || kind === "orgmembers") {
      if (!story.organizations.some((o) => o.id === id)) return undefined;
      // An organization stands for the ones inside it too.
      const ids = new Set([id, ...orgDescendants(story, id)]);
      if (card.orgs?.some((o) => ids.has(o.id))) return true;
      if (kind === "org") return false;
      return card.characters.some((e) => story.characters.find((c) => c.id === e.id)?.orgs?.some((m) => ids.has(m.id)));
    }
    if (kind === "event") {
      if (!story.events.some((e) => e.id === id)) return undefined;
      return eventPath(story, card).some((e) => e.id === id);
    }
    if (kind === "location") {
      if (!story.locations.some((l) => l.id === id)) return undefined;
      return !!card.location && locationAndInside(story, id).has(card.location);
    }
    return undefined;
  }

  /** The small square on a card that marks it written or not, in one click and without opening the panel. */
  private writtenToggle(el: HTMLElement, card: Card): void {
    el.toggleClass("is-written", card.written);
    if (!this.shows("written")) return;
    const box = el.createEl("button", { cls: "story-planner-written" });
    box.setAttr("role", "checkbox");
    box.setAttr("aria-checked", String(card.written));
    box.setAttr("aria-label", card.written ? "Written. Click to mark it not written." : "Not written yet. Click to mark it written.");
    box.setAttr("title", card.written ? "Written" : "Not written yet");
    if (card.written) setIcon(box, "check");
    stopBoardGestures(box);
    box.addEventListener("click", (e) => {
      e.stopPropagation();
      this.mutate((s) => updateCard(s, card.id, { written: !s.cards[card.id]!.written }));
    });
  }

  /** What every card shows besides title, date and synopsis: its place, tags, and the highlight. */
  private cardExtras(el: HTMLElement, card: Card, story: Story, roleNote = true): void {
    if (card.location && story.locations.some((l) => l.id === card.location) && this.shows("place")) {
      el.createDiv({ cls: "story-planner-card-place", text: locationPath(story, card.location) });
    }
    // Characters as chips: point of view filled, present outlined, mentioned dashed.
    if (card.characters.length > 0 && this.shows("characters") && roleNote) {
      const chips = el.createDiv({ cls: "story-planner-card-characters" });
      for (const entry of card.characters) {
        const character = story.characters.find((c) => c.id === entry.id);
        if (!character) continue;
        const chip = chips.createSpan({ cls: `story-planner-role-chip role-${entry.role}`, text: character.name });
        chip.style.setProperty("--chip-color", character.color);
        chip.setAttr("title", `${character.name}: ${ROLE_LABELS[entry.role]}`);
      }
    }
    // Organizations the same way: involved outlined, mentioned dashed.
    if (card.orgs && card.orgs.length > 0 && this.shows("organizations")) {
      const chips = el.createDiv({ cls: "story-planner-card-characters" });
      for (const entry of card.orgs) {
        const org = story.organizations.find((o) => o.id === entry.id);
        if (!org) continue;
        const chip = chips.createSpan({ cls: `story-planner-role-chip role-${entry.role}`, text: org.shortName || org.name });
        chip.style.setProperty("--chip-color", org.color);
        chip.setAttr("title", `${org.name}: ${entry.role === "mentioned" ? "mentioned" : "involved"}`);
      }
    }
    // The event the scene is part of, with its arc.
    // The event it is part of: a small tab at the very top of the card, in the event's colour.
    const path = eventPath(story, card);
    if (path.length > 0 && this.shows("event")) {
      const event = path[path.length - 1]!;
      const tab = createDiv({ cls: "story-planner-card-event", text: path.map((e) => e.title || "Untitled event").join(" › ") });
      tab.style.setProperty("--event-color", eventColor(story, event.id));
      el.prepend(tab);
      el.addClass("has-event");
      // While the board shows events, this scene's event is shown as its scenes; the marker folds them back into the event.
      const showing = (this.tab === "board" && this.viewState()?.eventMode) || (this.tab === "time" && this.viewState()?.timeEventMode);
      if (showing && (this.viewState()?.expandedEvents ?? []).includes(event.id)) {
        tab.addClass("is-foldable");
        tab.setAttr("title", "Show as the event again");
        setIcon(tab.createSpan({ cls: "story-planner-card-event-fold" }), "chevrons-down-up");
        stopBoardGestures(tab);
        tab.addEventListener("click", (e) => {
          e.stopPropagation();
          this.setViewState({ expandedEvents: toggleExpanded(this.viewState()?.expandedEvents ?? [], event.id) });
        });
      }
    }
    if (story.tagsEnabled && card.tags.length > 0 && this.shows("tags")) {
      const chips = el.createDiv({ cls: "story-planner-card-tags" });
      for (const id of card.tags) {
        const tag = story.tags.find((t) => t.id === id);
        if (!tag) continue;
        const chip = chips.createSpan({ cls: "story-planner-tag-chip is-on", text: tag.name });
        chip.style.setProperty("--tag-color", tag.color);
      }
    }
    if (card.notes.length > 0 && this.shows("notes")) {
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
    // Every span from the first to the last, empty ones too, like a calendar.
    const expanded = !!this.viewState()?.expandTimeline;
    const expand = actions.createEl("button", { cls: "story-planner-tool clickable-icon story-planner-expand-time" });
    iconOr(expand, expanded ? "fold-vertical" : "unfold-vertical", "chevrons-up-down");
    expand.setAttr("aria-label", expanded ? "Show only times with cards" : "Show the whole timeline");
    expand.setAttr("title", expanded ? "Show only times with cards" : "Show the whole timeline");
    expand.setAttr("aria-pressed", String(expanded));
    expand.toggleClass("is-active", expanded);
    expand.addEventListener("click", () => this.setViewState({ expandTimeline: !expanded }));
    // Events, as on the board.
    if (story.events.length > 0) {
      const eventMode = !!this.viewState()?.timeEventMode;
      this.toolIcon(actions, "flag", eventMode ? "Showing events (click for scenes)" : "Show events instead of their scenes", () => this.setViewState({ timeEventMode: !eventMode, expandedEvents: [] }), eventMode);
    }
    this.toolIcon(actions, "square-plus", "New event", () => this.newEvent());
    if (story.zones.length > 0) {
      const zones = actions.createEl("select", { cls: "dropdown" });
      zones.setAttr("aria-label", "Show times in");
      zones.setAttr("title", "Show times in");
      zones.createEl("option", { text: "Local" }).value = "";
      for (const zone of story.zones) zones.createEl("option", { text: zone.name }).value = zone.id;
      zones.value = this.zoneView;
      zones.addEventListener("change", () => this.setViewState({ timeZoneView: zones.value }));
    }
  }

  private fillTime(parent: HTMLElement, story: Story): void {
    if (story.plotLines.length === 0) {
      parent.createDiv({ cls: "story-planner-empty", text: "No plot lines yet" });
      return;
    }
    const orientation = this.orientation;
    const expand = !!this.viewState()?.expandTimeline;
    const eventMode = !!this.viewState()?.timeEventMode && story.events.length > 0;
    const layout = computeTimeLayout(
      story,
      this.zoom,
      orientation,
      expand,
      this.clockBlock(story),
      new Set(this.viewState()?.foldedTimes ?? []),
      eventMode ? { expanded: new Set(this.viewState()?.expandedEvents ?? []) } : undefined,
    );
    this.buckets = new Map(layout.buckets.map((b) => [b.id, b]));
    this.storySpan = { start: layout.storyStartBucket, end: layout.storyEndBucket };
    if (layout.tooLongToExpand) {
      // Said once per zoom, not on every redraw.
      const key = `${this.zoom}`;
      if (this.tooLongNoticed !== key) {
        this.tooLongNoticed = key;
        new Notice(`The whole timeline is more than ${MAX_EXPANDED_ROWS} rows at this zoom, so only times with cards are shown. Try a coarser zoom.`);
      }
    } else this.tooLongNoticed = null;

    if (layout.buckets.length === 0) {
      parent.createDiv({
        cls: "story-planner-empty story-planner-time-empty",
        text: "No dated scenes yet",
      });
    } else {
      const grid = this.spanGrid(
        parent,
        layout.bands ? "is-time has-acts" : "is-time",
        layout.rows,
        layout.columns,
        "plotLine",
        story.plotLines.map((p) => p.id),
        layout.laneTracks,
        layout.bands ? 2 : 1,
      );
      for (const placed of layout.items) this.place(placed, this.renderTimeItem(grid, placed.item, story));
      this.markFoldedLanes(grid);
    }
    this.renderTray(parent, story, layout.undated);
  }

  /** A date in the date column; its label stays in view while a tall span scrolls past. */
  /**
   * A span's date in the date column: one line, or, where its row is tall
   * enough, the year, month, day and time stacked (see fitTimeLabels).
   */
  private timeHeader(grid: HTMLElement, label: string, start?: number, date?: StoryDate): HTMLElement {
    const el = grid.createDiv({ cls: "story-planner-time-header" });
    if (start !== undefined) el.dataset.start = String(start);
    el.createSpan({ cls: "story-planner-time-label", text: label });
    const parts = date && this.story ? stackedDateParts(this.story, date) : [];
    if (parts.length > 1) {
      const stack = el.createDiv({ cls: "story-planner-time-stack" });
      stack.setAttr("aria-hidden", "true");
      for (const part of parts) stack.createDiv({ text: part });
      el.setAttr("title", label);
    }
    return el;
  }

  /** Stacks each date whose header has the height for all its lines; the rest stay on one line. Runs again when the board is resized. */
  private fitTimeLabels(): void {
    for (const el of Array.from(this.boardEl.querySelectorAll<HTMLElement>(".story-planner-time-header"))) {
      const stack = el.querySelector<HTMLElement>(":scope > .story-planner-time-stack");
      if (!stack) continue;
      const style = getComputedStyle(stack);
      const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.3 || 16;
      const padding = parseFloat(getComputedStyle(el).paddingTop) + parseFloat(getComputedStyle(el).paddingBottom);
      const fold = el.querySelector<HTMLElement>(":scope > .story-planner-fold-count")?.offsetHeight ?? 0;
      el.toggleClass("is-stacked", el.clientHeight - padding - fold >= stack.childElementCount * line);
    }
  }

  /**
   * How much time passes between two spans: a line across the board, with the
   * words in the date column, between the two dates.
   */
  private gap(grid: HTMLElement, text: string): HTMLElement {
    const el = grid.createDiv({ cls: "story-planner-time-gap" });
    el.createSpan({ cls: "story-planner-time-gap-label", text });
    return el;
  }

  /** A grid for story time or the character track, whose headers can span several slots. */
  private spanGrid(
    parent: HTMLElement,
    cls: string,
    rows: number,
    columns: number,
    kind: LaneKind,
    laneIds: string[],
    tracks?: number[],
    /** Header tracks before the lanes: the chapter or date column, and the act column when there is one. */
    lead = 1,
  ): HTMLElement {
    const orientation = this.orientation;
    const grid = parent.createDiv({ cls: `story-planner-grid ${cls} is-${orientation}`.replace("  ", " ") });
    grid.style.gridTemplateRows = `repeat(${rows}, auto)`;
    if (orientation === "horizontal") grid.style.gridTemplateColumns = `var(--story-planner-header-size) repeat(${columns - 1}, var(--story-planner-card-width))`;
    this.gridLanes.set(grid, { kind, ids: laneIds, tracks: tracks ?? laneIds.map(() => 1), lead });
    // Solid backgrounds behind the sticky header row and column, so cards
    // scrolling past never show between or beside the headers.
    grid.createDiv({ cls: "story-planner-sticky-column" });
    grid.createDiv({ cls: "story-planner-sticky-row" });
    this.sizeLanes(grid);
    return grid;
  }

  // -------------------------------------------------------------------------
  // Folding chapters and lanes, and lane widths. All of it is view state.

  private get foldedChapters(): Set<string | null> {
    return new Set((this.viewState()?.foldedChapters ?? []).map((id) => (id === "" ? null : id)));
  }

  /** Folds spans of story time, or unfolds them when they are all folded already. */
  private toggleTimeFold(ids: string[]): void {
    const folded = new Set(this.viewState()?.foldedTimes ?? []);
    const all = ids.every((id) => folded.has(id));
    for (const id of ids) {
      if (all) folded.delete(id);
      else folded.add(id);
    }
    this.setViewState({ foldedTimes: [...folded] });
  }

  private toggleChapterFold(chapterId: string | null): void {
    const key = chapterId ?? "";
    const folded = this.viewState()?.foldedChapters ?? [];
    this.setViewState({ foldedChapters: folded.includes(key) ? folded.filter((k) => k !== key) : [...folded, key] });
  }

  /** Folds every chapter, or unfolds them all when they are all folded already. */
  private toggleAllChapters(story: Story): void {
    const chapterIds = new Set(story.chapters.map((c) => c.id));
    const hasOffPage = Object.values(story.cards).some((c) => c.chapter === null || !chapterIds.has(c.chapter));
    const all = [...story.chapters.map((c) => c.id), ...(hasOffPage ? [""] : [])];
    const folded = new Set(this.viewState()?.foldedChapters ?? []);
    this.setViewState({ foldedChapters: all.every((k) => folded.has(k)) ? [] : all });
  }

  private foldedLanes(kind: LaneKind): Set<string> {
    const state = this.viewState();
    return new Set((kind === "plotLine" ? state?.foldedPlotLines : state?.foldedCharacters) ?? []);
  }

  private toggleLaneFold(kind: LaneKind, id: string): void {
    const folded = this.foldedLanes(kind);
    if (folded.has(id)) folded.delete(id);
    else folded.add(id);
    this.setViewState(kind === "plotLine" ? { foldedPlotLines: [...folded] } : { foldedCharacters: [...folded] });
  }

  private laneWidths(kind: LaneKind): Record<string, number> {
    const state = this.viewState();
    return (kind === "plotLine" ? state?.laneWidths : state?.characterLaneWidths) ?? {};
  }

  /** Sets a lane's width, or puts it back to the default with undefined. */
  private setLaneWidth(kind: LaneKind, id: string, width: number | undefined): void {
    const widths = { ...this.laneWidths(kind) };
    if (width === undefined) delete widths[id];
    else widths[id] = width;
    this.setViewState(kind === "plotLine" ? { laneWidths: widths } : { characterLaneWidths: widths });
  }

  /**
   * Sizes a grid's lanes: the width each was dragged to (or `live`, while one
   * is being dragged), and folded lanes as thin strips. Lanes are columns in
   * the vertical layout and rows in the horizontal one, where only folding applies.
   */
  private sizeLanes(grid: HTMLElement, live?: { id: string; width: number }): void {
    const lanes = this.gridLanes.get(grid);
    if (!lanes) return;
    const folded = this.foldedLanes(lanes.kind);
    const widths = this.laneWidths(lanes.kind);
    // A lane's extra tracks hold the thin bars of long cards; a folded lane keeps only its strip.
    const extra = (i: number, size: string) => Array.from({ length: (lanes.tracks[i] ?? 1) - 1 }, () => size);
    // The act column (a row, transposed) is narrow and comes before the chapter column.
    const headers = lanes.lead === 2 ? ["var(--story-planner-act-size)", "var(--story-planner-header-size)"] : ["var(--story-planner-header-size)"];
    if (this.orientation === "horizontal") {
      grid.style.gridTemplateRows = [
        ...(lanes.lead === 2 ? ["auto"] : []),
        "auto",
        ...lanes.ids.flatMap((id, i) => (folded.has(id) ? [FOLDED_LANE, ...extra(i, "0px")] : ["auto", ...extra(i, "var(--story-planner-run-width)")])),
      ].join(" ");
      return;
    }
    const width = (id: string) => (live?.id === id ? live.width : widths[id]);
    const sizes = lanes.ids.flatMap((id, i) =>
      folded.has(id)
        ? [FOLDED_LANE, ...extra(i, "0px")]
        : [width(id) ? `${width(id)}px` : "minmax(var(--story-planner-card-width), 1fr)", ...extra(i, "var(--story-planner-run-width)")],
    );
    grid.style.gridTemplateColumns = `${headers.join(" ")} ${sizes.join(" ")}`;
    const least = lanes.ids.flatMap((id, i) =>
      folded.has(id)
        ? [FOLDED_LANE]
        : [width(id) ? `${width(id)}px` : "var(--story-planner-card-width)", ...extra(i, "var(--story-planner-run-width)")],
    );
    grid.style.minWidth =
      least.length > 0
        ? `calc(${headers.join(" + ")} + ${least.join(" + ")} + ${least.length + headers.length - 1} * var(--size-4-2))`
        : "";
  }

  /**
   * Hairlines between the lanes, and across the board at the start of each
   * chapter or span after the first, so the grid reads at a glance. Acts
   * have their own, stronger line. Cards that run over several rows (events,
   * long cards) are drawn over the lines, and what sits on them over them.
   */
  private drawGridLines(grid: HTMLElement): void {
    this.liftSpanning(grid);
    const lanes = this.gridLanes.get(grid);
    if (!lanes) return;
    const vertical = this.orientation === "vertical";
    let line = lanes.lead + 1;
    lanes.ids.forEach((_, i) => {
      if (i > 0) {
        const el = createDiv({ cls: "story-planner-lane-line" });
        grid.prepend(el);
        if (vertical) {
          el.style.gridColumn = String(line);
          el.style.gridRow = "1 / -1";
        } else {
          el.style.gridRow = String(line);
          el.style.gridColumn = "1 / -1";
        }
      }
      line += lanes.tracks[i] ?? 1;
    });
    const rows = new Set<number>();
    for (const header of Array.from(grid.querySelectorAll<HTMLElement>(":scope > .story-planner-chapter-header, :scope > .story-planner-time-header"))) {
      if (header.hasClass("is-act-start")) continue;
      const at = parseInt(vertical ? header.style.gridRow : header.style.gridColumn, 10);
      // The first chapter or span sits right under the header row (line 2), which has its own line.
      if (at > 2) rows.add(at);
    }
    for (const at of rows) {
      const el = createDiv({ cls: "story-planner-row-line" });
      grid.prepend(el);
      if (vertical) {
        el.style.gridRow = String(at);
        el.style.gridColumn = "1 / -1";
      } else {
        el.style.gridColumn = String(at);
        el.style.gridRow = "1 / -1";
      }
    }
  }

  /**
   * Moves the cards that run over several rows to the end of the grid, and
   * then the ones on top of them, deepest last: on the same layer as the
   * lines between rows and acts, the later one is drawn on top. Every item
   * has its own grid position, so the order changes nothing else.
   */
  private liftSpanning(grid: HTMLElement): void {
    const spanning = Array.from(grid.querySelectorAll<HTMLElement>(":scope > .story-planner-event-card:not(.is-nested), :scope > .is-long:not(.is-nested)"));
    const nested = Array.from(grid.querySelectorAll<HTMLElement>(":scope > .is-nested"));
    nested.sort((a, b) => Number(a.style.getPropertyValue("--depth")) - Number(b.style.getPropertyValue("--depth")));
    for (const el of [...spanning, ...nested]) grid.appendChild(el);
  }

  /** Marks everything in a folded lane, so it shows as a thin strip. */
  private markFoldedLanes(grid: HTMLElement): void {
    this.drawGridLines(grid);
    const lanes = this.gridLanes.get(grid);
    if (!lanes) return;
    const folded = this.foldedLanes(lanes.kind);
    if (folded.size === 0) return;
    const vertical = this.orientation === "vertical";
    // Which lane each grid line belongs to, counting each lane's tracks.
    const laneAt: (string | undefined)[] = Array.from({ length: lanes.lead + 1 }, () => undefined);
    lanes.ids.forEach((id, i) => {
      for (let t = 0; t < (lanes.tracks[i] ?? 1); t++) laneAt.push(id);
    });
    for (const el of Array.from(grid.children) as HTMLElement[]) {
      const line = parseInt(vertical ? el.style.gridColumn : el.style.gridRow, 10);
      const id = laneAt[line];
      if (id && folded.has(id)) el.addClass("is-in-folded-lane");
    }
  }

  /** The fold button and the width handle on a lane's header. */
  private laneControls(header: HTMLElement, kind: LaneKind, id: string, name: string): void {
    const folded = this.foldedLanes(kind).has(id);
    const vertical = this.orientation === "vertical";
    header.toggleClass("is-folded", folded);
    header.setAttr("title", folded ? `${name} (folded)` : header.getAttr("title") ?? "");
    const fold = header.createEl("button", { cls: "story-planner-fold clickable-icon" });
    iconOr(
      fold,
      folded ? (vertical ? "unfold-horizontal" : "unfold-vertical") : vertical ? "fold-horizontal" : "fold-vertical",
      folded ? (vertical ? "chevrons-left-right" : "chevrons-up-down") : vertical ? "chevrons-right-left" : "chevrons-down-up",
    );
    fold.setAttr("title", folded ? `Unfold ${name}` : `Fold ${name}`);
    fold.setAttr("aria-label", folded ? `Unfold ${name}` : `Fold ${name}`);
    stopBoardGestures(fold);
    fold.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleLaneFold(kind, id);
    });
    if (!vertical || folded) return;

    const handle = header.createDiv({ cls: "story-planner-resize" });
    handle.setAttr("aria-label", "Resize");
    stopBoardGestures(handle);
    handle.addEventListener("dblclick", () => this.setLaneWidth(kind, id, undefined));
    handle.addEventListener("pointerdown", (down) => {
      if (down.button !== 0) return;
      const grid = header.closest<HTMLElement>(".story-planner-grid");
      if (!grid) return;
      down.preventDefault();
      handle.setPointerCapture(down.pointerId);
      handle.addClass("is-active");
      const start = header.getBoundingClientRect().width;
      let width = Math.round(start);
      const move = (e: PointerEvent) => {
        width = Math.max(MIN_LANE_WIDTH, Math.round(start + e.clientX - down.clientX));
        this.sizeLanes(grid, { id, width });
      };
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        handle.removeClass("is-active");
        if (Math.abs(width - start) >= 1) this.setLaneWidth(kind, id, width);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
  }

  /** The fold button on a chapter's header, and the number of scenes while it is folded. */
  private chapterControls(header: HTMLElement, chapterId: string | null, story: Story): void {
    const folded = this.foldedChapters.has(chapterId);
    header.toggleClass("is-folded", folded);
    const fold = header.createEl("button", { cls: "story-planner-fold clickable-icon" });
    setIcon(fold, folded ? "chevron-right" : "chevron-down");
    fold.setAttr("aria-label", folded ? "Unfold this chapter" : "Fold this chapter");
    fold.setAttr("title", folded ? "Unfold this chapter" : "Fold this chapter");
    header.prepend(fold);
    stopBoardGestures(fold);
    fold.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleChapterFold(chapterId);
    });
    if (folded) {
      const chapterIds = new Set(story.chapters.map((c) => c.id));
      const count = Object.values(story.cards).filter((c) =>
        chapterId === null ? c.chapter === null || !chapterIds.has(c.chapter) : c.chapter === chapterId,
      ).length;
      header.createSpan({ cls: "story-planner-fold-count", text: `${count} ${count === 1 ? "scene" : "scenes"}` });
    }
  }

  /** Puts an item on a span grid: a header covers its slots, and a gap marker runs across every lane. */
  private place(placed: { item: { kind: string }; row: number; column: number; span: number; cross?: number; depth?: number }, el: HTMLElement): void {
    const vertical = this.orientation === "vertical";
    // On top of a long card: drawn a step in, so the long card's edge shows.
    if (placed.depth) {
      el.addClass("is-nested");
      el.style.setProperty("--depth", String(Math.min(placed.depth, 3)));
    }
    const along = placed.span > 1 ? ` / span ${placed.span}` : "";
    const across = (placed.cross ?? 1) > 1 ? ` / span ${placed.cross}` : "";
    if (placed.item.kind === "gap") {
      // Across the board from the date column on, so its words sit beside the dates (not in a year or month column).
      const lead = this.gridLanes.get(el.parentElement as HTMLElement)?.lead ?? 1;
      el.style.gridRow = vertical ? String(placed.row) : `${lead} / -1`;
      el.style.gridColumn = vertical ? `${lead} / -1` : String(placed.column);
    } else {
      el.style.gridRow = String(placed.row) + (vertical ? along : across);
      el.style.gridColumn = String(placed.column) + (vertical ? across : along);
    }
  }

  private renderTimeItem(grid: HTMLElement, item: TimeItem, story: Story): HTMLElement {
    switch (item.kind) {
      case "corner":
      case "lane-header":
      case "event-card":
      case "event-echo":
        return this.renderItem(grid, item, story);

      case "time-header": {
        const el = this.timeHeader(grid, item.bucket.label, item.bucket.start, item.bucket.date);
        // The story's own start and end, marked lightly on the whole timeline.
        if (item.bucket.id === this.storySpan.start) el.addClass("is-story-start");
        if (item.bucket.id === this.storySpan.end) el.addClass("is-story-end");
        // Its fold button, and its count while folded, as a chapter's on the board.
        const id = item.bucket.id;
        el.toggleClass("is-folded", !!item.folded);
        const fold = el.createEl("button", { cls: "story-planner-fold clickable-icon" });
        setIcon(fold, item.folded ? "chevron-right" : "chevron-down");
        fold.setAttr("aria-label", item.folded ? "Unfold" : "Fold");
        fold.setAttr("title", item.folded ? "Unfold" : "Fold");
        el.prepend(fold);
        stopBoardGestures(fold);
        fold.addEventListener("click", (e) => {
          e.stopPropagation();
          this.toggleTimeFold([id]);
        });
        if (item.folded) el.createSpan({ cls: "story-planner-fold-count", text: `${item.count ?? 0} ${item.count === 1 ? "card" : "cards"}` });
        return el;
      }

      case "gap":
        return this.gap(grid, item.text);

      case "time-band": {
        // The year, month or day the spans beside it are in, like an act on the board.
        const el = grid.createDiv({ cls: "story-planner-act-band story-planner-time-band" });
        if (!item.label) {
          el.addClass("is-empty");
          return el;
        }
        const folded = new Set(this.viewState()?.foldedTimes ?? []);
        const allFolded = item.bucketIds.every((b) => folded.has(b));
        const fold = el.createEl("button", { cls: "story-planner-fold clickable-icon" });
        setIcon(fold, allFolded ? "chevron-right" : "chevron-down");
        fold.setAttr("aria-label", allFolded ? "Unfold all of these" : "Fold all of these");
        fold.setAttr("title", allFolded ? "Unfold all of these" : "Fold all of these");
        stopBoardGestures(fold);
        fold.addEventListener("click", (e) => {
          e.stopPropagation();
          this.toggleTimeFold(item.bucketIds);
        });
        el.createDiv({ cls: "story-planner-act-label" }).createSpan({ cls: "story-planner-act-number", text: item.label });
        el.setAttr("title", item.label);
        return el;
      }

      case "time-folded": {
        const el = grid.createDiv({ cls: "story-planner-folded-cell", text: item.count > 0 ? `${item.count} ${item.count === 1 ? "card" : "cards"}` : "" });
        el.addEventListener("dblclick", () => this.toggleTimeFold([item.bucketId]));
        return el;
      }

      case "time-cell": {
        const el = grid.createDiv({ cls: "story-planner-cell" });
        if (item.end) el.addClass("is-end");
        // An empty cell beside a card in another plot line: the edges put a dropped card
        // before or after that card in the order, the middle beside it, in its row.
        const rowCard = item.rowCardId ? story.cards[item.rowCardId] : undefined;
        if (rowCard) this.makeDropTarget(el, "card", "slot", (place) => this.dropInTime(item.bucketId, item.plotLineId, rowCard, place, true), true);
        else this.makeDropTarget(el, "card", null, () => this.dropInTime(item.bucketId, item.plotLineId, null, "on"));
        this.echoLane(el, item.plotLineId);
        // Double-click creates an off-page event at this time; it can be given a chapter later.
        el.addEventListener("dblclick", () => {
          const bucket = this.buckets.get(item.bucketId);
          if (!bucket) return;
          if (this.showingEvents) {
            this.newEvent({ plotLine: item.plotLineId, date: bucket.date });
            return;
          }
          let id: Id | null = null;
          this.mutate((s) => {
            id = addCardAt(s, { chapter: null, plotLine: item.plotLineId });
            setCardDate(s, id, "date", { ...bucket.date });
            placeLastInTime(s, id);
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
        // A long card runs on down to the span its end date falls in, with its end at the bottom.
        if (item.until && card.endDate) {
          el.addClass("is-long");
          el.createDiv({ cls: "story-planner-long-end", text: `until ${formatStoryDate(story, card.endDate)}` });
        }
        el.addEventListener("dblclick", () => this.editTitleInPlace(el, card));
        this.makeDropTarget(el, "card", "slot", (place) => this.dropInTime(item.bucketId, card.plotLine, card, place));
        this.echoLane(el, card.plotLine);
        return el;
      }

      case "echo": {
        const card = story.cards[item.cardId]!;
        const home = story.plotLines.find((p) => p.id === card.plotLine);
        const el = grid.createDiv({ cls: "story-planner-echo", text: echoText(card) });
        el.style.setProperty("--lane-color", plotLineColor(story, home) ?? "var(--interactive-accent)");
        el.setAttr("aria-label", `Also in ${home?.name ?? "another plot line"}`);
        if (item.until) el.addClass("is-long");
        if (this.highlighted(card, story) === false) el.addClass("is-dimmed");
        el.addEventListener("click", () => this.select(card.id));
        this.makeDropTarget(el, "card", null, () => this.dropInTime(item.bucketId, item.plotLineId, null, "on"));
        this.echoLane(el, item.plotLineId);
        return el;
      }
    }
  }

  /** A card as story time shows it: its time, and a badge with its chapter so reading order stays in view. */
  private timeCard(parent: HTMLElement, card: Card, story: Story): HTMLElement {
    const plotLine = story.plotLines.find((p) => p.id === card.plotLine);
    const chapter = story.chapters.find((c) => c.id === card.chapter);
    const el = parent.createDiv({ cls: "story-planner-card" });
    if (!chapter) el.addClass("is-off-page");
    el.style.setProperty("--lane-color", plotLineColor(story, plotLine) ?? "var(--interactive-accent)");
    this.writtenToggle(el, card);
    if (this.shows("chapter")) el.createDiv({ cls: "story-planner-card-badge", text: this.chapterBadge(story, card) });
    this.cardTitle(el, card);
    if (card.date && this.shows("date")) {
      const when = el.createDiv({ cls: "story-planner-card-date", text: this.timeLabel(card, story) });
      const local = formatDateRange(story, card.date, card.endDate);
      if (when.textContent !== local) when.setAttr("title", `Local: ${local}`);
      if (this.shiftedDay(card, story)) when.addClass("is-shifted");
    }
    if (card.synopsis && this.shows("synopsis")) el.createDiv({ cls: "story-planner-card-synopsis", text: card.synopsis });
    this.cardExtras(el, card, story);
    el.dataset.cardId = card.id;
    el.addEventListener("click", (e) => this.clickCard(e, card.id));
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
  private dropInTime(bucketId: string, plotLine: Id, target: Card | null, place: DropPlace, inRow = false): void {
    const story = this.story;
    const bucket = this.buckets.get(bucketId);
    const card = story && this.dragged ? story.cards[this.dragged.id] : undefined;
    if (!story || !bucket || !card) return;
    if (card === target) {
      // Beside itself, in another plot line's cell of its own row: only the plot line changes.
      if (!inRow) return;
      target = null;
      place = "before";
    }

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
    const current = bucketDate(mainCalendar(story), referenceDate(story, card)!, this.zoom, this.clockBlock(story));
    if (JSON.stringify(current) === bucketId) {
      // Cards at the same moment keep the writer's order; cards at different
      // moments in one span are in the order of their times.
      const sameMoment = (other: Card) => {
        const a = cardMoment(story, card)!;
        const b = cardMoment(story, other)!;
        return a.key === b.key && a.precision === b.precision;
      };
      if (target && (place !== "on" || inRow) && !sameMoment(target)) {
        new Notice(
          `"${echoText(card)}" (${formatStoryDate(story, card.date)}) and "${echoText(target)}" (${formatStoryDate(story, target.date!)}) are in the order of their times. Change a time to reorder them.`,
        );
      }
      // Into the plot line it was dropped in, and in the writer's order as the drop says (see dropWithinSpan).
      const targetId = target?.id ?? null;
      this.mutate((s) => dropWithinSpan(s, card.id, plotLine, targetId, place) !== "none");
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

  /** Whether this tab is about organizations rather than characters. */
  private get ofOrgs(): boolean {
    return this.tab === "organizations";
  }

  /** The Characters and Organizations views show the track or the profiles; the presence matrix is set aside for now. */
  private get characterMode(): "track" | "profiles" {
    const mode = this.ofOrgs ? this.viewState()?.orgMode : this.viewState()?.characterMode;
    return mode === "profiles" ? "profiles" : "track";
  }

  private get characterAxis(): TrackAxis {
    return this.viewState()?.characterAxis ?? "chapters";
  }

  /** The characters (or organizations) shown as lanes; until the writer chooses, the first eight. */
  private lanes(story: Story): Id[] {
    const pool = this.ofOrgs ? story.organizations : story.characters;
    const chosen = this.ofOrgs ? this.viewState()?.orgLanes : this.viewState()?.characterLanes;
    if (!chosen) return pool.slice(0, 8).map((c) => c.id);
    return chosen.filter((id) => pool.some((c) => c.id === id));
  }

  private setLanes(lanes: Id[]): void {
    this.setViewState(this.ofOrgs ? { orgLanes: lanes } : { characterLanes: lanes });
  }

  private characterActions(actions: HTMLElement, story: Story): void {
    // Track or profiles: one square button showing the view it switches to.
    const toProfiles = this.characterMode === "track";
    this.toolIcon(actions, toProfiles ? "contact" : "columns-3", toProfiles ? "Show the profiles" : "Show the track", () =>
      this.setViewState(this.ofOrgs ? { orgMode: toProfiles ? "profiles" : "track" } : { characterMode: toProfiles ? "profiles" : "track" }),
    );
    this.toolIcon(actions, "square-plus", "New event", () => this.newEvent());
    if (this.characterMode === "profiles") return;
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
    const lanes = this.lanes(story);
    const what = this.ofOrgs ? "Organizations" : "Characters";
    // Which of them are lanes: a square button with how many there are.
    const pick = this.toolIcon(actions, this.ofOrgs ? "landmark" : "user-plus", `${what} to track (${lanes.length})`, () =>
      new LaneModal(this.app, story, lanes, (chosen) => this.setLanes(chosen), this.ofOrgs ? "organizations" : "characters").open(),
    );
    pick.createSpan({ cls: "story-planner-tool-badge", text: String(lanes.length) });
    if (lanes.length >= 2) {
      const on = !!this.viewState()?.sharedOnly;
      this.toolIcon(actions, "link-2", on ? "Only scenes they share (click for all)" : "Only scenes they share", () => this.setViewState({ sharedOnly: !on }), on);
    }
    this.highlightPicker(actions, story);
  }

  private fillCharacters(parent: HTMLElement, story: Story): void {
    if (this.characterMode === "profiles") {
      this.profiles.render(parent, story, this.ofOrgs ? "organization" : "character");
      return;
    }
    if (this.ofOrgs) {
      if (story.organizations.length === 0) {
        parent.createDiv({ cls: "story-planner-empty", text: "No organizations yet. Add them in the profiles, or name them on a card." });
        return;
      }
      this.fillTrack(parent, story, []);
      return;
    }
    if (story.characters.length === 0) {
      parent.createDiv({
        cls: "story-planner-empty",
        text: "No characters yet. Add them in Setup, or name them on a card, to follow them here.",
      });
      return;
    }
    const clashes = findClashes(story);
    if (clashes.length > 0) {
      const note = parent.createDiv({ cls: "story-planner-clash-summary" });
      note.createSpan({ text: `${clashes.length} possible ${clashes.length === 1 ? "clash" : "clashes"}: a character in two places at once.` });
    }
    this.fillTrack(parent, story, clashes);
  }

  private fillTrack(parent: HTMLElement, story: Story, clashes: Clash[]): void {
    const lanes = this.lanes(story);
    if (lanes.length === 0) {
      parent.createDiv({ cls: "story-planner-empty", text: this.ofOrgs ? "No organizations tracked" : "No characters tracked" });
      return;
    }
    const axis = this.characterAxis;
    const shared = !!this.viewState()?.sharedOnly && lanes.length >= 2;
    const layout = computeTrackLayout(story, lanes, axis, this.zoom, this.orientation, shared, this.ofOrgs ? "organizations" : "characters");
    this.buckets = new Map(layout.buckets.map((b) => [b.id, b]));
    const clashing = new Set(clashes.flatMap((c) => c.cards.map((id) => `${c.characterId}:${id}`)));

    if (axis === "time" && layout.buckets.length === 0) {
      parent.createDiv({
        cls: "story-planner-empty story-planner-time-empty",
        text: "No dated scenes yet",
      });
    } else {
      const grid = this.spanGrid(parent, "is-track", layout.rows, layout.columns, "character", lanes);
      for (const placed of layout.items) this.place(placed, this.renderTrackItem(grid, placed.item, story, clashing));
      this.markFoldedLanes(grid);
    }

    const notes: string[] = [];
    if (layout.hidden > 0) {
      notes.push(
        shared
          ? `${layout.hidden} ${layout.hidden === 1 ? "scene does" : "scenes do"} not have all of these ${this.ofOrgs ? "organizations" : "characters"}.`
          : `${layout.hidden} ${layout.hidden === 1 ? "scene has" : "scenes have"} none of these ${this.ofOrgs ? "organizations" : "characters"}.`,
      );
    }
    if (axis === "time") {
      const ids = new Set(lanes);
      const undated = Object.values(story.cards).filter((c) => !c.date && (this.ofOrgs ? (c.orgs ?? []).some((x) => ids.has(x.id)) : c.characters.some((x) => ids.has(x.id)))).length;
      if (undated > 0) notes.push(`${undated} undated ${undated === 1 ? "scene is" : "scenes are"} left out.`);
    }
    if (notes.length > 0) parent.createDiv({ cls: "story-planner-panel-hint story-planner-track-note", text: notes.join(" ") });
  }

  private renderTrackItem(grid: HTMLElement, item: TrackItem, story: Story, clashing: Set<string>): HTMLElement {
    switch (item.kind) {
      case "corner":
        return grid.createDiv({ cls: "story-planner-corner" });

      case "character-header": {
        const character = (this.ofOrgs ? story.organizations : story.characters).find((c) => c.id === item.characterId);
        const el = grid.createDiv({ cls: "story-planner-lane-header is-character" });
        el.createSpan({ cls: "story-planner-lane-name", text: character?.name ?? "" });
        el.style.setProperty("--lane-color", character?.color ?? "var(--interactive-accent)");
        this.laneControls(el, "character", item.characterId, character?.name ?? "this character");
        this.makeDraggable(el, { kind: "character", id: item.characterId });
        this.makeDropTarget(el, "character", "lane", (place) => {
          const lanes = this.lanes(story).filter((id) => id !== this.dragged!.id);
          const index = lanes.indexOf(item.characterId);
          lanes.splice(place === "after" ? index + 1 : index, 0, this.dragged!.id);
          this.setLanes(lanes);
        });
        return el;
      }

      case "chapter-header": {
        const chapter = story.chapters.find((c) => c.id === item.chapterId);
        const el = grid.createDiv({ cls: "story-planner-chapter-header", text: chapterTitle(story, chapter) });
        if (!chapter) el.addClass("is-off-page");
        else {
          if (chapter.summary?.trim()) el.setAttr("title", chapter.summary);
          el.addEventListener("dblclick", () => this.editChapter(chapter.id));
        }
        return el;
      }

      case "time-header":
        return this.timeHeader(grid, item.bucket.label, item.bucket.start);

      case "gap":
        return this.gap(grid, item.text);

      case "track-cell": {
        const el = grid.createDiv({ cls: "story-planner-cell" });
        if (item.end) el.addClass("is-end");
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
    // In an organization's lane, involved reads as present.
    const org = this.ofOrgs ? card.orgs?.find((o) => o.id === characterId) : undefined;
    const entry: { id: Id; role: CharacterRole; note?: string } = org
      ? { id: org.id, role: org.role === "mentioned" ? "mentioned" : "present" }
      : card.characters.find((c) => c.id === characterId)!;
    const plotLine = story.plotLines.find((p) => p.id === card.plotLine);
    const chapter = story.chapters.find((c) => c.id === card.chapter);
    const el = parent.createDiv({ cls: `story-planner-card story-planner-appearance role-${entry.role}` });
    if (!chapter) el.addClass("is-off-page");
    el.style.setProperty("--lane-color", plotLineColor(story, plotLine) ?? "var(--interactive-accent)");
    this.writtenToggle(el, card);
    if (this.characterAxis === "time" && this.shows("chapter")) el.createDiv({ cls: "story-planner-card-badge", text: this.chapterBadge(story, card) });
    const role = el.createDiv({ cls: "story-planner-appearance-role" });
    const subject = (this.ofOrgs ? story.organizations : story.characters).find((c) => c.id === entry.id);
    role.createSpan({ cls: `story-planner-presence role-${entry.role}` }).style.setProperty("--lane-color", subject?.color ?? "var(--text-normal)");
    role.createSpan({ text: org ? (org.role === "mentioned" ? "Mentioned" : "Involved") : ROLE_LABELS[entry.role] });
    this.cardTitle(el, card);
    if (entry.note) el.createDiv({ cls: "story-planner-card-note", text: entry.note });
    if (card.date && this.shows("date")) el.createDiv({ cls: "story-planner-card-date", text: formatDateRange(story, card.date, card.endDate) });
    if (card.synopsis && this.shows("synopsis")) el.createDiv({ cls: "story-planner-card-synopsis", text: card.synopsis });
    this.cardExtras(el, card, story, false);
    if (clash) {
      el.addClass("has-clash");
      el.createDiv({ cls: "story-planner-clash-mark", text: "In two places at once?" });
    }
    el.dataset.cardId = card.id;
    el.addEventListener("click", (e) => this.clickCard(e, card.id));
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
    if (this.ofOrgs) {
      const org = story.organizations.find((o) => o.id === characterId);
      if (org && !card.orgs?.some((o) => o.id === characterId)) {
        new ChoiceModal(this.app, {
          title: `Add ${org.name} to "${echoText(card)}"?`,
          message: `Dropping a scene in ${org.name}'s lane adds ${org.name} to it. How does it take part?`,
          options: [
            { value: "involved", label: "Involved" },
            { value: "mentioned", label: "Mentioned" },
          ],
          confirm: "Add",
          safe: true,
          onChoose: (role) => this.mutate((s) => setCardOrg(s, card.id, org.id, role as OrgRole)),
        }).open();
        return;
      }
    }
    const character = story.characters.find((c) => c.id === characterId);
    if (!character && !this.ofOrgs) return;

    if (character && !card.characters.some((c) => c.id === characterId)) {
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
    const org = story?.organizations.find((o) => o.id === characterId);
    if (!story || (!character && !org)) return;
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
        id = addCardAt(s, { chapter: null, plotLine });
        setCardDate(s, id, "date", { ...bucket.date });
      } else {
        // The new scene gets its own row, just after the row it was made in.
        id = addCardAt(s, row ? { chapter: row.chapter, plotLine, afterCardId: row.id } : { chapter: cell.chapterId ?? null, plotLine });
      }
      if (character) addCharacterByName(s, id, character.name, "present");
      else if (org) setCardOrg(s, id, org.id, "involved");
    });
    if (id) {
      this.select(id);
      this.panel.focusTitle();
    }
  }

  private fillMatrix(parent: HTMLElement, story: Story, clashes: Clash[], of: "characters" | "organizations" = "characters"): void {
    const axis = this.characterAxis;
    const matrix = computeMatrix(story, axis, this.zoom, of);
    const wrap = parent.createDiv({ cls: "story-planner-matrix-wrap" });
    if (matrix.columns.length === 0) {
      wrap.createDiv({
        cls: "story-planner-empty",
        text: axis === "time" ? "No dated scenes yet" : "No chapters yet",
      });
    } else {
      // The legend uses the same marks as the cells: a square, a dot and a ring, each a different size.
      const legend = wrap.createDiv({ cls: "story-planner-panel-hint story-planner-matrix-legend" });
      for (const role of of === "organizations" ? (["present", "mentioned"] as const) : (["pov", "present", "mentioned"] as const)) {
        const item = legend.createSpan({ cls: "story-planner-legend-item" });
        item.createSpan({ cls: `story-planner-presence role-${role}` });
        item.createSpan({ text: of === "organizations" && role === "present" ? "involved" : ROLE_LABELS[role].toLowerCase() });
      }
      const table = wrap.createEl("table", { cls: "story-planner-matrix" });
      const thead = table.createEl("thead");
      // With acts, a row of them above the chapters, each across its chapters.
      if (matrix.columns.some((c) => c.act !== undefined)) {
        const acts = thead.createEl("tr", { cls: "story-planner-matrix-acts" });
        acts.createEl("th", { cls: "story-planner-matrix-corner" });
        let i = 0;
        while (i < matrix.columns.length) {
          const act = matrix.columns[i]!.act;
          let span = 1;
          while (i + span < matrix.columns.length && matrix.columns[i + span]!.act === act) span++;
          const th = acts.createEl("th", { attr: { colspan: String(span) } });
          const found = act ? story.acts.find((a) => a.id === act) : undefined;
          if (found) {
            th.setText(actTitle(story, found));
            th.setAttr("title", [actTitle(story, found), found.summary?.trim()].filter(Boolean).join("\n\n"));
          }
          i += span;
        }
        acts.createEl("th");
      }
      const head = thead.createEl("tr");
      head.createEl("th", { cls: "story-planner-matrix-corner" });
      for (const column of matrix.columns) head.createEl("th", { text: column.label, attr: { title: column.title ?? column.label } });
      head.createEl("th", { text: "Scenes" });
      const body = table.createEl("tbody");
      for (const row of matrix.rows) {
        const character = (of === "organizations" ? story.organizations : story.characters).find((c) => c.id === row.characterId)!;
        const tr = body.createEl("tr");
        if (row.total === 0) tr.addClass("is-absent");
        const name = tr.createEl("th", { cls: "story-planner-matrix-name", text: character.name });
        name.style.setProperty("--lane-color", character.color);
        name.setAttr("title", `Open ${character.name}'s profile`);
        name.addEventListener("click", () =>
          this.setViewState(of === "organizations" ? { orgMode: "profiles", orgProfileId: character.id } : { characterMode: "profiles", profileId: character.id }),
        );
        row.cells.forEach((cell, i) => {
          const td = tr.createEl("td");
          if (!cell.role) return;
          td.addClass(`role-${cell.role}`);
          const mark = td.createSpan({ cls: `story-planner-presence role-${cell.role}` });
          mark.style.setProperty("--lane-color", character.color);
          if (cell.cards.length > 1) td.createSpan({ cls: "story-planner-matrix-count", text: String(cell.cards.length) });
          const titles = cell.cards.map((id) => story.cards[id]?.title ?? "").join(", ");
          const clash = cell.clashes.length > 0 ? ". Possibly in two places at once." : "";
          const roleWord = of === "organizations" ? (cell.role === "mentioned" ? "mentioned" : "involved") : ROLE_LABELS[cell.role].toLowerCase();
          td.setAttr("title", `${character.name} in ${matrix.columns[i]!.title ?? matrix.columns[i]!.label}, ${roleWord}: ${titles}${clash}`);
          if (clash) td.addClass("has-clash");
          // A click opens the first scene, or the first one with a clash.
          td.addEventListener("click", () => this.select(cell.clashes[0] ?? cell.cards[0]!));
        });
        tr.createEl("td", { cls: "story-planner-matrix-total", text: String(row.total) });
      }
    }
    if (of === "characters") this.renderClashes(wrap, story, clashes);
  }

  /** The list of possible clashes, under the matrix. Advisory only: a story may mean it. */
  private renderClashes(parent: HTMLElement, story: Story, clashes: Clash[]): void {
    const box = parent.createDiv({ cls: "story-planner-clashes" });
    box.createDiv({ cls: "story-planner-tray-heading", text: clashes.length > 0 ? `Possible clashes (${clashes.length})` : "No clashes" });
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

  /** A plain icon button, such as Undo, with its name as a tooltip. */
  private iconAction(parent: HTMLElement, icon: string, label: string, onClick: () => void, disabled = false): HTMLButtonElement {
    const el = parent.createEl("button", { cls: "story-planner-icon-action clickable-icon" });
    setIcon(el, icon);
    el.setAttr("aria-label", label);
    el.setAttr("title", label);
    el.disabled = disabled;
    el.addEventListener("click", onClick);
    return el;
  }

  /** A square icon button for the tab bar, with its name as a tooltip; a toggle shows when it is on. */
  private toolIcon(parent: HTMLElement, icon: string, label: string, onClick: () => void, active?: boolean): HTMLButtonElement {
    const el = parent.createEl("button", { cls: "story-planner-tool clickable-icon" });
    iconOr(el, icon, "circle");
    el.setAttr("aria-label", label);
    el.setAttr("title", label);
    if (active !== undefined) {
      el.toggleClass("is-active", active);
      el.setAttr("aria-pressed", String(active));
    }
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
      /** Where the pointer is and which keys are held, kept for scrolling at the edge and for key presses alone. */
      let pointer = { clientX: startX, clientY: startY };
      let keys = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
      let echo = false;
      let frame = 0;
      // Holding one of several selected cards drags them all.
      const many = dragged.kind === "card" && this.multi.size >= 2 && this.multi.has(dragged.id) ? [...this.multi] : null;
      const label = many ? `${many.length} cards` : (el.innerText.split("\n")[0] ?? "");

      const clearMark = () => target?.el.removeClass("is-drop-target", "is-drop-before", "is-drop-after", "is-drop-echo");

      /** Finds and marks what is under the pointer; shows when the drop will be an echo. */
      const update = () => {
        if (!ghost) return;
        clearMark();
        // An event card is dropped where a card could be: what matters is the plot line there.
        target = this.dropTargetAt(pointer.clientX, pointer.clientY, dragged.kind === "event" ? "card" : dragged.kind);
        // Ctrl+Alt (Cmd+Alt) keeps an off-page event off-page, in the background of the chapter it lands in.
        const background = dragged.kind === "card" && (keys.ctrlKey || keys.metaKey) && keys.altKey && this.story?.cards[dragged.id]?.chapter === null;
        this.backgroundDrop = background;
        echo = dragged.kind === "card" && !background && this.echoKeyHeld(keys) && !!target?.spec.plotLine;
        ghost.setText(echo ? `${label}  ＋ echo` : background ? `${label}  ⋯ background` : label);
        ghost.toggleClass("is-echo", echo);
        this.contentEl.toggleClass("is-echo-drag", echo);
        if (target) {
          place = this.dropPlace(pointer, target.el, target.spec);
          target.el.addClass(echo ? "is-drop-echo" : place === "on" ? "is-drop-target" : place === "after" ? "is-drop-after" : "is-drop-before");
        }
      };

      /**
       * Near an edge of the board, with more board beyond it, scrolls that way:
       * faster the nearer the pointer is to the edge. Runs every frame while
       * the pointer stays there, and keeps the drop target up to date.
       */
      const edgeScroll = () => {
        frame = 0;
        if (!ghost || !dragged || dragged.kind !== "card") return;
        const board = this.boardEl;
        const r = board.getBoundingClientRect();
        const speed = (distance: number) => Math.ceil(EDGE_SPEED * Math.min(1, (EDGE_ZONE - distance) / EDGE_ZONE));
        let dx = 0;
        let dy = 0;
        const { clientX: x, clientY: y } = pointer;
        const inRows = y > r.top - EDGE_ZONE && y < r.bottom + EDGE_ZONE;
        const inColumns = x > r.left - EDGE_ZONE && x < r.right + EDGE_ZONE;
        if (inRows && x < r.left + EDGE_ZONE && board.scrollLeft > 0) dx = -speed(Math.max(0, x - r.left));
        else if (inRows && x > r.right - EDGE_ZONE && board.scrollLeft < board.scrollWidth - board.clientWidth) dx = speed(Math.max(0, r.right - x));
        if (inColumns && y < r.top + EDGE_ZONE && board.scrollTop > 0) dy = -speed(Math.max(0, y - r.top));
        else if (inColumns && y > r.bottom - EDGE_ZONE && board.scrollTop < board.scrollHeight - board.clientHeight) dy = speed(Math.max(0, r.bottom - y));
        if (dx === 0 && dy === 0) return;
        board.scrollBy(dx, dy);
        update();
        frame = requestAnimationFrame(edgeScroll);
      };

      const onMove = (ev: PointerEvent) => {
        if (!ghost) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
          this.dragged = dragged;
          this.draggedMany = many;
          ghost = document.body.createDiv({ cls: "story-planner-drag-ghost", text: label });
          el.addClass("is-dragging");
          if (many) for (const other of Array.from(this.boardEl.querySelectorAll<HTMLElement>(".story-planner-card[data-card-id]"))) if (many.includes(other.dataset.cardId!)) other.addClass("is-dragging");
          this.contentEl.addClass("is-drag-active");
        }
        ev.preventDefault();
        ghost.style.left = `${ev.clientX + 12}px`;
        ghost.style.top = `${ev.clientY + 12}px`;
        pointer = { clientX: ev.clientX, clientY: ev.clientY };
        keys = ev;
        update();
        if (!frame) frame = requestAnimationFrame(edgeScroll);
      };

      const finish = (drop: boolean) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("keyup", onKeyUp, true);
        cancelAnimationFrame(frame);
        frame = 0;
        this.cancelDrag = () => {};
        clearMark();
        el.removeClass("is-dragging");
        for (const other of Array.from(this.boardEl.querySelectorAll<HTMLElement>(".is-dragging"))) other.removeClass("is-dragging");
        this.contentEl.removeClass("is-drag-active", "is-echo-drag");
        if (ghost) {
          ghost.remove();
          // The click that follows a drag must not open the card editor.
          this.suppressClick = true;
          window.setTimeout(() => (this.suppressClick = false), 0);
          if (drop && target) {
            if (dragged.kind === "event") {
              const plotLine = target.spec.plotLine;
              if (plotLine) this.mutate((s) => setEventPlotLine(s, dragged.id, plotLine));
            } else if (echo && target.spec.plotLine) this.dropAsEcho(dragged.id, target.spec.plotLine);
            else if (many && target.spec.board) {
              const { target: at, background } = target.spec.board(place);
              this.mutate((s) => moveCardsTo(s, many, dragged.id, at, !!background));
            } else target.spec.onDrop(place);
          }
        }
        this.dragged = null;
        this.draggedMany = null;
        this.backgroundDrop = false;
      };
      const onUp = (ev: PointerEvent) => {
        keys = ev;
        if (ghost) update();
        finish(true);
      };
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === "Escape") {
          ev.stopPropagation();
          finish(false);
          return;
        }
        // Pressing or letting go of the echo key alone changes the drop at once.
        keys = ev;
        if (ghost) {
          if (ev.key === "Alt") ev.preventDefault(); // keeps Alt from moving focus to the window menu
          update();
        }
      };
      const onKeyUp = (ev: KeyboardEvent) => {
        keys = ev;
        if (ghost) update();
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("keyup", onKeyUp, true);
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
    const spec: DropTargetSpec = { accepts, axis, middle, onDrop };
    // One element can take two kinds of things, such as a scene or an event on an event's row.
    const existing = this.dropTargets.get(el);
    if (existing && existing.accepts !== accepts) existing.also = spec;
    else this.dropTargets.set(el, spec);
  }

  private dropTargetAt(x: number, y: number, kind: Dragged["kind"]): { el: HTMLElement; spec: DropTargetSpec } | null {
    // The pointer can sit in the gap between grid cells; look a few pixels
    // around it so there is no dead space between targets.
    for (const [dx, dy] of GAP_PROBES) {
      for (let node = document.elementFromPoint(x + dx, y + dy); node && node !== this.contentEl; node = node.parentElement) {
        const spec = this.dropTargets.get(node as HTMLElement);
        if (spec) {
          if (spec.accepts === kind) return { el: node as HTMLElement, spec };
          if (spec.also?.accepts === kind) return { el: node as HTMLElement, spec: spec.also };
          break;
        }
      }
    }
    return null;
  }

  private dropPlace(e: { clientX: number; clientY: number }, el: HTMLElement, spec: DropTargetSpec): DropPlace {
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
        this.mutate((s) => {
          const id = this.dragged!.id;
          // An off-page event dropped among a chapter's scenes stays off-page, in the chapter's background.
          if (this.backgroundDrop && s.cards[id]?.chapter === null && target.chapter !== null) return moveToChapter(s, id, true, { chapter: target.chapter, plotLine });
          const moved = moveCard(s, id, {
            chapter: target.chapter,
            plotLine,
            ...(place === "on" ? { besideCardId: target.id } : place === "after" ? { afterCardId: target.id } : { beforeCardId: target.id }),
          });
          // Beside an off-page event, a card happens during the same chapter as it (or none).
          if (target.chapter !== null) return moved;
          const during = duringChapter(s, s.cards[target.id] ?? target);
          return setCardDuring(s, id, during) || moved;
        }),
      beside,
    );
    this.boardTarget(el, (place) => {
      // Beside an off-page event in a chapter's background: in that chapter's background too.
      const during = target.chapter === null && this.story ? duringChapter(this.story, target) : undefined;
      if (during) return { target: { chapter: during, plotLine }, background: true };
      const relation = place === "on" ? { besideCardId: target.id } : place === "after" ? { afterCardId: target.id } : { beforeCardId: target.id };
      return { target: { chapter: target.chapter, plotLine, ...relation }, background: this.backgroundDrop };
    });
    this.echoLane(el, plotLine);
  }

  /** Marks a drop target on the main board with where it puts cards, so several selected cards can be dropped there. */
  private boardTarget(el: HTMLElement, at: NonNullable<DropTargetSpec["board"]>): void {
    const spec = this.dropTargets.get(el);
    if (spec) spec.board = at;
  }

  /** Marks a card drop target as being in a plot line, for drops with the echo key held. */
  private echoLane(el: HTMLElement, plotLine: Id): void {
    const spec = this.dropTargets.get(el);
    if (spec) spec.plotLine = plotLine;
  }

  /** True when the event has the key set for echo drops held. */
  private echoKeyHeld(e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): boolean {
    switch (this.plugin.settings.echoModifier) {
      case "alt":
        return e.altKey;
      case "ctrl":
        return e.ctrlKey || e.metaKey;
      case "shift":
        return e.shiftKey;
      default:
        return false;
    }
  }

  /** Shows a dropped card as an echo in another plot line, instead of moving it there. */
  private dropAsEcho(cardId: Id, plotLine: Id): void {
    const story = this.story;
    if (!story) return;
    const name = story.plotLines.find((p) => p.id === plotLine)?.name ?? "that plot line";
    const title = story.cards[cardId]?.title ?? "The card";
    // Try it on a copy first, to know what to say; then apply it as an undoable edit.
    const result = echoByDrop(JSON.parse(JSON.stringify(story)) as Story, cardId, plotLine);
    if (result === "added") this.mutate((s) => echoByDrop(s, cardId, plotLine) === "added");
    if (result === "added") new Notice(`"${title}" now also shows in ${name}. Press Ctrl+Z to undo.`);
    else if (result === "own") new Notice(`${name} is where "${title}" lives, so it needs no echo there.`);
    else if (result === "already") new Notice(`"${title}" already shows as an echo in ${name}.`);
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


/** True while the cursor is in a text field, where keys such as Delete belong to the text. */
function isTyping(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !["checkbox", "radio", "button", "color"].includes(el.type)) || el instanceof HTMLSelectElement;
}

/** Sets a Lucide icon, falling back to another where Obsidian's icon set does not have the first. */
function iconOr(el: HTMLElement, icon: string, fallback: string): void {
  setIcon(el, icon);
  if (!el.querySelector("svg")) setIcon(el, fallback);
}

/** Keeps a small control inside a header from also starting a drag or a rename of the header. */
function stopBoardGestures(el: HTMLElement): void {
  el.addEventListener("pointerdown", (e) => e.stopPropagation());
  el.addEventListener("dblclick", (e) => e.stopPropagation());
}

/** What an echo shows: the card's title, or for an untitled card the start of its synopsis. */
function echoText(card: Card): string {
  if (!isUntitled(card.title)) return card.title;
  return card.synopsis.trim().split(/\r?\n/)[0] || "Untitled";
}

/**
 * Moves a card into a chapter, or into the off-page group, where it happens
 * during no chapter. With `background` (Ctrl+Alt held while dropping), an
 * off-page event dropped into a chapter stays off-page and happens during
 * that chapter, in its background rows.
 */
function moveToChapter(story: Story, cardId: Id, background: boolean, target: CardTarget): boolean {
  const card = story.cards[cardId];
  if (background && card && card.chapter === null && target.chapter !== null) {
    const moved = moveCard(story, cardId, { chapter: null, plotLine: target.plotLine });
    return setCardDuring(story, cardId, target.chapter) || moved;
  }
  const moved = moveCard(story, cardId, target);
  return (target.chapter === null && setCardDuring(story, cardId, undefined)) || moved;
}

/**
 * Sizes a dropdown to the option it shows, rather than to its longest one,
 * so the toolbar keeps its room; it fits itself again when it changes.
 */
function fitSelect(select: HTMLSelectElement): void {
  const style = getComputedStyle(select);
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return;
  context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const text = select.selectedOptions[0]?.text.trim() ?? "";
  const room = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
  select.style.width = `${Math.ceil(context.measureText(text).width + room + 2)}px`;
  if (!select.dataset.fits) {
    select.dataset.fits = "true";
    select.addEventListener("change", () => fitSelect(select));
  }
}
