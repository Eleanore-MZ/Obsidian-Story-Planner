// Date and time formats for showing story dates, such as "YYYY/MM/DD" and
// "hh:mm". A format is text with tokens in it; anything else is kept as it is,
// and [text in brackets] is kept literally even if it looks like a token.
// A part the date does not have (a year-only date has no month or day) is
// left out together with the separator before it, so "YYYY/MM/DD" shows
// "1531/12" for December 1531 and "1531" for the year alone.

export const DEFAULT_DATE_FORMAT = "YYYY/MM/DD";
export const DEFAULT_TIME_FORMAT = "hh:mm";

export interface DateFormats {
  date: string;
  time: string;
}

/** The format used when a story does not set its own; plugin settings change it. */
let defaults: DateFormats = { date: DEFAULT_DATE_FORMAT, time: DEFAULT_TIME_FORMAT };

export function setDefaultFormats(formats: Partial<DateFormats>): void {
  defaults = { date: formats.date?.trim() || DEFAULT_DATE_FORMAT, time: formats.time?.trim() || DEFAULT_TIME_FORMAT };
}

export function defaultFormats(): DateFormats {
  return { ...defaults };
}

/** What each token means, for help text. */
export const DATE_TOKENS: [string, string][] = [
  ["YYYY", "year, at least four digits"],
  ["Y", "year as it is"],
  ["MM", "month number, padded"],
  ["M", "month number"],
  ["MMMM", "month name"],
  ["MMM", "short month name"],
  ["DD", "day, padded"],
  ["D", "day"],
  ["dddd", "weekday name"],
  ["E", "era"],
];

export const TIME_TOKENS: [string, string][] = [
  ["hh", "hour, padded"],
  ["h", "hour"],
  ["mm", "minutes, padded"],
];

const TOKEN = /\[([^\]]*)\]|YYYY|MMMM|MMM|MM|M|DD|D|dddd|Y|E|hh|h|mm/g;

type Segment = { literal: string } | { token: string; value: string | undefined };

/** True when a format mentions a token, outside [brackets]. */
export function usesToken(format: string, token: string): boolean {
  return segments(format).some((s) => "token" in s && s.token === token);
}

function segments(format: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const match of format.matchAll(TOKEN)) {
    if (match.index! > last) out.push({ literal: format.slice(last, match.index) });
    if (match[1] !== undefined) out.push({ literal: match[1] });
    else out.push({ token: match[0], value: undefined });
    last = match.index! + match[0].length;
  }
  if (last < format.length) out.push({ literal: format.slice(last) });
  return out;
}

/**
 * Fills a format with values. A token with no value is left out, with the
 * separator before it (or after it, when it comes first); separators at
 * either end with nothing beside them are dropped too.
 */
export function formatPattern(format: string, values: Record<string, string | undefined>): string {
  const parts = segments(format).map((s) => ("token" in s ? { token: s.token, value: values[s.token] } : s)) as Segment[];
  const kept: Segment[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (!("token" in part) || part.value) {
      kept.push(part);
      continue;
    }
    // A missing token takes the separator before it with it; if nothing
    // came before, the separator after it goes instead.
    const before = kept[kept.length - 1];
    if (before && !("token" in before)) kept.pop();
    else if (parts[i + 1] && !("token" in parts[i + 1]!)) i++;
  }
  // Separators left dangling at either end belong to nothing; words stay.
  const first = kept.findIndex((p) => "token" in p);
  if (first === -1) return "";
  let last = kept.length - 1;
  while (!("token" in kept[last]!)) last--;
  let start = 0;
  while (start < first && isSeparator(kept[start]!)) start++;
  let end = kept.length;
  while (end - 1 > last && isSeparator(kept[end - 1]!)) end--;
  return kept
    .slice(start, end)
    .map((p) => ("token" in p ? p.value : p.literal))
    .join("");
}

/** Punctuation and spaces between parts, as opposed to words the writer put in on purpose. */
function isSeparator(segment: Segment): boolean {
  return !("token" in segment) && /^[\s/.,:;\-–—_]*$/.test(segment.literal);
}

export function pad(n: number, width: number): string {
  const text = String(Math.abs(n)).padStart(width, "0");
  return n < 0 ? `-${text}` : text;
}
