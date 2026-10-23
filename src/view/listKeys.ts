// List editing in the Outline tab's paragraphs, kept apart so it can be tested without Obsidian.

/**
 * A change to a paragraph's text: replace `from`..`to` with `insert`, then put
 * the cursor at `caret`. `text` is the result, for checking.
 */
export interface TextEdit {
  from: number;
  to: number;
  insert: string;
  caret: number;
  text: string;
}

function edit(text: string, from: number, to: number, insert: string, caret: number): TextEdit {
  return { from, to, insert, caret, text: text.slice(0, from) + insert + text.slice(to) };
}

/**
 * Enter at the end of a list item: a new item with the same marker (the next
 * number, an unticked box). On an empty item, the marker goes and the list
 * ends there, leaving an empty line. Anywhere else, null: an ordinary new line.
 */
export function continueList(text: string, caret: number): TextEdit | null {
  const start = text.lastIndexOf("\n", caret - 1) + 1;
  const endAt = text.indexOf("\n", caret);
  const end = endAt === -1 ? text.length : endAt;
  if (text.slice(caret, end).trim()) return null;
  const line = text.slice(start, end);
  const item = /^(\s*)([-*+]|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?/.exec(line);
  if (!item) return null;
  // An empty item: its marker goes, and the list ends here.
  if (!line.slice(item[0].length).trim()) return edit(text, start, end, "", start);
  const marker = item[3] ? `${Number(item[3]) + 1}${item[4]}` : item[2]!;
  const next = `\n${item[1]}${marker}${item[5]}${item[6] ? "[ ] " : ""}`;
  return edit(text, caret, caret, next, caret + next.length);
}

/** Tab moves the cursor's line in by two spaces; Shift+Tab moves it out by up to two. Only in a list item. */
export function indentLine(text: string, caret: number, out: boolean): TextEdit | null {
  const start = text.lastIndexOf("\n", caret - 1) + 1;
  const line = text.slice(start);
  if (!/^\s*([-*+]|\d+[.)])(\s|$)/.test(line)) return null;
  if (!out) return edit(text, start, start, "  ", caret + 2);
  const remove = /^ {1,2}|^\t/.exec(line)?.[0].length ?? 0;
  if (remove === 0) return null;
  return edit(text, start, start + remove, "", Math.max(start, caret - remove));
}
