import { test, expect, beforeEach, vi } from "vitest";
import { createApp } from "../src/app";
import type { ApiDeps } from "../src/app";
import { DASHBOARD_HTML } from "../src/dashboard";
import { Hono } from "hono";

// -------------------------------------------------------------------
// A fake queue that records calls and returns canned counts. Injected into
// createApp so no live Redis/BullMQ is needed.
// -------------------------------------------------------------------
function fakeQueue(counts: Record<string, number>) {
  const base = {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
    delayed: counts.delayed ?? 0,
  };
  return {
    getWaitingCount: () => Promise.resolve(base.waiting),
    getActiveCount: () => Promise.resolve(base.active),
    getCompletedCount: () => Promise.resolve(base.completed),
    getFailedCount: () => Promise.resolve(base.failed),
    getDelayedCount: () => Promise.resolve(base.delayed),
  };
}

function makeDeps(secret: string, q: ReturnType<typeof fakeQueue>): ApiDeps {
  return { queue: q, webhookSecret: secret };
}

// Mock @mcpedia/queue so the production lazy-import path in createApp(deps=undefined)
// doesn't try to connect to Redis during construction. We never call that path in
// these tests (we always inject deps), but the import may still be pulled by the
// module graph — mock it to be safe.
vi.mock("@mcpedia/queue", () => ({
  getQueue: () => fakeQueue({}),
  enqueueFullIndex: async () => ({ id: "real-full" }),
  enqueueIndexDoc: async () => ({ id: "real-doc" }),
  INDEX_QUEUE: "mcpedia-index",
}));

// Mock @mcpedia/core so tRPC CRUD procedures don't hit Postgres.
// Only the functions used by the router are faked; assertions record calls.
// vi.mock() calls are hoisted above every import, so their factories can run
// before this module's body executes. vi.hoisted() moves the shared call log
// ahead of the hoisted factories, otherwise it would be in the TDZ.
const coreCalls = vi.hoisted(() => ({
  createDocument: [] as Array<any[]>,
  updateDocument: [] as Array<any[]>,
  deleteDocument: [] as Array<any[]>,
}));
vi.mock("@mcpedia/core", () => ({
  keywordSearch: () => Promise.resolve([]),
  getDocument: () => Promise.resolve(null),
  getRelated: () => Promise.resolve([]),
  hybridSearch: () => Promise.resolve([]),
  semanticSearch: () => Promise.resolve([]),
  listDocuments: () => Promise.resolve([]),
  listRevisions: () => Promise.resolve([]),
  getRevision: () => Promise.resolve(null),
  restoreRevision: () => Promise.resolve(null),
  createDocument: (...args: any[]) => {
    coreCalls.createDocument.push(args);
    return Promise.resolve({ slug: "docs/test", title: "Test" });
  },
  updateDocument: (...args: any[]) => {
    coreCalls.updateDocument.push(args);
    return Promise.resolve({ slug: args[0], title: "Updated" });
  },
  deleteDocument: (...args: any[]) => {
    coreCalls.deleteDocument.push(args);
    return Promise.resolve({ deleted: true });
  },
}));

let SECRET: string;
beforeEach(() => {
  SECRET = "test-secret-" + Math.random().toString(36).slice(2);
});

test("GET /health returns { ok: true }", async () => {
  const app = await createApp(makeDeps(SECRET, fakeQueue({})));
  const res = await app.request("/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

test("GET /metrics emits Prometheus text with all gauge states", async () => {
  const app = await createApp(
    makeDeps(
      SECRET,
      fakeQueue({ waiting: 1, active: 2, completed: 3, failed: 4, delayed: 5 }),
    ),
  );
  const res = await app.request("/metrics");
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toMatch(/text\/plain/);
  const text = await res.text();
  expect(text).toContain("mcpedia_uptime_seconds");
  expect(text).toContain('mcpedia_queue_jobs{state="waiting"} 1');
  expect(text).toContain('mcpedia_queue_jobs{state="active"} 2');
  expect(text).toContain('mcpedia_queue_jobs{state="completed"} 3');
  expect(text).toContain('mcpedia_queue_jobs{state="failed"} 4');
  expect(text).toContain('mcpedia_queue_jobs{state="delayed"} 5');
});

test("POST /hooks/reindex without secret -> 401", async () => {
  const app = await createApp(makeDeps(SECRET, fakeQueue({})));
  const res = await app.request("/hooks/reindex", { method: "POST" });
  expect(res.status).toBe(401);
  expect((await res.json()).error).toBe("unauthorized");
});

test("POST /hooks/reindex with correct x-webhook-secret -> 200", async () => {
  const app = await createApp(makeDeps(SECRET, fakeQueue({})));
  const res = await app.request("/hooks/reindex", {
    method: "POST",
    headers: { "x-webhook-secret": SECRET },
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.kind).toBe("full");
  expect(body.jobId).toBeTruthy();
});

test("POST /hooks/index without slug -> 400", async () => {
  const app = await createApp(makeDeps(SECRET, fakeQueue({})));
  const res = await app.request("/hooks/index", {
    method: "POST",
    headers: { "x-webhook-secret": SECRET },
  });
  expect(res.status).toBe(400);
});

test("POST /hooks/index with slug + secret -> 200 + relPath", async () => {
  const app = await createApp(makeDeps(SECRET, fakeQueue({})));
  const res = await app.request("/hooks/index?slug=docs/test", {
    method: "POST",
    headers: { "x-webhook-secret": SECRET },
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.relPath).toBe("docs/test.md");
});

test("POST /hooks/index with wrong secret -> 401", async () => {
  const app = await createApp(makeDeps(SECRET, fakeQueue({})));
  const res = await app.request("/hooks/index?slug=docs/test", {
    method: "POST",
    headers: { "x-webhook-secret": "WRONG" },
  });
  expect(res.status).toBe(401);
});

test("GET /dashboard returns the self-contained HTML", async () => {
  const app = await createApp(makeDeps(SECRET, fakeQueue({})));
  const res = await app.request("/dashboard");
  expect(res.status).toBe(200);
  const html = await res.text();
  // The dashboard HTML is a module-level constant — assert the route serves it
  // verbatim and contains the key landmarks.
  expect(html).toContain("MCPedia Dashboard");
  expect(html).toContain("Index Queue (BullMQ)");
  expect(html).toContain(DASHBOARD_HTML.slice(0, 100));
});

// --- Phase 11: CRUD tRPC procedures (auth-gated) ---

function trpcRequest(app: Hono, procedure: string, input: unknown, secret?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (secret) headers["x-webhook-secret"] = secret;
  // tRPC fetch adapter expects the procedure input directly as the JSON body
  // (not wrapped in a JSON-RPC envelope). The procedure name comes from the URL.
  return app.request("/trpc/" + procedure, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
}

test("tRPC createDocument without secret -> rejects (tRPC error)", async () => {
  const app = await createApp(makeDeps(SECRET, fakeQueue({})));
  const res = await trpcRequest(app, "createDocument", {
    slug: "docs/test", title: "Test", section: "docs", body: "# Hi"
  });
  // tRPC middleware throws Error -> JSON-RPC error (httpStatus 500, not 401)
  expect(res.status).toBe(500);
  expect(coreCalls.createDocument).toHaveLength(0);
});

test("tRPC createDocument with secret -> 200 + calls core", async () => {
  const app = await createApp(makeDeps(SECRET, fakeQueue({})));
  const res = await trpcRequest(app, "createDocument", {
    slug: "docs/test", title: "Test", section: "docs", body: "# Hi"
  }, SECRET);
  expect(res.status).toBe(200);
  expect(coreCalls.createDocument).toHaveLength(1);
});

test("tRPC updateDocument with secret -> 200 + calls core", async () => {
  const app = await createApp(makeDeps(SECRET, fakeQueue({})));
  const res = await trpcRequest(app, "updateDocument", {
    slug: "docs/test", body: "# Updated"
  }, SECRET);
  expect(res.status).toBe(200);
  expect(coreCalls.updateDocument).toHaveLength(1);
});

test("tRPC deleteDocument without secret -> rejects (tRPC error)", async () => {
  const app = await createApp(makeDeps(SECRET, fakeQueue({})));
  const res = await trpcRequest(app, "deleteDocument", {
    slug: "docs/test"
  });
  // tRPC middleware throws Error -> JSON-RPC error (httpStatus 500, not 401)
  expect(res.status).toBe(500);
  expect(coreCalls.deleteDocument).toHaveLength(0);
});

test("tRPC deleteDocument with secret -> 200 + calls core", async () => {
  const app = await createApp(makeDeps(SECRET, fakeQueue({})));
  const res = await trpcRequest(app, "deleteDocument", {
    slug: "docs/test"
  }, SECRET);
  expect(res.status).toBe(200);
  expect(coreCalls.deleteDocument).toHaveLength(1);
});
