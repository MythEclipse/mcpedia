import { test, expect } from "vitest";
import { cosine, toTsQuery } from "../src/index";

test("cosine: orthogonal vectors are 0", () => {
  expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 6);
});

test("cosine: identical vectors are 1", () => {
  expect(cosine([1, 1, 1], [1, 1, 1])).toBeCloseTo(1, 6);
});

test("cosine: empty or length-mismatched returns 0", () => {
  expect(cosine([], [])).toBe(0);
  expect(cosine([], [1, 2, 3])).toBe(0);
  expect(cosine([1, 2], [1, 2, 3])).toBe(0);
});

test("cosine: opposite vectors are negative", () => {
  const score = cosine([1, 0], [-1, 0]);
  expect(score).toBeCloseTo(-1, 6);
});

test("cosine: zero-vector denominator returns 0 (no NaN)", () => {
  expect(cosine([0, 0, 0], [0, 0, 0])).toBe(0);
});

test("toTsQuery: joins terms with AND-prefix", () => {
  expect(toTsQuery("websocket contract")).toBe("websocket:* & contract:*");
});

test("toTsQuery: strips non-alphanumerics and empty terms", () => {
  expect(toTsQuery("hello!!! world???")).toBe("hello:* & world:*");
  expect(toTsQuery("   ")).toBe("");
  expect(toTsQuery("123 456")).toBe("123:* & 456:*");
});

test("toTsQuery: empty/garbage input returns empty string", () => {
  expect(toTsQuery("!!!@@@###")).toBe("");
  expect(toTsQuery("")).toBe("");
});
