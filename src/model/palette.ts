// The colour palette new plot lines, characters, categories and tags take
// their colours from, and the colour board offers. It is a plugin setting;
// this module keeps the one in use, as model/dateFormat.ts does for formats.

/** Twelve muted colours that tell apart in both light and dark themes. */
export const DEFAULT_PALETTE = [
  "#4e79a7",
  "#e15759",
  "#59a14f",
  "#f28e2b",
  "#b07aa1",
  "#76b7b2",
  "#edc948",
  "#9c755f",
  "#ff9da7",
  "#6b8e23",
  "#7f7f9f",
  "#bab0ac",
];

let palette = [...DEFAULT_PALETTE];

export function currentPalette(): string[] {
  return [...palette];
}

/** Uses a palette; an empty or unusable one falls back to the default. */
export function setPalette(colors: readonly string[] | undefined): void {
  palette = cleanPalette(colors);
}

/** "#abc", "ABC" or "#AABBCC" as "#aabbcc"; null for anything that is not a colour. */
export function normalizeHex(text: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
  if (!m) return null;
  const hex = m[1]!.toLowerCase();
  return `#${hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex}`;
}

/** A palette's valid colours, each once, in order; the default when none are left. */
export function cleanPalette(colors: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const c of colors ?? []) {
    const hex = normalizeHex(c);
    if (hex && !out.includes(hex)) out.push(hex);
  }
  return out.length > 0 ? out : [...DEFAULT_PALETTE];
}

/** The first palette colour nobody uses yet, or the next one in turn when all are taken. */
export function nextColor(used: { color: string }[], colors: readonly string[] = palette): string {
  const taken = new Set(used.map((u) => normalizeHex(u.color) ?? u.color.toLowerCase()));
  return colors.find((c) => !taken.has(c)) ?? colors[used.length % colors.length]!;
}
