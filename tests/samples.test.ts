import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseStory, serializeStory } from "../src/format/storyFile";

// The committed sample stories must stay readable, and must be exactly what the
// current serializer writes (run `npm run samples` after a format change).
const dir = join("test-vault", "Stories");

describe("sample stories in the test vault", () => {
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
    it(`${name} parses and is up to date`, () => {
      const text = readFileSync(join(dir, name), "utf8");
      const result = parseStory(text);
      expect(result.ok).toBe(true);
      if (result.ok) expect(serializeStory(result.story, result.frontmatter)).toBe(text);
    });
  }
});
