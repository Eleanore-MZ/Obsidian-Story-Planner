import { describe, expect, it } from "vitest";
import { parseStory, serializeStory } from "../src/format/storyFile";
import { formatStoryDate, storyFormats } from "../src/model/calendar";
import { formatPattern, setDefaultFormats, usesToken } from "../src/model/dateFormat";
import { createEmptyStory } from "../src/model/defaults";
import { StoryDate } from "../src/model/types";

const full = { YYYY: "1531", MM: "12", DD: "04", MMMM: "December", D: "4", E: "AF", dddd: "Marketday" };

describe("date formats", () => {
  it("fills the tokens", () => {
    expect(formatPattern("YYYY/MM/DD", full)).toBe("1531/12/04");
    expect(formatPattern("D MMMM YYYY E", full)).toBe("4 December 1531 AF");
    expect(formatPattern("dddd, D MMMM", full)).toBe("Marketday, 4 December");
  });

  it("leaves out a missing part with its separator", () => {
    expect(formatPattern("YYYY/MM/DD", { YYYY: "1531", MM: "12" })).toBe("1531/12");
    expect(formatPattern("YYYY/MM/DD", { YYYY: "1531" })).toBe("1531");
    expect(formatPattern("DD.MM.YYYY", { YYYY: "1531", MM: "12" })).toBe("12.1531");
    expect(formatPattern("DD.MM.YYYY", { YYYY: "1531" })).toBe("1531");
    expect(formatPattern("dddd, D MMMM YYYY", { YYYY: "1531", MMMM: "December" })).toBe("December 1531");
  });

  it("keeps [bracketed] text as it is, even when it looks like a token", () => {
    expect(formatPattern("[Day] D [of] MMMM", full)).toBe("Day 4 of December");
    expect(usesToken("[E]YYYY", "E")).toBe(false);
    expect(usesToken("YYYY E", "E")).toBe(true);
  });

  it("formats times", () => {
    expect(formatPattern("hh:mm", { hh: "06", mm: "25" })).toBe("06:25");
    expect(formatPattern("h[h]mm", { h: "6", mm: "25" })).toBe("6h25");
  });

  it("gives nothing when nothing is known", () => {
    expect(formatPattern("YYYY/MM/DD", {})).toBe("");
  });
});

describe("story dates in a format", () => {
  const story = () => createEmptyStory("Formats");
  const date = (fields: Partial<StoryDate> = {}): StoryDate => ({ calendar: "main", year: 2024, month: 3, day: 2, ...fields });

  it("uses YYYY/MM/DD and hh:mm by default, leaving out what the date does not have", () => {
    const s = story();
    expect(formatStoryDate(s, date())).toBe("2024/03/02");
    expect(formatStoryDate(s, date({ minutes: 14 * 60 + 5 }))).toBe("2024/03/02 14:05");
    expect(formatStoryDate(s, date({ dayPart: "morning" }))).toBe("2024/03/02 Morning");
    expect(formatStoryDate(s, { calendar: "main", year: 2024, month: 3 })).toBe("2024/03");
    expect(formatStoryDate(s, { calendar: "main", year: 2024 })).toBe("2024");
    expect(formatStoryDate(s, { calendar: "main", year: 2023, month: 9 })).toBe("2023/09");
  });

  it("follows the plugin's formats, and a story's own over them", () => {
    const s = story();
    setDefaultFormats({ date: "dddd D MMMM YYYY", time: "h[h]mm" });
    try {
      expect(formatStoryDate(s, date({ minutes: 9 * 60 + 30 }))).toBe("Saturday 2 March 2024 9h30");
      s.dateFormat = "DD.MM.YYYY";
      expect(formatStoryDate(s, date())).toBe("02.03.2024");
      expect(storyFormats(s)).toEqual({ date: "DD.MM.YYYY", time: "h[h]mm" });
    } finally {
      setDefaultFormats({});
    }
    expect(formatStoryDate(story(), date())).toBe("2024/03/02");
  });

  it("shows the era even when the format leaves it out, and uses the calendar's own month names", () => {
    const s = story();
    s.calendars[0]!.eras = [{ id: "af", name: "AF" }];
    s.calendars[0]!.months[2]!.short = "Mrz";
    expect(formatStoryDate(s, date({ era: "af" }))).toBe("2024/03/02 AF");
    s.dateFormat = "D MMM YYYY E";
    expect(formatStoryDate(s, date({ era: "af" }))).toBe("2 Mrz 2024 AF");
  });

  it("pads month numbers to the width a long calendar needs", () => {
    const s = story();
    s.calendars[0]!.months = Array.from({ length: 120 }, (_, i) => ({ name: `M${i + 1}`, days: 3 }));
    expect(formatStoryDate(s, { calendar: "main", year: 5, month: 7, day: 1 })).toBe("0005/007/01");
  });

  it("keeps a story's formats in the story file, and older stories load without them", () => {
    const s = story();
    s.dateFormat = "D MMMM YYYY";
    s.timeFormat = "hh.mm";
    const parsed = parseStory(serializeStory(s));
    expect(parsed.ok && parsed.story).toEqual(s);
    const old = parseStory(serializeStory(story()));
    expect(old.ok && "dateFormat" in old.story).toBe(false);
  });
});
