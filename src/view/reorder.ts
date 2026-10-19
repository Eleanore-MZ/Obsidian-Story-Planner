import { setIcon } from "obsidian";

/**
 * A grip at the start of a row for dragging it up or down its list. Rows in
 * the same parent with the same `group` reorder among themselves; a bar shows
 * where the row will go, and `moveTo` gets its new index when it is let go.
 * Used by story setup and the "Characters to track" list.
 */
export function reorderHandle(row: HTMLElement, group: string, index: number, moveTo: (to: number) => void): void {
  row.dataset.reorderGroup = group;
  const handle = createSpan({ cls: "story-planner-drag-handle" });
  setIcon(handle, "grip-vertical");
  handle.setAttr("aria-label", "Reorder");
  row.prepend(handle);
  handle.addEventListener("pointerdown", (down) => {
    if (down.button !== 0) return;
    down.preventDefault();
    const rows = Array.from(row.parentElement?.querySelectorAll<HTMLElement>(":scope > [data-reorder-group]") ?? []).filter(
      (r) => r.dataset.reorderGroup === group,
    );
    let to = index;
    const clear = () => rows.forEach((r) => r.removeClass("is-drop-before", "is-drop-after"));
    row.addClass("is-dragging");
    document.body.addClass("story-planner-reordering");

    const move = (e: PointerEvent) => {
      // The row nearest the pointer, and which half of it.
      let best: { i: number; after: boolean; distance: number } | null = null;
      rows.forEach((r, i) => {
        const rect = r.getBoundingClientRect();
        const middle = rect.top + rect.height / 2;
        const distance = Math.abs(e.clientY - middle);
        if (!best || distance < best.distance) best = { i, after: e.clientY > middle, distance };
      });
      clear();
      if (!best) return;
      const { i, after } = best as { i: number; after: boolean };
      const slot = i + (after ? 1 : 0);
      to = slot > index ? slot - 1 : slot;
      if (to !== index) rows[i]!.addClass(after ? "is-drop-after" : "is-drop-before");
    };
    const up = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
      clear();
      row.removeClass("is-dragging");
      document.body.removeClass("story-planner-reordering");
      if (to !== index) moveTo(to);
    };
    const cancel = () => {
      to = index;
      up();
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true);
  });
}
