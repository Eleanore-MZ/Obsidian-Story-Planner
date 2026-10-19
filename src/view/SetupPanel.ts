import { formatOffset, formatStoryDate, parseOffset } from "../model/calendar";
import { CALENDAR_PRESETS } from "../model/defaults";
import {
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
  finalRelationshipState,
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
  shiftInList,
} from "../model/setup";
import { SnapshotInfo } from "../model/snapshots";
import { Calendar, Id, Story } from "../model/types";

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
}

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

  constructor(parent: HTMLElement, private host: SetupPanelHost) {
    this.el = parent.createDiv({ cls: "story-planner-setup" });
    this.el.hidden = true;
  }

  get isOpen(): boolean {
    return this.open;
  }

  setOpen(open: boolean, story: Story | null): void {
    if (open && !this.open) this.calendarSnapshotTaken = false;
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

    const titleField = this.section("Story", "The title shown on the board and in the note's outline.");
    const title = this.textInput(titleField, story.title, "story-title");
    title.addEventListener("input", () => {
      if (title.value.trim()) this.host.edit((s) => void (s.title = title.value.trim()), "story-title");
    });

    this.buildPlotLines(story);
    this.buildChapters(story);
    this.buildCharacters(story);
    this.buildRelationships(story);
    this.buildLocations(story);
    this.buildTags(story);
    this.buildCalendar(story);
    this.buildZones(story);
    this.buildSnapshots();
  }

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
    const section = this.section("Chapters", "In reading order. The number is how many scenes each has.");
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
    const section = this.section("Characters", "Characters added on cards appear here too. ⇥ merges a duplicate into another character.");
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
      this.count(row, cardsWithCharacter(story, character.id).length);
      this.reorderButtons(row, i, story.characters.length, (by) => this.host.edit((s) => shiftInList(s.characters, character.id, by)));
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

  private buildRelationships(story: Story): void {
    const section = this.section(
      "Relationships",
      "A plot line that names its characters follows their relationship. Its cards can then carry a state, such as \"allies\" or \"trust broken\".",
    );
    if (story.characters.length === 0) {
      section.createDiv({ cls: "story-planner-panel-hint", text: "Add characters first." });
      return;
    }
    for (const plotLine of story.plotLines) {
      const block = section.createDiv({ cls: "story-planner-setup-relationship" });
      const head = block.createDiv({ cls: "story-planner-setup-row" });
      head.createSpan({ cls: "story-planner-setup-dot" }).style.setProperty("--dot-color", plotLine.color);
      head.createSpan({ cls: "story-planner-setup-name", text: plotLine.name });
      const names = plotLine.characters ?? [];
      if (names.length > 0) {
        const end = finalRelationshipState(story, plotLine.id);
        head.createSpan({ cls: "story-planner-panel-hint", text: end ? `Ends: ${end}` : "No states yet" });
      }
      const people = block.createDiv({ cls: "story-planner-setup-chips" });
      for (const character of story.characters) {
        this.checkbox(people, character.name, names.includes(character.id), (on) =>
          this.host.edit((s) => {
            const p = s.plotLines.find((x) => x.id === plotLine.id)!;
            const list = (p.characters ?? []).filter((c) => c !== character.id);
            if (on) list.push(character.id);
            if (list.length > 0) p.characters = list;
            else delete p.characters;
          }),
        );
      }
    }
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
      this.count(row, cardsAtLocation(story, location.id).length);
      const siblings = story.locations.filter((l) => l.parent === location.parent);
      const index = siblings.indexOf(location);
      this.reorderButtons(row, index, siblings.length, (by) => this.host.edit((s) => shiftLocation(s, location.id, by)));
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
    const section = this.section(
      "Story tags",
      "Labels such as \"clue\" or \"flashback\" for this story only. They never become Obsidian #tags.",
    );
    const on = this.checkbox(section, "Use story tags", story.tagsEnabled, (value) => this.host.edit((s) => void (s.tagsEnabled = value)));
    on.dataset.field = "tags-enabled";
    if (!story.tagsEnabled) return;
    story.tags.forEach((tag, i) => {
      const row = section.createDiv({ cls: "story-planner-setup-row" });
      this.colorInput(row, tag.color, (color) => this.host.edit((s) => void (s.tags.find((t) => t.id === tag.id)!.color = color)));
      const name = this.textInput(row, tag.name, `tag:${tag.id}`);
      name.addEventListener("input", () => {
        const value = name.value.trim();
        if (value) this.host.edit((s) => void (s.tags.find((t) => t.id === tag.id)!.name = value), `tag:${tag.id}`);
      });
      this.count(row, cardsWithTag(story, tag.id).length);
      this.reorderButtons(row, i, story.tags.length, (by) => this.host.edit((s) => shiftInList(s.tags, tag.id, by)));
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

    this.subheading(section, "Months");
    calendar.months.forEach((month, i) => {
      const row = section.createDiv({ cls: "story-planner-setup-row" });
      const monthName = this.textInput(row, month.name, `month:${i}`);
      monthName.addEventListener("input", () => {
        if (monthName.value.trim()) this.calendarEdit((_, c) => void (c.months[i]!.name = monthName.value.trim()), `month:${i}`);
      });
      this.numberInput(row, month.days, `month-days:${i}`, 1, 1000, "days", (days) => this.calendarEdit((_, c) => void (c.months[i]!.days = days), `month-days:${i}`));
      this.reorderButtons(row, i, calendar.months.length, (by) =>
        this.calendarEdit((_, c) => {
          const to = i + by;
          [c.months[i], c.months[to]] = [c.months[to]!, c.months[i]!];
          if (c.leap?.monthIndex === i) c.leap.monthIndex = to;
          else if (c.leap?.monthIndex === to) c.leap.monthIndex = i;
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
      leapRow.createSpan({ cls: "story-planner-panel-hint", text: "…years, a month gets extra days. Off: no leap years." });
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
        this.reorderButtons(row, i, weekdays.length, (by) =>
          this.calendarEdit((_, c) => {
            const w = c.weekdays!;
            [w[i], w[i + by]] = [w[i + by]!, w[i]!];
          }),
        );
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
    section.createDiv({ cls: "story-planner-panel-hint", text: "Named times such as dawn or evening, each covering a span of hours, so they sort among clock times." });
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
      this.reorderButtons(row, i, eras.length, (by) => this.calendarEdit((_, c) => shiftInList(c.eras!, era.id, by)));
      this.iconButton(row, "×", `Delete ${era.name}`, true, () => this.calendarEdit((_, c) => void c.eras!.splice(i, 1)));
    });
    this.addRow(section, "New era", "add-era", (n) =>
      this.calendarEdit((_, c) => void (c.eras ??= []).push({ id: `e${Math.random().toString(36).slice(2, 8)}`, name: n })),
    );

    const sample = Object.values(story.cards).find((c) => c.date);
    if (sample?.date) section.createDiv({ cls: "story-planner-panel-hint", text: `For example, "${sample.title}" is dated ${formatStoryDate(story, sample.date)}.` });
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
    if (story.zones.length > 0) section.createDiv({ cls: "story-planner-panel-hint", text: "The dot marks the reference zone." });
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
      onChoose: (value) => {
        this.host.snapshot(`Before deleting chapter ${chapter.name}`);
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
    const section = this.el.createDiv({ cls: "story-planner-setup-section" });
    section.createEl("h3", { cls: "story-planner-setup-heading", text: label });
    if (hint) section.createDiv({ cls: "story-planner-panel-hint", text: hint });
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
