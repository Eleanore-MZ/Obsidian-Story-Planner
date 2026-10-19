import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isStoryText, parseStory, serializeStory } from "../src/format/storyFile";

// The committed sample stories must stay readable, and must be exactly what the
// current serializer writes (run `npm run samples` after a format change).
const dir = join("test-vault", "Stories");

describe("sample stories in the test vault", () => {
  // Other notes can sit beside the stories, such as notes made from cards.
  const stories = readdirSync(dir).filter((f) => f.endsWith(".md") && isStoryText(readFileSync(join(dir, f), "utf8")));
  it("finds the sample stories", () => expect(stories.length).toBeGreaterThanOrEqual(3));
  for (const name of stories) {
    it(`${name} parses and is up to date`, () => {
      const text = readFileSync(join(dir, name), "utf8");
      const result = parseStory(text);
      expect(result.ok).toBe(true);
      if (result.ok) expect(serializeStory(result.story, result.frontmatter)).toBe(text);
    });
  }
});
