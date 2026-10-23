import { setIcon } from "obsidian";
import { formatDateRange } from "../model/calendar";
import { chapterTitleOf } from "../model/chapters";
import { addCharacter } from "../model/setup";
import {
  addOrganization,
  characterAppearances,
  fieldsFor,
  orgAppearances,
  orgDescendants,
  orgMembers,
  orgTree,
  setMembership,
  setOrgParent,
} from "../model/entities";
import { isUntitled } from "../model/defaults";
import { noteName } from "../model/links";
import { Appearances } from "../model/entities";
import { Character, CustomValue, Entity, Id, Organization, Story, StoryDate } from "../model/types";
import { NoteHost } from "./CardPanel";
import { colorSwatch } from "./colorPicker";
import { DateEditor } from "./DateEditor";

/** What the profiles need from the board. */
export interface ProfilesHost {
  edit(change: (story: Story) => boolean | void, coalesce?: string): void;
  /** Shows a card on the board. */
  openCard(id: Id): void;
  /** Whose profile is shown, for each kind. */
  shown(kind: "character" | "organization"): { id?: Id };
  show(kind: "character" | "organization", id?: Id): void;
  notes: NoteHost;
}

const ROLE_WORDS: Record<string, string> = { pov: "point of view", present: "present", mentioned: "mentioned", involved: "involved" };

/**
 * Character and organization profiles, inside the Characters view: a list
 * on the left, the chosen profile on the right, its properties one row each
 * like the card panel, then what the story's scenes say about them.
 */
export class ProfilesView {
  constructor(private host: ProfilesHost) {}

  render(parent: HTMLElement, story: Story, kind: "character" | "organization"): void {
    const { id } = this.host.shown(kind);
    const wrap = parent.createDiv({ cls: "story-planner-profiles" });
    const side = wrap.createDiv({ cls: "story-planner-profiles-list" });

    const items: { entity: Entity; depth: number; count: number }[] =
      kind === "character"
        ? story.characters.map((c) => ({ entity: c, depth: 0, count: characterAppearances(story, c.id).cards.length }))
        : orgTree(story).map(({ org, depth }) => ({ entity: org, depth, count: orgAppearances(story, org.id).cards.length }));
    const current = items.find((i) => i.entity.id === id)?.entity ?? items[0]?.entity;
    const list = side.createDiv({ cls: "story-planner-profiles-items" });
    for (const { entity, depth, count } of items) {
      const row = list.createDiv({ cls: "story-planner-profiles-item" });
      row.toggleClass("is-active", entity === current);
      row.style.setProperty("--chip-color", entity.color);
      row.style.paddingLeft = `calc(${depth} * 1em + var(--size-4-2))`;
      row.createSpan({ cls: "story-planner-profiles-dot" });
      row.createSpan({ cls: "story-planner-profiles-name", text: entity.name });
      if (count > 0) row.createSpan({ cls: "story-planner-profiles-count", text: String(count) });
      row.addEventListener("click", () => this.host.show(kind, entity.id));
    }
    const add = side.createEl("input", { cls: "story-planner-profiles-add" });
    add.type = "text";
    add.placeholder = kind === "character" ? "New character" : "New organization";
    add.dataset.field = `profiles-add-${kind}`;
    add.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || !add.value.trim()) return;
      e.preventDefault();
      const name = add.value.trim();
      let made: Id | null = null;
      this.host.edit((s) => {
        made = kind === "character" ? addCharacter(s, name) : addOrganization(s, name);
      });
      if (made) this.host.show(kind, made);
    });

    const page = wrap.createDiv({ cls: "story-planner-profile" });
    if (!current) {
      page.createDiv({ cls: "story-planner-empty", text: kind === "character" ? "No characters yet" : "No organizations yet" });
      return;
    }
    if (kind === "character") this.character(page, story, current as Character);
    else this.organization(page, story, current as Organization);
  }

  // -------------------------------------------------------------------------

  private character(page: HTMLElement, story: Story, character: Character): void {
    const id = character.id;
    const edit = (change: (c: Character) => void, coalesce?: string) =>
      this.host.edit((s) => {
        const c = s.characters.find((x) => x.id === id);
        if (!c) return false;
        const before = JSON.stringify(c);
        change(c);
        return JSON.stringify(c) !== before;
      }, coalesce);
    this.heading(page, character, (name) => edit((c) => void (c.name = name), `profile-name:${id}`), (color) => edit((c) => void (c.color = color)));
    const props = page.createDiv({ cls: "story-planner-props" });
    this.text(props, "Short name", "text-cursor-input", character.shortName, (v) => edit((c) => set(c, "shortName", v), `short:${id}`));
    this.text(props, "Also known as", "at-sign", character.aliases?.join(", "), (v) =>
      edit((c) => {
        const names = v.split(",").map((n) => n.trim()).filter(Boolean);
        if (names.length > 0) c.aliases = names;
        else delete c.aliases;
      }, `aliases:${id}`),
    );
    this.text(props, "Role in the story", "drama", character.role, (v) => edit((c) => set(c, "role", v), `role:${id}`));
    this.memberships(props, story, character);
    this.date(props, story, "Born", "baby", character.born, `born:${id}`, (d) => edit((c) => set(c, "born", d)));
    this.date(props, story, "Died", "cross", character.died, `died:${id}`, (d) => edit((c) => set(c, "died", d)));
    this.longText(props, "Summary", "align-left", character.summary, (v) => edit((c) => set(c, "summary", v), `summary:${id}`));
    this.longText(props, "Description", "file-text", character.description, (v) => edit((c) => set(c, "description", v), `description:${id}`));
    this.customFields(props, story, "character", character, (fieldId, value) =>
      edit((c) => setField(c, fieldId, value), typeof value === "string" ? `field:${id}:${fieldId}` : undefined),
    );
    this.noteRow(props, character.note, (path) => edit((c) => set(c, "note", path)));
    this.appearances(page, story, characterAppearances(story, id), true);
  }

  private organization(page: HTMLElement, story: Story, org: Organization): void {
    const id = org.id;
    const edit = (change: (o: Organization) => void, coalesce?: string) =>
      this.host.edit((s) => {
        const o = s.organizations.find((x) => x.id === id);
        if (!o) return false;
        const before = JSON.stringify(o);
        change(o);
        return JSON.stringify(o) !== before;
      }, coalesce);
    this.heading(page, org, (name) => edit((o) => void (o.name = name), `profile-name:${id}`), (color) => edit((o) => void (o.color = color)));
    const props = page.createDiv({ cls: "story-planner-props" });
    this.text(props, "Short name", "text-cursor-input", org.shortName, (v) => edit((o) => set(o, "shortName", v), `short:${id}`));
    // Part of: any organization but itself and those inside it.
    const inside = orgDescendants(story, id);
    const parent = this.row(props, "Part of", "network").createEl("select", { cls: "dropdown" });
    parent.createEl("option", { text: "Nothing" }).value = "";
    for (const { org: o, depth } of orgTree(story)) {
      if (o.id === id || inside.has(o.id)) continue;
      parent.createEl("option", { text: `${" ".repeat(depth)}${o.name}` }).value = o.id;
    }
    parent.value = org.parent ?? "";
    parent.addEventListener("change", () => this.host.edit((s) => setOrgParent(s, id, parent.value || undefined)));
    this.longText(props, "Summary", "align-left", org.summary, (v) => edit((o) => set(o, "summary", v), `summary:${id}`));
    this.longText(props, "Description", "file-text", org.description, (v) => edit((o) => set(o, "description", v), `description:${id}`));
    this.customFields(props, story, "organization", org, (fieldId, value) =>
      edit((o) => setField(o, fieldId, value), typeof value === "string" ? `field:${id}:${fieldId}` : undefined),
    );
    this.noteRow(props, org.note, (path) => edit((o) => set(o, "note", path)));

    // Members, from the characters' memberships.
    const members = orgMembers(story, id);
    const box = this.row(props, "Members", "users");
    if (members.length === 0) box.createSpan({ cls: "story-planner-multi-empty", text: "None yet: add an organization on a character's profile" });
    for (const { characterId, membership } of members) {
      const c = story.characters.find((x) => x.id === characterId)!;
      const line = box.createDiv({ cls: "story-planner-profile-member" });
      const name = line.createEl("a", { text: c.name });
      name.addEventListener("click", () => this.host.show("character", c.id));
      const detail = [membership.rank, membership.from || membership.until ? spanText(story, membership.from, membership.until) : ""].filter(Boolean).join(", ");
      if (detail) line.createSpan({ cls: "story-planner-profile-detail", text: detail });
    }
    this.appearances(page, story, orgAppearances(story, id), false);
  }

  // -------------------------------------------------------------------------
  // Pieces

  private heading(page: HTMLElement, entity: Entity, rename: (name: string) => void, recolor: (color: string) => void): void {
    const head = page.createDiv({ cls: "story-planner-profile-head" });
    colorSwatch(head, entity.color, recolor);
    const name = head.createEl("input", { cls: "story-planner-panel-title" });
    name.type = "text";
    name.value = entity.name;
    name.dataset.field = `profile-name:${entity.id}`;
    name.addEventListener("input", () => {
      if (name.value.trim()) rename(name.value.trim());
    });
  }

  private row(parent: HTMLElement, label: string, icon: string): HTMLElement {
    const row = parent.createDiv({ cls: "story-planner-prop" });
    const name = row.createDiv({ cls: "story-planner-prop-label" });
    setIcon(name.createSpan({ cls: "story-planner-prop-icon" }), icon);
    name.createSpan({ text: label });
    return row.createDiv({ cls: "story-planner-prop-value" });
  }

  private text(parent: HTMLElement, label: string, icon: string, value: string | undefined, onInput: (value: string) => void): void {
    const input = this.row(parent, label, icon).createEl("input", { cls: "story-planner-profile-input" });
    input.type = "text";
    input.value = value ?? "";
    input.dataset.field = `profile:${label}`;
    input.addEventListener("input", () => onInput(input.value));
  }

  private longText(parent: HTMLElement, label: string, icon: string, value: string | undefined, onInput: (value: string) => void): void {
    const area = this.row(parent, label, icon).createEl("textarea", { cls: "story-planner-profile-input" });
    area.rows = 2;
    area.value = value ?? "";
    area.dataset.field = `profile:${label}`;
    const grow = () => {
      area.style.height = "auto";
      area.style.height = `${area.scrollHeight + 2}px`;
    };
    area.addEventListener("input", () => {
      grow();
      onInput(area.value);
    });
    window.requestAnimationFrame(grow);
  }

  private date(parent: HTMLElement, story: Story, label: string, icon: string, value: StoryDate | undefined, field: string, onChange: (d: StoryDate | undefined) => void): void {
    new DateEditor(this.row(parent, label, icon), story, value, field, "Zone: default", onChange);
  }

  private customFields(
    parent: HTMLElement,
    story: Story,
    kind: "character" | "organization",
    entity: Entity,
    onChange: (fieldId: Id, value: CustomValue | undefined) => void,
  ): void {
    for (const field of fieldsFor(story, kind)) {
      const value = entity.fields?.[field.id];
      if (field.type === "date") {
        this.date(parent, story, field.name, "calendar", typeof value === "object" ? value : undefined, `custom:${field.id}`, (d) => onChange(field.id, d));
      } else if (field.type === "choice") {
        const select = this.row(parent, field.name, "list").createEl("select", { cls: "dropdown" });
        select.createEl("option", { text: "" }).value = "";
        for (const option of field.options ?? []) select.createEl("option", { text: option }).value = option;
        select.value = typeof value === "string" ? value : "";
        select.addEventListener("change", () => onChange(field.id, select.value || undefined));
      } else {
        this.text(parent, field.name, "text", typeof value === "string" ? value : "", (v) => onChange(field.id, v || undefined));
      }
    }
  }

  private noteRow(parent: HTMLElement, note: string | undefined, onChange: (path: string | undefined) => void): void {
    const cell = this.row(parent, "Note", "sticky-note");
    const notes = this.host.notes;
    if (note) {
      const line = cell.createDiv({ cls: "story-planner-panel-note" });
      const link = line.createEl("a", { cls: "story-planner-panel-note-link", text: noteName(note) });
      link.toggleClass("is-broken", !notes.exists(note));
      link.addEventListener("click", (e) => {
        e.preventDefault();
        notes.open(note, e.ctrlKey || e.metaKey);
      });
      const remove = line.createEl("button", { cls: "clickable-icon", text: "×" });
      remove.setAttr("aria-label", "Unlink the note (it is kept)");
      remove.addEventListener("click", () => onChange(undefined));
    } else {
      cell.createEl("button", { cls: "story-planner-date-add", text: "Link a note" }).addEventListener("click", () =>
        notes.pick("Link a note…", (path) => onChange(path)),
      );
    }
  }

  /** A character's organizations: each with a rank and the stretch of story time they belong. */
  private memberships(parent: HTMLElement, story: Story, character: Character): void {
    const cell = this.row(parent, "Organizations", "landmark");
    const id = character.id;
    for (const m of character.orgs ?? []) {
      const org = story.organizations.find((o) => o.id === m.id);
      if (!org) continue;
      const box = cell.createDiv({ cls: "story-planner-profile-membership" });
      const top = box.createDiv({ cls: "story-planner-profile-membership-top" });
      const chip = top.createSpan({ cls: "story-planner-role-chip role-present", text: org.name });
      chip.style.setProperty("--chip-color", org.color);
      chip.addEventListener("click", () => this.host.show("organization", org.id));
      const rank = top.createEl("input", { cls: "story-planner-profile-input" });
      rank.type = "text";
      rank.placeholder = "Rank";
      rank.value = m.rank ?? "";
      rank.dataset.field = `rank:${id}:${org.id}`;
      rank.addEventListener("input", () => this.host.edit((s) => setMembership(s, id, org.id, { rank: rank.value }), `rank:${id}:${org.id}`));
      const remove = top.createEl("button", { cls: "clickable-icon", text: "×" });
      remove.setAttr("aria-label", `Leave ${org.name}`);
      remove.addEventListener("click", () => this.host.edit((s) => setMembership(s, id, org.id, null)));
      const dates = box.createDiv({ cls: "story-planner-profile-membership-dates" });
      const from = dates.createDiv({ cls: "story-planner-date-part-of-range" });
      new DateEditor(from, story, m.from, `from:${id}:${org.id}`, "Zone: default", (d) => this.host.edit((s) => setMembership(s, id, org.id, { from: d })));
      dates.createSpan({ cls: "story-planner-date-arrow", text: "→" });
      const until = dates.createDiv({ cls: "story-planner-date-part-of-range" });
      new DateEditor(until, story, m.until, `until:${id}:${org.id}`, "Zone: default", (d) => this.host.edit((s) => setMembership(s, id, org.id, { until: d })));
    }
    const others = story.organizations.filter((o) => !character.orgs?.some((m) => m.id === o.id));
    const add = cell.createEl("select", { cls: "dropdown" });
    add.createEl("option", { text: story.organizations.length > 0 ? "Add to an organization…" : "No organizations yet" }).value = "";
    for (const o of others) add.createEl("option", { text: o.name }).value = o.id;
    add.addEventListener("change", () => {
      if (add.value) this.host.edit((s) => setMembership(s, id, add.value, {}));
    });
  }

  /** What the scenes say: first and last appearance, how often in each role, which plot lines, and every scene. */
  private appearances(page: HTMLElement, story: Story, a: Appearances, character: boolean): void {
    const section = page.createDiv({ cls: "story-planner-profile-appearances" });
    section.createDiv({ cls: "story-planner-tray-heading", text: a.cards.length > 0 ? `In ${a.cards.length} ${a.cards.length === 1 ? "scene" : "scenes"}` : "In no scenes yet" });
    if (a.cards.length === 0) return;
    const facts = section.createDiv({ cls: "story-planner-profile-facts" });
    const fact = (label: string, text: string) => {
      const line = facts.createDiv();
      line.createSpan({ cls: "story-planner-profile-detail", text: `${label} ` });
      line.createSpan({ text });
    };
    fact("First:", title(a.first!) + ` (${chapterTitleOf(story, a.first!.chapter)})`);
    fact("Last:", title(a.last!) + ` (${chapterTitleOf(story, a.last!.chapter)})`);
    const order = character ? ["pov", "present", "mentioned"] : ["involved", "mentioned"];
    fact("Roles:", order.filter((r) => a.roles[r]).map((r) => `${a.roles[r]} ${ROLE_WORDS[r]}`).join(", "));
    const lines = facts.createDiv({ cls: "story-planner-profile-lines" });
    lines.createSpan({ cls: "story-planner-profile-detail", text: "Plot lines: " });
    for (const { id, count } of a.plotLines) {
      const p = story.plotLines.find((x) => x.id === id);
      if (!p) continue;
      const chip = lines.createSpan({ cls: "story-planner-role-chip role-present", text: `${p.name} ${count}` });
      chip.style.setProperty("--chip-color", p.color);
    }
    const list = section.createDiv({ cls: "story-planner-profile-scenes" });
    for (const card of a.cards) {
      const row = list.createDiv({ cls: "story-planner-profile-scene" });
      const p = story.plotLines.find((x) => x.id === card.plotLine);
      row.style.setProperty("--lane-color", p?.color ?? "var(--text-faint)");
      row.createSpan({ cls: "story-planner-profile-scene-title", text: title(card) });
      row.createSpan({
        cls: "story-planner-profile-detail",
        text: [chapterTitleOf(story, card.chapter), card.date ? formatDateRange(story, card.date, card.endDate) : ""].filter(Boolean).join(" · "),
      });
      row.addEventListener("click", () => this.host.openCard(card.id));
    }
  }
}

function title(card: { title: string; synopsis: string }): string {
  return isUntitled(card.title) ? card.synopsis.split(/\r?\n/)[0] || "Untitled" : card.title;
}

function spanText(story: Story, from?: StoryDate, until?: StoryDate): string {
  if (from && until) return formatDateRange(story, from, until);
  if (from) return `from ${formatDateRange(story, from, undefined)}`;
  return `until ${formatDateRange(story, until!, undefined)}`;
}

/** Sets an optional text or date property, or removes it when empty. */
function set<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | string | undefined): void {
  if (value === undefined || value === "") delete target[key];
  else (target as Record<K, unknown>)[key] = typeof value === "string" ? value : value;
}

function setField(entity: Entity, fieldId: Id, value: CustomValue | undefined): void {
  const fields = { ...(entity.fields ?? {}) };
  if (value === undefined || value === "") delete fields[fieldId];
  else fields[fieldId] = value;
  if (Object.keys(fields).length > 0) entity.fields = fields;
  else delete entity.fields;
}
