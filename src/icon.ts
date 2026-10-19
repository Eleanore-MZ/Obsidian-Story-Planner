import { addIcon } from "obsidian";

/** The plugin's own icon: an open book with a pen, drawn like Obsidian's Lucide icons. */
export const STORY_ICON = "story-planner";

// Obsidian icons use a 100 by 100 box; these paths are on Lucide's 24 grid, scaled up.
const SVG = `<g transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
<path d="M2 7h4.5a3.5 3.5 0 0 1 3.5 3.5V21a2.5 2.5 0 0 0-2.5-2.5H2z"/>
<path d="M18 13.5V18.5h-5.5a2.5 2.5 0 0 0-2.5 2.5"/>
<path d="M10 10.5a3.5 3.5 0 0 1 3.5-3.5H14"/>
<path d="M21.4 4.6a1.9 1.9 0 0 0-2.7-2.7l-6.2 6.2a1.5 1.5 0 0 0-.4.7l-.6 2.2a.4.4 0 0 0 .5.5l2.2-.6a1.5 1.5 0 0 0 .7-.4z"/>
</g>`;

export function registerIcon(): void {
  addIcon(STORY_ICON, SVG);
}
