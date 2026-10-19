/**
 * Makes text fields under `root` safe for input methods (Chinese pinyin,
 * Japanese, Korean and the like), where several keys build one character.
 * While a character is being composed, the plugin's own handlers see neither
 * the keys (so Enter, which picks the character, does not also add or save
 * anything) nor the in-between text; once it is composed, they get one input
 * event with the finished text.
 *
 * Listening in the capture phase, on an ancestor, runs before the fields' own
 * listeners, so one call covers every field inside, including later ones.
 */
export function guardComposition(root: HTMLElement): void {
  root.addEventListener(
    "keydown",
    (e) => {
      // keyCode 229 is what some browsers send for keys that go to an input method.
      if (e.isComposing || e.keyCode === 229) e.stopPropagation();
    },
    true,
  );
  root.addEventListener(
    "input",
    (e) => {
      if ((e as InputEvent).isComposing) e.stopPropagation();
    },
    true,
  );
  root.addEventListener(
    "compositionend",
    (e) => {
      const target = e.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        target.dispatchEvent(new Event("input", { bubbles: true }));
      }
    },
    true,
  );
}
