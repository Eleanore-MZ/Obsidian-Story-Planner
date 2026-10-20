import { setIcon } from "obsidian";

/**
 * A grip at the start of a row for dragging it up or down its list. Rows in
 * the same parent with the same `group` reorder among themselves; a bar shows
 * where the row will go, and `moveTo` gets its new index when it is let go.
 * The grip can also be focused and moved with the arrow keys.
 * Used by story setup, the "Characters to track" list and the palette in settings.
 */
export function reorderHandle(row: HTMLElement, group: string, index: number, moveTo: (to: number) => void): void {
  row.dataset.reorderGroup = group;
  const handle = createSpan({ cls: "story-planner-drag-handle" });
  setIcon(handle, "grip-vertical");
  handle.setAttr("aria-label", "Reorder");
  handle.setAttr("draggable", "false");
  handle.tabIndex = 0;
  row.prepend(handle);
  const siblings = () =>
    Array.from(row.parentElement?.querySelectorAll<HTMLElement>(":scope > [data-reorder-group]") ?? []).filter(
      (r) => r.dataset.reorderGroup === group,
    );

  // Nothing around the grip may start a native drag or select text.
  handle.addEventListener("dragstart", (e) => e.preventDefault());
  handle.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    e.stopPropagation();
    const to = index + (e.key === "ArrowUp" ? -1 : 1);
    if (to < 0 || to >= siblings().length) return;
    moveTo(to);
    // The list is drawn again; keep the focus on the moved row's grip.
    const doc = row.ownerDocument;
    window.setTimeout(() => {
      const rows = Array.from(doc.querySelectorAll<HTMLElement>("[data-reorder-group]")).filter((r) => r.dataset.reorderGroup === group);
      rows[to]?.querySelector<HTMLElement>(":scope > .story-planner-drag-handle")?.focus();
    }, 50);
  });

  handle.addEventListener("pointerdown", (down) => {
    if (down.button !== 0) return;
    down.preventDefault();
    down.stopPropagation();
    // Keep getting the pointer's moves even if something else wants them.
    try {
      handle.setPointerCapture(down.pointerId);
    } catch {
      // Not every pointer can be captured; the window listeners still see it.
    }
    const rows = siblings();
    let to = index;
    let done = false;
    const clear = () => rows.forEach((r) => r.removeClass("is-drop-before", "is-drop-after"));
    row.addClass("is-dragging");
    document.body.addClass("story-planner-reordering");

    const move = (e: PointerEvent) => {
      if (e.pointerId !== down.pointerId) return;
      e.preventDefault();
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
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      for (const target of [window, handle] as EventTarget[]) {
        target.removeEventListener("pointermove", move as EventListener, true);
        target.removeEventListener("pointerup", up as EventListener, true);
        target.removeEventListener("pointercancel", cancel as EventListener, true);
      }
      window.removeEventListener("dragstart", noDrag, true);
      window.removeEventListener("selectstart", noDrag, true);
      try {
        handle.releasePointerCapture(down.pointerId);
      } catch {
        // Already released.
      }
      clear();
      row.removeClass("is-dragging");
      document.body.removeClass("story-planner-reordering");
      if (commit && to !== index) moveTo(to);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId === down.pointerId) finish(true);
    };
    const cancel = (e: PointerEvent) => {
      if (e.pointerId === down.pointerId) finish(false);
    };
    const noDrag = (e: Event) => e.preventDefault();
    // On the window and on the grip: whichever hears the pointer first wins.
    for (const target of [window, handle] as EventTarget[]) {
      target.addEventListener("pointermove", move as EventListener, true);
      target.addEventListener("pointerup", up as EventListener, true);
      target.addEventListener("pointercancel", cancel as EventListener, true);
    }
    window.addEventListener("dragstart", noDrag, true);
    window.addEventListener("selectstart", noDrag, true);
  });
}
