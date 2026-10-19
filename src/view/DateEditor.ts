import { clock, dateProblem, formatStoryDate, mainCalendar, parseClock, weekdayOf } from "../model/calendar";
import { Story, StoryDate } from "../model/types";

const CLOCK = "\u0000clock";

/**
 * A compact editor for one story date: era, year, month, day, and a clock
 * time or a part of the day, plus a zone and an "approximate" flag. It saves
 * only dates the calendar can show; while a date is incomplete or wrong, the
 * line under it says why and nothing is saved.
 */
export class DateEditor {
  private readonly hint: HTMLElement;
  private hadValue = false;
  private readonly fields: {
    era?: HTMLSelectElement;
    year: HTMLInputElement;
    month: HTMLSelectElement;
    day: HTMLInputElement;
    time: HTMLSelectElement;
    clock: HTMLInputElement;
    zone?: HTMLSelectElement;
    approximate: HTMLInputElement;
  };

  constructor(
    parent: HTMLElement,
    private story: Story,
    value: StoryDate | undefined,
    /** Field-name prefix, so the panel can put the cursor back after a rebuild. */
    prefix: string,
    /** Label for the zone dropdown's first option, e.g. "Default: Harbour Time (from location)". */
    defaultZoneLabel: string,
    private onChange: (date: StoryDate | undefined) => void,
    /** An extra check, such as an end date not being before the start. */
    private check?: (date: StoryDate) => string | null,
  ) {
    const calendar = mainCalendar(story);
    const row = parent.createDiv({ cls: "story-planner-date-row" });

    let era: HTMLSelectElement | undefined;
    if ((calendar.eras ?? []).length > 0) {
      // A date without an era is in the first era that counts up.
      const anchor = calendar.eras!.find((e) => !e.countsDown) ?? calendar.eras![calendar.eras!.length - 1]!;
      era = this.select(row, `${prefix}-era`, calendar.eras!.map((e) => [e.id, e.name]), value?.era ?? anchor.id);
    }
    const year = this.input(row, `${prefix}-year`, "Year", value ? String(value.year) : "", "story-planner-date-year");
    const month = this.select(
      row,
      `${prefix}-month`,
      [["", "Month"], ...calendar.months.map((m, i): [string, string] => [String(i + 1), m.name])],
      value?.month !== undefined ? String(value.month) : "",
    );
    const day = this.input(row, `${prefix}-day`, "Day", value?.day !== undefined ? String(value.day) : "", "story-planner-date-day");
    if (value) {
      const clear = row.createEl("button", { cls: "clickable-icon", text: "×" });
      clear.setAttr("aria-label", "Clear this date");
      clear.addEventListener("click", () => this.onChange(undefined));
    }
    this.hadValue = !!value;

    const second = parent.createDiv({ cls: "story-planner-date-row" });
    const time = this.select(
      second,
      `${prefix}-time`,
      [["", "No time"], [CLOCK, "Clock time"], ...(calendar.dayParts ?? []).map((p): [string, string] => [p.id, p.name])],
      value?.dayPart ?? (value?.minutes !== undefined ? CLOCK : ""),
    );
    const clockInput = this.input(
      second,
      `${prefix}-clock`,
      "hh:mm",
      value?.minutes !== undefined ? clock(calendar, value.minutes) : "",
      "story-planner-date-clock",
    );
    clockInput.hidden = time.value !== CLOCK;

    let zone: HTMLSelectElement | undefined;
    if (story.zones.length > 0) {
      zone = this.select(second, `${prefix}-zone`, [["", defaultZoneLabel], ...story.zones.map((z): [string, string] => [z.id, z.name])], value?.zone ?? "");
    }

    const label = parent.createEl("label", { cls: "story-planner-panel-check" });
    const approximate = label.createEl("input");
    approximate.type = "checkbox";
    approximate.checked = !!value?.approximate;
    approximate.dataset.field = `${prefix}-approximate`;
    label.createSpan({ text: "Approximate" });

    this.hint = parent.createDiv({ cls: "story-planner-panel-hint story-planner-date-hint" });
    this.fields = { era, year, month, day, time, clock: clockInput, zone, approximate };

    for (const el of [era, month, time, zone, approximate]) el?.addEventListener("change", () => this.update());
    for (const el of [year, day, clockInput]) el.addEventListener("input", () => this.update());
    this.showHint(value, null);
  }

  /** Reads the fields; saves the date if it is complete and valid, else says what is missing. */
  private update(): void {
    const f = this.fields;
    const calendar = mainCalendar(this.story);
    f.clock.hidden = f.time.value !== CLOCK;
    const yearText = f.year.value.trim();
    // An empty year saves nothing, so retyping a year never loses the month and day; × clears a date.
    if (!yearText) return this.showHint(undefined, this.hadValue ? "Type a year, or clear the date with ×." : null);
    if (!/^-?\d+$/.test(yearText)) return this.showHint(undefined, "The year must be a whole number.");
    const date: StoryDate = { calendar: calendar.id, year: Number(yearText) };
    if (f.era?.value) date.era = f.era.value;
    if (f.month.value) date.month = Number(f.month.value);
    const dayText = f.day.value.trim();
    if (dayText) {
      if (!/^\d+$/.test(dayText)) return this.showHint(undefined, "The day must be a number.");
      date.day = Number(dayText);
    }
    if (f.time.value === CLOCK) {
      const minutes = parseClock(calendar, f.clock.value);
      if (minutes === null) {
        return this.showHint(undefined, `Type a time between 00:00 and ${clock(calendar, calendar.hoursPerDay * calendar.minutesPerHour - 1)}.`);
      }
      date.minutes = minutes;
    } else if (f.time.value) {
      date.dayPart = f.time.value;
    }
    if (f.zone?.value) date.zone = f.zone.value;
    if (f.approximate.checked) date.approximate = true;

    const problem = dateProblem(calendar, date) ?? this.check?.(date) ?? null;
    this.showHint(date, problem);
    if (!problem) this.onChange(date);
  }

  private showHint(date: StoryDate | undefined, problem: string | null): void {
    this.hint.toggleClass("is-problem", !!problem);
    if (problem) {
      this.hint.setText(problem);
      return;
    }
    if (!date) {
      this.hint.setText("Not dated. Type a year to start; month, day and time are optional.");
      return;
    }
    const calendar = mainCalendar(this.story);
    const weekday = weekdayOf(calendar, date);
    const text = formatStoryDate(this.story, date);
    this.hint.setText(weekday !== undefined ? `${calendar.weekdays![weekday]}, ${text}` : text);
  }

  private input(parent: HTMLElement, field: string, placeholder: string, value: string, cls: string): HTMLInputElement {
    const input = parent.createEl("input", { cls });
    input.type = "text";
    input.placeholder = placeholder;
    input.value = value;
    input.dataset.field = field;
    return input;
  }

  private select(parent: HTMLElement, field: string, options: [string, string][], value: string): HTMLSelectElement {
    const select = parent.createEl("select", { cls: "dropdown" });
    for (const [key, label] of options) select.createEl("option", { text: label }).value = key;
    select.value = value;
    select.dataset.field = field;
    return select;
  }
}
