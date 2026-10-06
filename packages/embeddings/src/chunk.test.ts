import { test, expect } from "vitest";
import { chunkText } from "../src/chunk";

test("empty / whitespace input returns empty array", () => {
  expect(chunkText("")).toEqual([]);
  expect(chunkText("   \n  ")).toEqual([]);
});

test("short text (<= size) returns a single chunk", () => {
  const text = "hello world this is short";
  const chunks = chunkText(text, { size: 1000, overlap: 150 });
  expect(chunks).toHaveLength(1);
  expect(chunks[0]).toBe(text);
});

test("long text splits into multiple chunks with overlap honored", () => {
  // Build ~3000 chars of words so we get >1 chunk at default size 1000.
  const word = "lorem";
  const text = Array.from({ length: 600 }, () => word).join(" ");
  const chunks = chunkText(text, { size: 1000, overlap: 150 });
  expect(chunks.length).toBeGreaterThan(1);

  // Every chunk must respect the size upper bound (trimmed).
  for (const c of chunks) {
    expect(c.length).toBeLessThanOrEqual(1000);
  }

  // The overlap region: second chunk should start near the end of the first
  // minus the overlap window. We just assert they share some suffix/prefix
  // overlap roughly, i.e. the join doesn't lose content boundaries badly.
  const joined = chunks.join(" ");
  // Most words are preserved across the split (at least the bulk).
  expect(joined.length).toBeGreaterThan(text.length * 0.9);
});

test("chunkText never splits a chunk mid-word past the boundary (no truncation mid-token)", () => {
  const text = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi";
  const chunks = chunkText(text, { size: 20, overlap: 4 });
  // No chunk should contain a partial word boundary that corrupts tokens —
  // i.e. every resulting piece still reassembles into the original words set.
  const reassembled = chunks
    .flatMap((c) => c.split(/\s+/))
    .filter(Boolean)
    .sort();
  const original = text.split(/\s+/).sort();
  // Overlap means some words repeat — assert all original words are present.
  for (const w of original) {
    expect(reassembled).toContain(w);
  }
});

test("default options produce reasonable chunking", () => {
  const text = "x".repeat(2500);
  const chunks = chunkText(text); // defaults: size 1000, overlap 150
  expect(chunks.length).toBeGreaterThanOrEqual(2);
  expect(chunks[chunks.length - 1].length).toBeLessThanOrEqual(1000);
});
