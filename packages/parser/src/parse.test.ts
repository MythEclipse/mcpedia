import { test, expect, afterEach, beforeEach } from "vitest";
// parseFile uses node:fs, so we test it by writing a temp file. This keeps the
// parser package dependency-free while still exercising gray-matter.
import { parseFile } from "../src/index";
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mcpedia-parser-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeDoc(rel: string, frontmatter: string) {
  const p = join(tmp, rel);
  // Ensure the parent directory exists (sections like docs/, writeups/).
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, frontmatter, "utf8");
  return parseFile(p, rel);
}

test("parseFile: extracts basic frontmatter", () => {
  const { meta, body } = writeDoc(
    "docs/test.md",
    [
      "---",
      'id: test-doc',
      'title: Test Document',
      'type: documentation',
      'tags: ["docs", "test"]',
      'status: published',
      'author: asep',
      'created_at: 2026-08-19',
      'updated_at: 2026-08-19',
      "---",
      "",
      "# Hello",
      "Body text here.",
    ].join("\n"),
  );
  expect(meta.slug).toBe("docs/test");
  expect(meta.section).toBe("docs");
  expect(meta.title).toBe("Test Document");
  expect(meta.type).toBe("documentation");
  expect(meta.status).toBe("published");
  expect(meta.author).toBe("asep");
  expect(meta.tags).toEqual(["docs", "test"]);
  expect(body).toContain("# Hello");
});

test("parseFile: section derived from top-level dir", () => {
  expect(writeDoc("writeups/foo.md", "---\ntitle: A\n---\nbody").meta.section).toBe("writeups");
  expect(writeDoc("research/bar.md", "---\ntitle: B\n---\nbody").meta.section).toBe("research");
  expect(writeDoc("notes/baz.md", "---\ntitle: C\n---\nbody").meta.section).toBe("notes");
});

test("parseFile: dynamic type and status with defaults", () => {
  const { meta: m1 } = writeDoc(
    "docs/x.md",
    "---\ntitle: X\ntype: custom-type\nstatus: draft\n---\n",
  );
  expect(m1.type).toBe("custom-type");
  expect(m1.status).toBe("draft");

  const { meta: m2 } = writeDoc(
    "docs/y.md",
    "---\ntitle: Y\n---\n",
  );
  expect(m2.type).toBe("documentation");
  expect(m2.status).toBe("published");
});

test("parseFile: missing optional fields get sane defaults", () => {
  const { meta } = writeDoc("docs/x.md", "---\ntitle: Just A Title\n---\n");
  expect(meta.author).toBe("");
  expect(meta.tags).toEqual([]);
  expect(meta.createdAt).toBeTruthy();
  expect(meta.updatedAt).toBeTruthy();
});

test("parseFile: body excludes frontmatter delimiter", () => {
  const { body } = writeDoc("docs/x.md", "---\ntitle: T\n---\n# Real body\n\nParagraph.");
  expect(body).not.toContain("---");
  expect(body).toContain("# Real body");
});

test("parseFile: extracts dynamic extra fields", () => {
  const { meta } = writeDoc(
    "writeups/ctf/chal.md",
    [
      "---",
      'title: CTF Challenge',
      'event: DEF CON 2024',
      'points: 100',
      'solved: true',
      "---",
      "# Solved",
    ].join("\n"),
  );
  expect(meta.extraFields?.event).toBe("DEF CON 2024");
  expect(meta.extraFields?.points).toBe(100);
  expect(meta.extraFields?.solved).toBe(true);
});

test("stringifyFile: writes file that round-trips via parseFile", async () => {
  const { stringifyFile } = await import("../src/index");
  const p = join(tmp, "docs/roundtrip.md");
  const meta = {
    id: "docs/roundtrip",
    slug: "docs/roundtrip",
    title: "Roundtrip Test",
    type: "documentation" as const,
    section: "docs" as const,
    status: "published" as const,
    author: "tester",
    tags: ["a", "b"],
    path: "docs/roundtrip.md",
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
    extraFields: {
      event: "DEF CON",
      difficulty: "medium",
      points: 500,
    },
  };
  const body = "# Content\n\nParagraph content.";
  stringifyFile(p, "docs/roundtrip.md", meta, body);

  const parsed = parseFile(p, "docs/roundtrip.md");
  expect(parsed.meta.title).toBe("Roundtrip Test");
  expect(parsed.meta.author).toBe("tester");
  expect(parsed.meta.tags).toEqual(["a", "b"]);
  expect(parsed.meta.extraFields?.event).toBe("DEF CON");
  expect(parsed.meta.extraFields?.difficulty).toBe("medium");
  expect(parsed.meta.extraFields?.points).toBe(500);
  expect(parsed.body.trim()).toBe(body);
});

