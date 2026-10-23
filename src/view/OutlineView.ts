import { setIcon } from "obsidian";
import { characterFacts, composeOutline, INFO_LABELS, organizationFacts } from "../format/outline";
import { actHeading, actsShown, chapterHeading, chapterTitle, deleteAct, startActAt } from "../model/chapters";
import { isUntitled } from "../model/defaults";
import { addCardAt, deleteCard, updateCard } from "../model/edits";
import { addOrganization, deleteOrganization, orgTree } from "../model/entities";
import { addEvent, deleteEvent, eventCards, setCardEvent } from "../model/events";
import { moveCard } from "../model/moves";
import { addChapter, addCharacter, addPlotLine, cardsInChapter, deleteChapter, deleteCharacter, deletePlotLine, moveIndex, plotLineColor } from "../model/setup";
import { Card, Id, Story, StoryInfo } from "../model/types";
import { reorderHandle } from "./reorder";

/** A question with choices, as the board asks it in a dialog. */
export interface OutlineChoice {
  title: string;
  message: string;
  options: { value: string; label: string }[];
  confirm: string;
  onChoose: (value: string) => void;
}

/** What the outline needs from the board. */
export interface OutlineHost {
  edit(change: (story: Story) => boolean | void, coalesce?: string): void;
  /** Shows a card on the board. */
  reveal(cardId: Id): void;
  /** Asks before a deletion that takes more than one thing with it. */
  choose(choice: OutlineChoice): void;
  notice(message: string): void;
  folded(): ReadonlySet<string>;
  toggleFold(key: string): void;
  /** False when the board's search or highlight dims the card. */
  dimmed(card: Card): boolean;
}

/**
 * The Outline tab: the story as a page, read like a rendered note and
 * written in place. Each block (a character, a plot line, an act, a chapter,
 * an event, a scene) shows a faint + and a grip in the left margin when the
 * pointer is near it, to add another of its kind just below or drag it, and a
 * delete button at its top right. Text is edited where it is: titles end on
 * Enter, paragraphs take new lines, Escape leaves either. Every change is an
 * ordinary edit, so Ctrl+Z undoes it.
 */
export class OutlineView {
  constructor(private host: OutlineHost) {}

  render(parent: HTMLElement, story: Story): void {
    const doc = parent.createDiv({ cls: "story-planner-outline is-page" });
    doc.createEl("h1", { cls: "story-planner-outline-title", text: story.title });
    this.storyPart(doc, story);
    this.peoplePart(doc, story, "characters");
    this.peoplePart(doc, story, "organizations");
    this.plotPart(doc, story);
  }

  // -------------------------------------------------------------------------
  // The pieces every block is made of

  /** A heading that folds what follows it; returns where its contents go, or null while folded. */
  private section(into: HTMLElement, tag: "h2" | "h3" | "h4" | "h5", key: string, heading: (h: HTMLElement) => void): { head: HTMLElement; body: HTMLElement | null } {
    const folded = this.host.folded().has(key);
    const head = into.createEl(tag, { cls: "story-planner-outline-heading" });
    const fold = head.createEl("button", { cls: "story-planner-fold clickable-icon" });
    setIcon(fold, folded ? "chevron-right" : "chevron-down");
    fold.setAttr("aria-label", folded ? "Unfold" : "Fold");
    fold.addEventListener("click", () => this.host.toggleFold(key));
    heading(head);
    return { head, body: folded ? null : into.createDiv({ cls: "story-planner-outline-body" }) };
  }

  /**
   * A block: something the outline lists, with its hover controls. `add`
   * makes another of its kind below it; `remove` deletes it.
   */
  private block(into: HTMLElement, cls: string, options: { add?: () => void; remove?: () => void; label: string }): HTMLElement {
    const block = into.createDiv({ cls: `story-planner-outline-block ${cls}` });
    if (options.add) {
      const add = block.createEl("button", { cls: "story-planner-outline-add clickable-icon" });
      setIcon(add, "plus");
      add.setAttr("aria-label", `Add ${options.label} below`);
      add.setAttr("title", `Add ${options.label} below`);
      add.addEventListener("click", (e) => {
        e.stopPropagation();
        options.add!();
      });
    }
    if (options.remove) {
      const remove = block.createEl("button", { cls: "story-planner-outline-remove clickable-icon" });
      setIcon(remove, "trash-2");
      remove.setAttr("aria-label", `Delete this ${options.label}`);
      remove.setAttr("title", `Delete this ${options.label}`);
      remove.addEventListener("click", (e) => {
        e.stopPropagation();
        options.remove!();
      });
    }
    return block;
  }

  /**
   * Text written in place, looking like the rest of the page: a title line
   * (Enter leaves it) or a paragraph (Enter starts a new line). Escape
   * leaves either. Saves as you type, one undo step per field.
   */
  private text(
    into: HTMLElement,
    tag: string,
    cls: string,
    value: string,
    placeholder: string,
    field: string,
    multiline: boolean,
    save: (s: Story, value: string) => boolean | void,
  ): HTMLElement {
    const el = into.createEl(tag as "div", { cls: `story-planner-outline-text ${cls}` }) as HTMLElement;
    el.setAttr("contenteditable", "plaintext-only");
    el.setAttr("spellcheck", "true");
    el.dataset.placeholder = placeholder;
    el.dataset.field = field;
    el.textContent = value;
    el.toggleClass("is-multiline", multiline);
    el.addEventListener("input", () => {
      const value = (el.textContent ?? "").replace(/ /g, " ");
      el.toggleClass("is-empty", value.length === 0);
      this.host.edit((s) => save(s, multiline ? value : value.replace(/\n/g, " ")), field);
    });
    el.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === "Escape" || (e.key === "Enter" && !multiline)) {
        e.preventDefault();
        e.stopPropagation();
        el.blur();
      }
    });
    el.toggleClass("is-empty", value.length === 0);
    return el;
  }

  // -------------------------------------------------------------------------
  // 1. The story

  private storyPart(doc: HTMLElement, story: Story): void {
    const { body } = this.section(doc, "h2", "story", (h) => h.createSpan({ text: "Story" }));
    if (!body) return;
    const shown = INFO_LABELS.filter(([key]) => story.info?.[key]?.trim() || this.host.folded().has(`info-open:${key}`));
    const save = (key: keyof StoryInfo) => (s: Story, v: string) => {
      const info = { ...(s.info ?? {}) };
      if ((info[key] ?? "") === v) return false;
      if (v.trim()) info[key] = v;
      else delete info[key];
      if (Object.keys(info).length > 0) s.info = info;
      else delete s.info;
    };
    for (const [key, label] of shown) {
      const block = this.block(body, "is-info", {
        label: label.toLowerCase(),
        remove: () => this.host.edit((s) => save(key)(s, "")),
      });
      block.createDiv({ cls: "story-planner-outline-label", text: label });
      this.text(block, "div", "", story.info?.[key] ?? "", label, `outline-info:${key}`, key === "premise" || key === "notes" || key === "themes", save(key));
    }
    // The fields not written yet, as quiet words to start one.
    const missing = INFO_LABELS.filter(([key]) => !shown.some(([k]) => k === key));
    if (missing.length > 0) {
      const line = body.createDiv({ cls: "story-planner-outline-missing" });
      for (const [key, label] of missing) {
        const add = line.createEl("button", { cls: "story-planner-outline-start", text: `+ ${label}` });
        add.addEventListener("click", () => {
          // Opens the field, empty, ready to write in.
          this.host.toggleFold(`info-open:${key}`);
          window.setTimeout(() => document.querySelector<HTMLElement>(`[data-field="outline-info:${key}"]`)?.focus(), 30);
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2. Characters and 3. organizations

  private peoplePart(doc: HTMLElement, story: Story, kind: "characters" | "organizations"): void {
    const orgs = kind === "organizations";
    const list = orgs ? orgTree(story).map(({ org }) => org) : story.characters;
    const { body } = this.section(doc, "h2", kind, (h) => h.createSpan({ text: orgs ? "Organizations" : "Characters" }));
    if (!body) return;
    const pick = (s: Story, id: Id) => (orgs ? s.organizations : s.characters).find((x) => x.id === id);
    const addAfter = (index: number, parent?: Id) => {
      let made: Id | null = null;
      this.host.edit((s) => {
        made = orgs ? addOrganization(s, "", parent) : addCharacter(s, "");
        const array = orgs ? s.organizations : s.characters;
        const from = array.findIndex((x) => x.id === made);
        const at = index + 1;
        moveIndex(array as { id: Id }[], from, Math.min(at, array.length - 1));
      });
      if (made) this.focusLater(`outline-name:${made}`);
    };
    list.forEach((entity, i) => {
      const block = this.block(body, "is-entity", {
        label: orgs ? "organization" : "character",
        add: () => addAfter((orgs ? story.organizations : story.characters).findIndex((x) => x.id === entity.id), orgs ? (entity as { parent?: Id }).parent : undefined),
        remove: () => {
          const inside = orgs ? story.organizations.filter((o) => o.parent === entity.id).length : 0;
          const run = () => {
            this.host.edit((s) => (orgs ? deleteOrganization(s, entity.id) : deleteCharacter(s, entity.id)));
            this.host.notice(`Deleted ${entity.name || "it"}. Press Ctrl+Z to undo.`);
          };
          if (inside === 0) run();
          else
            this.host.choose({
              title: `Delete ${entity.name}?`,
              message: `${inside} ${inside === 1 ? "organization is" : "organizations are"} part of it; they stay, one level up.`,
              options: [{ value: "yes", label: `Delete ${entity.name}` }],
              confirm: "Delete",
              onChoose: run,
            });
        },
      });
      block.style.setProperty("--lane-color", entity.color);
      if (!orgs) {
        reorderHandle(block, "outline-characters", i, (to) => this.host.edit((s) => moveIndex(s.characters, i, to)));
      }
      this.text(block, "h3", "story-planner-outline-name", entity.name, orgs ? "Organization" : "Character", `outline-name:${entity.id}`, false, (s, v) => {
        const e = pick(s, entity.id);
        if (!e || e.name === v.trim() || !v.trim()) return false;
        e.name = v.trim();
      });
      const facts = orgs ? organizationFacts(story, entity as never) : characterFacts(story, entity as never);
      if (facts.length > 0) {
        const box = block.createDiv({ cls: "story-planner-outline-facts" });
        for (const [label, value] of facts) {
          const line = box.createDiv();
          line.createSpan({ cls: "story-planner-outline-label", text: `${label}: ` });
          line.createSpan({ text: value });
        }
      }
      this.text(block, "p", "story-planner-outline-paragraph", entity.summary ?? "", "Summary", `outline-summary:${entity.id}`, true, (s, v) => {
        const e = pick(s, entity.id);
        if (!e || (e.summary ?? "") === v) return false;
        if (v.trim()) e.summary = v;
        else delete e.summary;
      });
    });
    if (list.length === 0) {
      body.createEl("button", { cls: "story-planner-outline-start", text: orgs ? "+ Organization" : "+ Character" }).addEventListener("click", () => addAfter(-1));
    }
  }

  // -------------------------------------------------------------------------
  // 4. The plot

  private plotPart(doc: HTMLElement, story: Story): void {
    const { body: plot } = this.section(doc, "h2", "plot", (h) => h.createSpan({ text: "Plot" }));
    if (!plot) return;
    this.plotLines(plot, story);
    const withActs = actsShown(story);
    const seen = new Set<Id>();
    for (const part of composeOutline(story)) {
      let into: HTMLElement = plot;
      if (part.act) {
        const act = part.act;
        const chaptersIn = story.chapters.filter((c) => c.act === act.id);
        const block = this.block(plot, "is-act", {
          label: "act",
          // A new act after this one, starting with a new chapter.
          add: () =>
            this.host.edit((s) => {
              const last = s.chapters.map((c) => c.act).lastIndexOf(act.id);
              const id = addChapter(s, "");
              moveIndex(s.chapters, s.chapters.length - 1, last + 1);
              s.chapters.find((c) => c.id === id)!.act = act.id;
              startActAt(s, id);
            }),
          remove: () =>
            this.confirmDelete(chaptersIn.length, `${actHeading(story, act)}`, `Its ${chaptersIn.length === 1 ? "chapter stays" : `${chaptersIn.length} chapters stay`}, in no act.`, () =>
              this.host.edit((s) => deleteAct(s, act.id)),
            ),
        });
        const { body } = this.section(block, "h3", `act:${act.id}`, (h) => {
          h.addClass("story-planner-outline-act");
          h.createSpan({ cls: "story-planner-outline-number", text: actHeading(story, act) });
          this.text(h, "span", "story-planner-outline-heading-text", act.title ?? "", "No title", `outline-act:${act.id}`, false, (s, v) => {
            const a = s.acts.find((x) => x.id === act.id);
            if (!a || (a.title ?? "") === v.trim()) return false;
            if (v.trim()) a.title = v.trim();
            else delete a.title;
          });
        });
        if (!body) continue;
        into = body;
        this.text(body, "p", "story-planner-outline-paragraph is-synopsis", act.summary ?? "", "What happens in this act", `outline-act-summary:${act.id}`, true, (s, v) => {
          const a = s.acts.find((x) => x.id === act.id);
          if (!a || (a.summary ?? "") === v) return false;
          if (v.trim()) a.summary = v;
          else delete a.summary;
        });
      }
      part.chapters.forEach((chapter, ci) => {
        const ch = chapter.chapter;
        const level = withActs && part.act ? "h4" : "h3";
        const block = this.block(into, "is-chapter", {
          label: "chapter",
          add: ch
            ? () => {
                let made: Id | null = null;
                this.host.edit((s) => {
                  made = addChapter(s, "");
                  const at = s.chapters.findIndex((c) => c.id === ch.id) + 1;
                  moveIndex(s.chapters, s.chapters.length - 1, at);
                  const target = s.chapters.find((c) => c.id === made)!;
                  if (ch.act) target.act = ch.act;
                });
                if (made) this.focusLater(`outline-chapter:${made}`);
              }
            : undefined,
          remove: ch && story.chapters.length > 1 ? () => this.removeChapter(story, ch.id) : undefined,
        });
        if (ch) reorderHandle(block, `outline-chapters:${part.act?.id ?? ""}`, ci, (to) => {
          const ids = part.chapters.map((c) => c.chapter?.id).filter((x): x is Id => !!x);
          const target = ids[to];
          if (!target) return;
          this.host.edit((s) => moveIndex(s.chapters, s.chapters.findIndex((c) => c.id === ch.id), s.chapters.findIndex((c) => c.id === target)));
        });
        const { body } = this.section(block, level, `chapter:${ch?.id ?? "off"}`, (h) => {
          h.addClass("story-planner-outline-chapter");
          if (!ch) {
            h.createSpan({ text: "Off-page" });
            return;
          }
          h.createSpan({ cls: "story-planner-outline-number", text: chapterHeading(story, ch) });
          this.text(h, "span", "story-planner-outline-heading-text", ch.name, "No title", `outline-chapter:${ch.id}`, false, (s, v) => {
            const c = s.chapters.find((x) => x.id === ch.id);
            if (!c || c.name === v.trim()) return false;
            c.name = v.trim();
          });
        });
        if (!body) return;
        if (ch) {
          this.text(body, "p", "story-planner-outline-paragraph is-synopsis", ch.summary ?? "", "What happens in this chapter", `outline-chapter-summary:${ch.id}`, true, (s, v) => {
            const c = s.chapters.find((x) => x.id === ch.id);
            if (!c || (c.summary ?? "") === v) return false;
            if (v.trim()) c.summary = v;
            else delete c.summary;
          });
        }
        const ids = chapter.cards.map((c) => c.id);
        let index = 0;
        chapter.groups.forEach((g, gi) => {
          if (g.event) {
            const event = g.event;
            const count = eventCards(story, event.id, true).length;
            const head = this.block(body, "is-event", {
              label: "event",
              // A new event below, with a first scene in this chapter after this event's scenes.
              add: () =>
                this.host.edit((s) => {
                  const last = g.cards[g.cards.length - 1]!;
                  const id = addEvent(s, "");
                  const card = addCardAt(s, { chapter: ch ? ch.id : null, plotLine: last.plotLine, afterCardId: last.id });
                  setCardEvent(s, card, id);
                }),
              remove: () =>
                this.confirmDelete(count, event.title || "this event", `Its ${count === 1 ? "scene stays" : `${count} scenes stay`}, in no event.`, () =>
                  this.host.edit((s) => deleteEvent(s, event.id)),
                ),
            });
            head.style.setProperty("--event-color", event.color);
            const parent = event.parent ? story.events.find((e) => e.id === event.parent) : undefined;
            const title = head.createDiv({ cls: "story-planner-outline-event" });
            if (parent) title.createSpan({ cls: "story-planner-outline-number", text: parent.title || "Untitled arc" });
            this.text(title, "span", "story-planner-outline-heading-text", event.title, "Untitled event", `outline-event:${event.id}:${ch?.id ?? "off"}:${gi}`, false, (s, v) => {
              const e = s.events.find((x) => x.id === event.id);
              if (!e || e.title === v) return false;
              e.title = v;
            });
            // An event's synopsis where it first appears.
            if (!seen.has(event.id)) {
              this.text(head, "p", "story-planner-outline-paragraph is-synopsis", event.synopsis ?? "", "What happens in this event", `outline-event-synopsis:${event.id}`, true, (s, v) => {
                const e = s.events.find((x) => x.id === event.id);
                if (!e || (e.synopsis ?? "") === v) return false;
                if (v.trim()) e.synopsis = v;
                else delete e.synopsis;
              });
              seen.add(event.id);
            }
          } else if (gi > 0) {
            body.createDiv({ cls: "story-planner-outline-other", text: "Other scenes" });
          }
          for (const card of g.cards) this.scene(body, story, card, { group: `outline:${ch?.id ?? "off"}`, index: index++, chapter: ch ? ch.id : null, ids });
        });
        if (chapter.cards.length === 0 && ch) {
          body.createEl("button", { cls: "story-planner-outline-start", text: "+ Scene" }).addEventListener("click", () => this.addScene(story, { chapter: ch.id, plotLine: story.plotLines[0]?.id }));
        }
        if (chapter.background.length > 0) {
          const bg = body.createDiv({ cls: "story-planner-outline-background" });
          bg.createDiv({ cls: "story-planner-outline-background-label", text: "Background" });
          for (const card of chapter.background) this.scene(bg, story, card);
        }
      });
    }
  }

  private plotLines(plot: HTMLElement, story: Story): void {
    const { body } = this.section(plot, "h3", "plot-lines", (h) => h.createSpan({ text: "Plot lines" }));
    if (!body) return;
    story.plotLines.forEach((p, i) => {
      const block = this.block(body, "is-entity", {
        label: "plot line",
        add: () => {
          let made: Id | null = null;
          this.host.edit((s) => {
            made = addPlotLine(s, "");
            moveIndex(s.plotLines, s.plotLines.length - 1, i + 1);
          });
          if (made) this.focusLater(`outline-plotline:${made}`);
        },
        remove:
          story.plotLines.length > 1
            ? () => {
                const count = Object.values(story.cards).filter((c) => c.plotLine === p.id).length;
                const other = story.plotLines.find((x) => x.id !== p.id)!;
                const run = (value: string) => this.host.edit((s) => deletePlotLine(s, p.id, value === "delete" ? null : value));
                if (count === 0) run("delete");
                else
                  this.host.choose({
                    title: `Delete ${p.name}?`,
                    message: `It has ${count} ${count === 1 ? "scene" : "scenes"}. Where should ${count === 1 ? "it" : "they"} go?`,
                    options: [
                      ...story.plotLines.filter((x) => x.id !== p.id).map((x) => ({ value: x.id, label: `Move to ${x.name}` })),
                      { value: "delete", label: `Delete ${count === 1 ? "the scene" : `all ${count} scenes`}` },
                    ],
                    confirm: "Delete plot line",
                    onChoose: (value) => run(value || other.id),
                  });
              }
            : undefined,
      });
      block.style.setProperty("--lane-color", plotLineColor(story, p) ?? p.color);
      reorderHandle(block, "outline-plotlines", i, (to) => this.host.edit((s) => moveIndex(s.plotLines, i, to)));
      this.text(block, "h4", "story-planner-outline-name", p.name, "Plot line", `outline-plotline:${p.id}`, false, (s, v) => {
        const target = s.plotLines.find((x) => x.id === p.id);
        if (!target || !v.trim() || target.name === v.trim()) return false;
        target.name = v.trim();
      });
      this.text(block, "p", "story-planner-outline-paragraph", p.synopsis ?? "", "What this plot line is about", `outline-plotline-synopsis:${p.id}`, true, (s, v) => {
        const target = s.plotLines.find((x) => x.id === p.id);
        if (!target || (target.synopsis ?? "") === v) return false;
        if (v.trim()) target.synopsis = v;
        else delete target.synopsis;
      });
    });
  }

  /** A scene: its title and synopsis, its plot line in the margin, a grip to reorder it, an arrow to it on the board. */
  private scene(into: HTMLElement, story: Story, card: Card, reorder?: { group: string; index: number; chapter: Id | null; ids: Id[] }): void {
    const block = this.block(into, "is-scene", {
      label: "scene",
      add: () => this.addScene(story, { chapter: card.chapter, plotLine: card.plotLine, after: card.id, event: card.event }),
      remove: () => {
        this.host.edit((s) => deleteCard(s, card.id));
        this.host.notice(`Deleted "${isUntitled(card.title) ? "Untitled" : card.title}". Press Ctrl+Z to undo.`);
      },
    });
    block.dataset.cardId = card.id;
    const plotLine = story.plotLines.find((p) => p.id === card.plotLine);
    block.style.setProperty("--lane-color", plotLineColor(story, plotLine) ?? "var(--interactive-accent)");
    if (reorder) {
      reorderHandle(block, reorder.group, reorder.index, (to) =>
        this.host.edit((s) => {
          const rest = reorder.ids.filter((id) => id !== card.id);
          rest.splice(to, 0, card.id);
          const next = rest[to + 1];
          return moveCard(s, card.id, { chapter: reorder.chapter, plotLine: s.cards[card.id]!.plotLine, ...(next ? { beforeCardId: next } : {}) });
        }),
      );
    }
    const head = block.createDiv({ cls: "story-planner-outline-scene-head" });
    this.text(head, "span", "story-planner-outline-scene-title", isUntitled(card.title) ? "" : card.title, "Untitled", `outline-card-title:${card.id}`, false, (s, v) =>
      updateCard(s, card.id, { title: v }),
    );
    if (plotLine) head.createSpan({ cls: "story-planner-outline-scene-plot", text: plotLine.name });
    const go = head.createEl("button", { cls: "story-planner-outline-go clickable-icon" });
    setIcon(go, "arrow-up-right");
    go.setAttr("aria-label", "Go to the card");
    go.setAttr("title", "Go to the card");
    go.addEventListener("click", () => this.host.reveal(card.id));
    this.text(block, "p", "story-planner-outline-paragraph", card.synopsis, "What happens", `outline-card-synopsis:${card.id}`, true, (s, v) =>
      updateCard(s, card.id, { synopsis: v }),
    );
    if (this.host.dimmed(card)) block.addClass("is-dimmed");
  }

  /** A new scene, just after another (or at the end of a chapter), in the same plot line and event. */
  private addScene(story: Story, at: { chapter: Id | null; plotLine?: Id; after?: Id; event?: Id }): void {
    const plotLine = at.plotLine ?? story.plotLines[0]?.id;
    if (!plotLine) return;
    let made: Id | null = null;
    this.host.edit((s) => {
      made = addCardAt(s, { chapter: at.chapter, plotLine, ...(at.after ? { afterCardId: at.after } : {}) });
      if (at.event) setCardEvent(s, made, at.event);
    });
    if (made) this.focusLater(`outline-card-title:${made}`);
  }

  private removeChapter(story: Story, id: Id): void {
    const chapter = story.chapters.find((c) => c.id === id)!;
    const count = cardsInChapter(story, id).length;
    if (count === 0) {
      this.host.edit((s) => deleteChapter(s, id, null));
      return;
    }
    this.host.choose({
      title: `Delete ${chapterTitle(story, chapter)}?`,
      message: `It has ${count} ${count === 1 ? "scene" : "scenes"}. Where should ${count === 1 ? "it" : "they"} go?`,
      options: [
        ...story.chapters.filter((c) => c.id !== id).map((c) => ({ value: c.id, label: `Move to the end of ${chapterTitle(story, c)}` })),
        { value: "off-page", label: "Move off-page" },
        { value: "delete", label: `Delete ${count === 1 ? "the scene" : `all ${count} scenes`}` },
      ],
      confirm: "Delete chapter",
      onChoose: (value) => this.host.edit((s) => deleteChapter(s, id, value === "delete" ? null : value)),
    });
  }

  /** Deletes at once, or (for something with others inside) after asking. Either way Ctrl+Z undoes it. */
  private confirmDelete(inside: number, name: string, message: string, run: () => void): void {
    if (inside === 0) {
      run();
      return;
    }
    this.host.choose({ title: `Delete ${name}?`, message, options: [{ value: "yes", label: `Delete ${name}` }], confirm: "Delete", onChoose: run });
  }

  /** Puts the cursor in a field once the outline has been drawn again. */
  private focusLater(field: string): void {
    window.setTimeout(() => document.querySelector<HTMLElement>(`[data-field="${CSS.escape(field)}"]`)?.focus(), 30);
  }
}

