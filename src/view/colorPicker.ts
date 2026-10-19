import { currentPalette, normalizeHex } from "../model/palette";

const COLUMNS = 6;
let closeCurrentBoard: (() => void) | undefined;

/**
 * A colour square that opens a board of the palette's colours: one click
 * picks a colour, "Custom" opens the system's colour picker. With the
 * keyboard, the arrow keys move, Enter picks and Escape closes.
 */
export function colorSwatch(parent: HTMLElement, value: string, onChange: (color: string) => void): HTMLButtonElement {
  const button = parent.createEl("button", { cls: "story-planner-swatch" });
  button.style.setProperty("--swatch", value);
  button.setAttr("aria-label", `Colour ${value}`);
  button.setAttr("aria-haspopup", "true");
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!button.disabled) openBoard(button, value, onChange);
  });
  return button;
}

function openBoard(anchor: HTMLElement, value: string, onChange: (color: string) => void): void {
  closeCurrentBoard?.();
  const board = document.body.createDiv({ cls: "story-planner-color-board" });
  board.setAttr("role", "listbox");
  const rect = anchor.getBoundingClientRect();
  board.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 240))}px`;
  board.style.top = `${rect.bottom + 4}px`;

  const close = () => {
    board.remove();
    document.removeEventListener("pointerdown", outside, true);
    if (closeCurrentBoard === close) closeCurrentBoard = undefined;
  };
  closeCurrentBoard = close;
  const outside = (e: PointerEvent) => {
    if (!board.contains(e.target as Node)) close();
  };
  const pick = (color: string) => {
    close();
    anchor.focus();
    if (color !== value) onChange(color);
  };

  const current = normalizeHex(value);
  const swatches: HTMLButtonElement[] = [];
  for (const color of currentPalette()) {
    const swatch = board.createEl("button", { cls: "story-planner-color-choice" });
    swatch.style.setProperty("--swatch", color);
    swatch.setAttr("role", "option");
    swatch.setAttr("aria-label", color);
    swatch.setAttr("aria-selected", String(color === current));
    swatch.toggleClass("is-current", color === current);
    swatch.addEventListener("click", () => pick(color));
    swatches.push(swatch);
  }
  // "Custom": the system colour picker, for a colour that is not on the board.
  const custom = board.createEl("label", { cls: "story-planner-color-custom", text: "Custom…" });
  const input = custom.createEl("input");
  input.type = "color";
  input.value = current ?? "#888888";
  input.addEventListener("change", () => pick(input.value));

  board.addEventListener("keydown", (e) => {
    const at = swatches.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => {
      e.preventDefault();
      swatches[Math.max(0, Math.min(swatches.length - 1, to))]?.focus();
    };
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      anchor.focus();
    } else if (at !== -1 && e.key === "ArrowRight") move(at + 1);
    else if (at !== -1 && e.key === "ArrowLeft") move(at - 1);
    else if (at !== -1 && e.key === "ArrowDown") move(at + COLUMNS);
    else if (at !== -1 && e.key === "ArrowUp") move(at - COLUMNS);
  });
  document.addEventListener("pointerdown", outside, true);
  (swatches.find((s) => s.hasClass("is-current")) ?? swatches[0])?.focus();
}
