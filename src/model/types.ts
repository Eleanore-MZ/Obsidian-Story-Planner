// The story data model. Everything a story needs lives in one Story object,
// which is stored in the story note's data block (see src/format/storyFile.ts).
// See docs/design.md for the reasoning behind each concept.

/** Bumped whenever the stored shape changes, so older stories can be upgraded. */
export const STORY_SCHEMA_VERSION = 3;

export type Id = string;


export type CharacterRole = "pov" | "present" | "mentioned";

export interface PlotLine {
  id: Id;
  name: string;
  color: string;
  /** The category this plot line belongs to, such as "Main story lines". */
  category?: Id;
  description?: string;
  /** What the plot line is about, for setup and the outline. */
  synopsis?: string;
}

/** A group of plot lines, such as "Main story lines" or "Relationship development". */
export interface PlotLineCategory {
  id: Id;
  name: string;
  color: string;
}

export interface Chapter {
  id: Id;
  /** The writer's title, which may be empty; the number comes from the chapter's place (see model/chapters.ts). */
  name: string;
  /** What happens in the chapter. */
  summary?: string;
  /** The act the chapter belongs to. */
  act?: Id;
  /** Shown instead of a number, such as "Prologue"; such a chapter takes no number. */
  label?: string;
}

/** A run of chapters, such as "Act I: The Pier". Its number comes from its place. */
export interface Act {
  id: Id;
  title?: string;
  summary?: string;
}

/** A value of a story's own field on a character or organization: text, a choice's name, or a story date. */
export type CustomValue = string | StoryDate;

/** A field the writer adds to every character or organization profile, such as "Age" or "Motto". */
export interface CustomFieldDef {
  id: Id;
  name: string;
  type: "text" | "date" | "choice";
  /** For a choice field: the choices. */
  options?: string[];
  /** Which profiles have it. */
  appliesTo: "character" | "organization" | "both";
}

/** What characters and organizations share: a name, a colour, a summary, a note. */
export interface Entity {
  id: Id;
  name: string;
  /** A shorter name for tight spaces, such as chips on cards. */
  shortName?: string;
  color: string;
  /** One or two lines: who or what this is. */
  summary?: string;
  description?: string;
  /** Values of the story's own fields, by field id. */
  fields?: Record<Id, CustomValue>;
  /** Vault path of an optional note. */
  note?: string;
}

/** A character's place in an organization, perhaps with a rank and only for a stretch of story time. */
export interface Membership {
  id: Id;
  rank?: string;
  from?: StoryDate;
  until?: StoryDate;
}

export interface Character extends Entity {
  /** Other names the character goes by. */
  aliases?: string[];
  /** The character's part in the story, in the writer's words: "Protagonist", "The mentor". */
  role?: string;
  orgs?: Membership[];
  born?: StoryDate;
  died?: StoryDate;
  /** Default time zone for cards where this character is the point of view. */
  zone?: Id;
}

/** A group in the story: a family, a guild, a government, a crew. */
export interface Organization extends Entity {
  /** The organization it belongs to, such as a branch of a guild. */
  parent?: Id;
}

/** How an organization takes part in a scene. */
export type OrgRole = "involved" | "mentioned";

export interface CardOrg {
  id: Id;
  role: OrgRole;
}

/**
 * Something that happens across several scenes, such as "The siege" or "The
 * wedding". A card belongs to at most one event; an event can sit inside one
 * other (an arc). Its stretch of story time comes from its cards, unless the
 * writer sets one.
 */
export interface StoryEvent {
  id: Id;
  title: string;
  synopsis?: string;
  color: string;
  /** The arc this event is part of. */
  parent?: Id;
  /** The plot line the event lives in on the board; unset, the one most of its scenes are in. */
  plotLine?: Id;
  /** Whether the event has been written, as for a card. */
  written?: boolean;
  start?: StoryDate;
  end?: StoryDate;
  /** Where an event without cards shows on the board. */
  chapter?: Id;
}

/** What the story is: shown first in the outline. */
export interface StoryInfo {
  logline?: string;
  genre?: string;
  premise?: string;
  themes?: string;
  notes?: string;
}

export interface Location {
  id: Id;
  name: string;
  /** Enclosing location, e.g. a room inside a house inside a city. */
  parent?: Id;
  zone?: Id;
  description?: string;
  note?: string;
}

export interface StoryTag {
  id: Id;
  name: string;
  color: string;
}

export interface CalendarMonth {
  name: string;
  short?: string;
  days: number;
}

export interface CalendarEra {
  id: Id;
  name: string;
  /** True when years count down towards the end of the era. */
  countsDown?: boolean;
  /**
   * How many years the era lasted. Needed only to place the eras on either
   * side of it on one timeline; the era that counts up from year 1 first
   * (the anchor) and a counting-down era just before it need none.
   */
  years?: number;
}

/** A named part of the day, covering a span of hours (start inclusive, end exclusive). */
export interface DayPart {
  id: Id;
  name: string;
  startHour: number;
  endHour: number;
}

export interface Calendar {
  id: Id;
  name: string;
  months: CalendarMonth[];
  /** Simple leap rule: every `everyYears` years, month `monthIndex` gets `extraDays` more days. */
  leap?: { everyYears: number; monthIndex: number; extraDays: number };
  eras?: CalendarEra[];
  /** Weekday names; omitted when the world has no week. */
  weekdays?: string[];
  /** Anchors the week: the given date falls on weekdays[weekdayIndex]. */
  weekAnchor?: { year: number; month: number; day: number; weekdayIndex: number };
  hoursPerDay: number;
  minutesPerHour: number;
  dayParts?: DayPart[];
}

export interface TimeZone {
  id: Id;
  name: string;
  /** Offset from the reference zone, in minutes of the story's own day. */
  offsetMinutes: number;
}

/**
 * A date in the story's calendar, stored as components so that its meaning
 * survives edits to the calendar. Only `year` is required; the rest narrow it.
 * Months and days are 1-based.
 */
export interface StoryDate {
  calendar: Id;
  era?: Id;
  year: number;
  month?: number;
  day?: number;
  /** Clock time as minutes since midnight. A date with one may also name a part of the day the writer chose. */
  minutes?: number;
  dayPart?: Id;
  zone?: Id;
}

export interface CardCharacter {
  id: Id;
  role: CharacterRole;
  /** What this character does in the scene. */
  note?: string;
}

export interface Card {
  id: Id;
  title: string;
  synopsis: string;
  plotLine: Id;
  /** Secondary plot lines, where the card shows as an echo. */
  alsoIn: Id[];
  /** Null for off-page events. */
  chapter: Id | null;
  /** For an off-page event: the chapter it happens during, in the background, untold. */
  during?: Id;
  /** Scene order within the chapter (or within the off-page lane). */
  order: number;
  date?: StoryDate;
  endDate?: StoryDate;
  /** Manual order among cards that share the same date. */
  timeOrder?: number;
  location?: Id;
  characters: CardCharacter[];
  /** The event the scene is part of. */
  event?: Id;
  /** Organizations in the scene. */
  orgs?: CardOrg[];
  /** Whether the scene has been written yet. */
  written: boolean;
  tags: Id[];
  /** Vault paths of linked notes. */
  notes: string[];
  /** ISO timestamp of the last edit, used to resolve sync conflicts. */
  modified: string;
}

/** Everything except the cards; stored as the first line of the data block. */
export interface StorySetup {
  schema: number;
  title: string;
  plotLines: PlotLine[];
  plotLineCategories: PlotLineCategory[];
  /** Whether the story shows its acts; turning it off hides them and keeps them for later. */
  actsEnabled: boolean;
  acts: Act[];
  /** Colour each plot line by its category instead of by its own colour. */
  colorByCategory: boolean;
  chapters: Chapter[];
  characters: Character[];
  organizations: Organization[];
  /** Events and arcs, in the writer's order. */
  events: StoryEvent[];
  /** The story's own fields on character and organization profiles. */
  customFields: CustomFieldDef[];
  /** What the story is, for the outline: logline, genre, premise, themes. */
  info?: StoryInfo;
  locations: Location[];
  tags: StoryTag[];
  tagsEnabled: boolean;
  calendars: Calendar[];
  zones: TimeZone[];
  /** The zone every other zone's offset is measured from; undefined means an implicit single zone. */
  referenceZone?: Id;
  /** This story's own date and time formats, such as "D MMMM YYYY"; unset uses the plugin's. */
  dateFormat?: string;
  timeFormat?: string;
  /** How long a block of time is at story time's clock zoom, in the calendar's minutes; unset is 15. */
  timeBlockMinutes?: number;
  /** When the story begins and ends, if the writer says; the whole story-time view runs from one to the other. */
  storyStart?: StoryDate;
  storyEnd?: StoryDate;
  /** What this story's cards show, where it differs from the plugin's defaults. */
  cardShows?: Partial<Record<"chapter" | "date" | "synopsis" | "tags" | "characters" | "organizations" | "event" | "place" | "written" | "notes", boolean>>;
}

export interface Story extends StorySetup {
  /** Cards keyed by id, so moving a card never restructures the data. */
  cards: Record<Id, Card>;
}
