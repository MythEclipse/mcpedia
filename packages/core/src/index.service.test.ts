import { test, expect } from "vitest";
import { shouldCreateRevision } from "../src/index.service";

/**
 * Unit tests for the revision-dedup decision rule.
 *
 * `shouldCreateRevision` is the pure predicate that `indexContentFile` consults
 * before writing a new row to `document_revisions`. It is extracted because the
 * dedup correctness is the single most important guarantee of the revision
 * system ("metadata-only edits don't bloat history"), and it must hold without
 * a database.
 *
 * The DB-backed paths (`snapshotRevision`, `restoreRevision`) are exercised
 * end-to-end via the indexer and the web revision restore route. Here we
 * lock the decision invariant in CI.
 */

test("shouldCreateRevision: first snapshot when no prior revision exists", () => {
  // No prior revision row → always snapshot the first version.
  expect(shouldCreateRevision(null, "body text")).toBe(true);
  expect(shouldCreateRevision(undefined, "body text")).toBe(true);
});

test("shouldCreateRevision: identical body creates no new revision (dedup)", () => {
  // The exact dedup rule that prevents metadata-only edits from bloating
  // history: if the body is byte-identical to the latest revision's body,
  // skip the snapshot.
  expect(shouldCreateRevision("same body", "same body")).toBe(false);
  // The dedup rule applies regardless of body length — large identical bodies
  // also skip the snapshot.
  expect(shouldCreateRevision("a".repeat(5000), "a".repeat(5000))).toBe(false);
});

test("shouldCreateRevision: changed body creates a new revision", () => {
  expect(shouldCreateRevision("old body", "new body")).toBe(true);
  // Whitespace / trailing newline changes count as a real body change.
  expect(shouldCreateRevision("body", "body\n")).toBe(true);
});

test("shouldCreateRevision: empty-string vs non-empty counts as a change", () => {
  expect(shouldCreateRevision("", "content")).toBe(true);
  expect(shouldCreateRevision("content", "")).toBe(true);
});
