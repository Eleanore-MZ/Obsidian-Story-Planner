# Story Planner: notes for Claude

Obsidian plugin for plot planning. The design is in docs/design.md and is the source of truth for features. Phasing is in its section 12.

The owner (Eleanore) works on Windows. Give any shell instructions for PowerShell, and keep npm scripts cross-platform (no rm -rf, no POSIX-only tools in package.json).

Keep the plugin light: no UI framework, and no runtime dependencies beyond the Obsidian API unless they are clearly worth it. The plugin is desktop-only for now.

Each story is one Markdown note; the plugin must never write to any other note. The story format (src/format/storyFile.ts) is the most sensitive code: never rewrite a story the plugin could not parse, keep one JSON line per card, and escape outline text so it can never create Obsidian tags, links or %% comments. Any format change needs a test in tests/storyFile.test.ts, and `npm run samples` to refresh the test vault (tests/samples.test.ts fails otherwise).

Code that can be tested without Obsidian (format, layout, calendar arithmetic) stays free of `obsidian` imports so vitest can run it.

Before pushing, run `npm run build` and `npm test`.
