import { dateProblem, formatStoryDate, mainCalendar, storyFormats, weekdayOf } from "../model/calendar";
import { parseStoryDate } from "../model/dateParse";
import { Story, StoryDate } from "../model/types";

/**
 * One story date, typed in a single field: "2020/07/12 19:49", "20200712",
 * "12 Jul 2020", "1531 AF dawn", "~2023/09", or "+3d" for an end date. The line
 * under it shows how the date reads, or what is wrong. Enter (or leaving the
 * field) saves it; Escape puts back the saved date. A zone, when the story has
 * zones, and "approximate" sit beside it.
 */
export class DateEditor {
  private readonly hint: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly zone?: HTMLSelectElement;
  private readonly approximate: HTMLInputElement;
  /** The date as typed, when it can be read and is allowed; what a dialog saves. */
  valid: StoryDate | undefined;
  /** What the field showed when it last saved, to put back on Escape. */
  private saved: string;

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
    const row = parent.createDiv({ cls: "story-planner-date-row" });
    this.input = row.createEl("input", { cls: "story-planner-date-input" });
    this.input.type = "text";
    this.input.dataset.field = `${prefix}-text`;
    this.input.placeholder = `${storyFormats(story).date} ${storyFormats(story).time}`;
    this.saved = value ? this.show(value) : "";
    this.input.value = this.saved;
    this.input.spellcheck = false;

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

    this.input.addEventListener("input", () => this.read());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.input.value = this.saved;
        this.read();
      }
    });
    this.input.addEventListener("blur", () => {
      if (this.input.value !== this.saved) this.commit();
    });
    this.read();
  }

  /** A date as the field writes it: in the story's format, without the zone (which has its own control). */
  private show(date: StoryDate): string {
    return formatStoryDate(this.story, { ...date, approximate: false }, { zone: false });
  }

  /** Reads what is typed and says how it reads; saves nothing. */
  private read(): StoryDate | undefined | null {
    const parsed = parseStoryDate(this.story, this.input.value, this.start?.());
    if (!parsed.ok) return this.say(null, parsed.error);
    if (!parsed.date) {
      this.valid = undefined;
      this.hint.toggleClass("is-problem", false);
      this.hint.setText(this.saved ? "Empty: the date will be cleared." : "");
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

  /** Saves what is typed, if it can be read; an empty field clears the date. */
  private commit(): void {
    const date = this.read();
    if (date === null) return;
    if (date) {
      // Typing "~" ticks the box; the field then shows the date plainly.
      if (date.approximate) this.approximate.checked = true;
      if (date.zone && this.zone) this.zone.value = date.zone;
      this.saved = this.show(date);
      this.input.value = this.saved;
    } else {
      this.saved = "";
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
