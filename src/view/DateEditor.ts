import { dateProblem, formatStoryDate, mainCalendar, parseClock, storyFormats, weekdayOf } from "../model/calendar";
import { DateParts, dayPartAt, joinDateParts, splitDate } from "../model/dateParts";
import { Story, StoryDate } from "../model/types";

/**
 * One story date on one line: the date ("2020/07/12", "2020/07", "1531",
 * "12 Jul 2020", "~2023/09", or "+3d" for an end date), a time of day from
 * the calendar's parts of the day, and a clock time, the last two optional.
 * The time of day follows the clock until the writer picks one. The line
 * under it shows how the date reads, or what is wrong. Enter (or leaving a
 * field) saves it; Escape puts back the saved date. A zone, when the story
 * has zones, and "approximate" sit beside it.
 */
export class DateEditor {
  private readonly hint: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly part?: HTMLSelectElement;
  private readonly clock: HTMLInputElement;
  private readonly zone?: HTMLSelectElement;
  private readonly approximate: HTMLInputElement;
  /** Whether the time of day is the clock's, rather than one the writer picked. */
  private partAuto: boolean;
  /** The date as entered, when it can be read and is allowed; what a dialog saves. */
  valid: StoryDate | undefined;
  /** What the fields showed when they last saved, to put back on Escape. */
  private saved: DateParts;

  constructor(
    parent: HTMLElement,
    private story: Story,
    value: StoryDate | undefined,
    /** Field-name prefix, so the panel can put the cursor back after a rebuild. */
    prefix: string,
    /** Label for the zone dropdown's first option, e.g. "Zone: Harbour Time (from location)". */
    defaultZoneLabel: string,
    private onChange: (date: StoryDate | undefined) => void,
    /** An extra check, such as an end date not being before the start. */
    private check?: (date: StoryDate) => string | null,
    /** The start date, for an end date typed as "+3d". */
    private start?: () => StoryDate | undefined,
  ) {
    const calendar = mainCalendar(story);
    this.saved = splitDate(story, value);
    this.partAuto = this.saved.partAuto;
    const row = parent.createDiv({ cls: "story-planner-date-row" });
    this.input = row.createEl("input", { cls: "story-planner-date-input" });
    this.input.type = "text";
    this.input.dataset.field = `${prefix}-text`;
    this.input.placeholder = storyFormats(story).date;
    this.input.spellcheck = false;
    this.input.setAttr("aria-label", "Date");

    if ((calendar.dayParts ?? []).length > 0) {
      const part = row.createEl("select", { cls: "dropdown story-planner-date-part" });
      part.createEl("option", { text: "Time of day" }).value = "";
      for (const p of calendar.dayParts!) part.createEl("option", { text: p.name }).value = p.id;
      part.dataset.field = `${prefix}-part`;
      part.setAttr("aria-label", "Time of day");
      part.addEventListener("change", () => {
        // Picking a part makes it the writer's; picking none goes back to following the clock.
        this.partAuto = part.value === "" || part.value === this.clockPart();
        this.commit();
      });
      this.part = part;
    }

    this.clock = row.createEl("input", { cls: "story-planner-date-clock" });
    this.clock.type = "text";
    this.clock.placeholder = storyFormats(story).time;
    this.clock.dataset.field = `${prefix}-clock`;
    this.clock.spellcheck = false;
    this.clock.setAttr("aria-label", "Clock time");

    if (story.zones.length > 0) {
      const zone = row.createEl("select", { cls: "dropdown story-planner-date-zone" });
      for (const [key, label] of [["", defaultZoneLabel], ...story.zones.map((z): [string, string] => [z.id, z.name])]) {
        zone.createEl("option", { text: label }).value = key!;
      }
      zone.value = value?.zone ?? "";
      zone.dataset.field = `${prefix}-zone`;
      zone.addEventListener("change", () => this.commit());
      this.zone = zone;
    }
    if (value) {
      const clear = row.createEl("button", { cls: "clickable-icon story-planner-date-clear", text: "×" });
      clear.setAttr("aria-label", "Clear");
      clear.addEventListener("click", () => this.onChange(undefined));
    }

    const label = parent.createEl("label", { cls: "story-planner-panel-check story-planner-date-approx" });
    this.approximate = label.createEl("input");
    this.approximate.type = "checkbox";
    this.approximate.checked = !!value?.approximate;
    this.approximate.dataset.field = `${prefix}-approximate`;
    label.createSpan({ text: "Approximate" });
    this.approximate.addEventListener("change", () => this.commit());

    this.hint = parent.createDiv({ cls: "story-planner-date-hint" });
    this.fill(this.saved);

    for (const field of [this.input, this.clock]) {
      field.addEventListener("input", () => {
        // A first clock time takes over the time of day; while it follows the clock, it changes as the clock is typed.
        if (field === this.clock && !this.saved.clock) this.partAuto = true;
        if (field === this.clock && this.part && this.partAuto) this.part.value = this.clockPart();
        this.read();
      });
      field.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          this.fill(this.saved);
        }
      });
      field.addEventListener("blur", (e) => {
        // Moving between the date's own fields saves nothing yet.
        if (e.relatedTarget instanceof Node && row.contains(e.relatedTarget)) return;
        if (!sameParts(this.parts(), this.saved)) this.commit();
      });
    }
    this.read();
  }

  /** The part of the day the typed clock time falls in, or "". */
  private clockPart(): string {
    const minutes = parseClock(mainCalendar(this.story), this.clock.value);
    return minutes === null || !this.clock.value.trim() ? "" : (dayPartAt(mainCalendar(this.story), minutes)?.id ?? "");
  }

  private fill(parts: DateParts): void {
    this.input.value = parts.date;
    this.clock.value = parts.clock;
    this.partAuto = parts.partAuto;
    if (this.part) this.part.value = parts.part;
    this.read();
  }

  private parts(): DateParts {
    return { date: this.input.value, part: this.part?.value ?? "", partAuto: this.partAuto, clock: this.clock.value };
  }

  /** Reads what is entered and says how it reads; saves nothing. */
  private read(): StoryDate | undefined | null {
    const parsed = joinDateParts(this.story, this.parts(), this.start?.());
    if (!parsed.ok) return this.say(null, parsed.error);
    if (!parsed.date) {
      this.valid = undefined;
      this.hint.toggleClass("is-problem", false);
      this.hint.setText(this.saved.date ? "Empty: the date will be cleared." : "");
      return undefined;
    }
    const date = { ...parsed.date };
    if (!date.zone && this.zone?.value) date.zone = this.zone.value;
    if (this.approximate.checked) date.approximate = true;
    const problem = dateProblem(mainCalendar(this.story), date) ?? this.check?.(date) ?? null;
    if (problem) return this.say(null, problem);
    this.say(date, null);
    return date;
  }

  /** Saves what is entered, if it can be read; an empty date clears it. */
  private commit(): void {
    const date = this.read();
    if (date === null) return;
    if (date) {
      // Typing "~" ticks the box; a time typed into the date field moves to its own fields.
      if (date.approximate) this.approximate.checked = true;
      if (date.zone && this.zone) this.zone.value = date.zone;
      this.saved = splitDate(this.story, date);
      this.fill(this.saved);
    } else {
      this.saved = splitDate(this.story, undefined);
    }
    this.onChange(date);
  }

  private say(date: StoryDate | null, problem: string | null): null {
    this.valid = date ?? undefined;
    this.hint.toggleClass("is-problem", !!problem);
    if (problem || !date) {
      this.hint.setText(problem ?? "");
      return null;
    }
    const calendar = mainCalendar(this.story);
    const weekday = weekdayOf(calendar, date);
    const text = formatStoryDate(this.story, date);
    this.hint.setText(weekday !== undefined ? `${calendar.weekdays![weekday]}, ${text}` : text);
    return null;
  }
}

function sameParts(a: DateParts, b: DateParts): boolean {
  return a.date.trim() === b.date.trim() && a.clock.trim() === b.clock.trim() && a.part === b.part;
}
