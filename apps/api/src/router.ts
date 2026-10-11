import { z } from "zod";
import { publicProcedure, router, t } from "./trpc";
import {
  getDocument,
  getRelated,
  hybridSearch,
  keywordSearch,
  listDocuments,
  listSections,
  semanticSearch,
  listRevisions,
  getRevision,
  restoreRevision,
  createDocument,
  updateDocument,
  deleteDocument,
} from "@mcpedia/core";
import { getQueue, INDEX_QUEUE } from "@mcpedia/queue";
import { getConnection, BULLMQ_PREFIX } from "@mcpedia/queue/client";
import { safeSecretEqual } from "./secret";

// restoreRevision and CRUD operations are state-changing actions.
// They must NOT be callable anonymously over the network —
// only an operator with the webhook secret (or authorized UI) may execute them.
const requireWriteAuth = t.middleware(({ ctx, next }) => {
  if (!ctx.expectedSecret) {
    throw new Error("WEBHOOK_SECRET is not configured; writes are disabled");
  }
  if (!ctx.webhookSecret || !safeSecretEqual(ctx.webhookSecret, ctx.expectedSecret)) {
    throw new Error("unauthorized: missing or invalid x-webhook-secret");
  }
  return next();
});

export const appRouter = router({
  search: publicProcedure
    .input(z.object({ q: z.string(), limit: z.number().int().min(1).max(50).default(20) }))
    .query(({ input }) => keywordSearch(input.q, input.limit)),

  semanticSearch: publicProcedure
    .input(z.object({ q: z.string(), limit: z.number().int().min(1).max(50).default(10) }))
    .query(async ({ input }) => semanticSearch(input.q, input.limit)),

  hybridSearch: publicProcedure
    .input(z.object({ q: z.string(), limit: z.number().int().min(1).max(50).default(10) }))
    .query(async ({ input }) => hybridSearch(input.q, input.limit)),

  getDocument: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input }) => getDocument(input.slug)),

  listDocuments: publicProcedure
    .input(z.object({ section: z.string().optional(), status: z.string().optional() }).optional())
    .query(async ({ input }) => listDocuments(input ?? {})),

  sections: publicProcedure.query(async () => listSections()),

  related: publicProcedure
    .input(z.object({ slug: z.string(), limit: z.number().int().min(1).max(20).default(5) }))
    .query(async ({ input }) => getRelated(input.slug, input.limit)),

  // --- Revisions ---
  revisions: publicProcedure
    .input(z.object({ slug: z.string(), limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ input }) => listRevisions(input.slug, input.limit)),

  getRevision: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => getRevision(input.id)),

  restoreRevision: publicProcedure
    .use(requireWriteAuth)
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => restoreRevision(input.id)),

  // --- CRUD (gated by x-webhook-secret / admin auth) ---
  createDocument: publicProcedure
    .use(requireWriteAuth)
    .input(
      z.object({
        slug: z.string().min(1),
        title: z.string().min(1),
        section: z.string().min(1),
        body: z.string(),
        type: z.string().optional(),
        status: z.enum(["published", "draft"]).optional(),
        author: z.string().optional(),
        tags: z.array(z.string()).optional(),
        extraFields: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input }) => createDocument(input)),

  updateDocument: publicProcedure
    .use(requireWriteAuth)
    .input(
      z.object({
        slug: z.string().min(1),
        title: z.string().min(1).optional(),
        body: z.string().optional(),
        section: z.string().min(1).optional(),
        type: z.string().optional(),
        status: z.enum(["published", "draft"]).optional(),
        tags: z.array(z.string()).optional(),
        author: z.string().optional(),
        extraFields: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { slug, ...rest } = input;
      return updateDocument(slug, rest);
    }),

  deleteDocument: publicProcedure
    .use(requireWriteAuth)
    .input(z.object({ slug: z.string().min(1) }))
    .mutation(async ({ input }) => deleteDocument(input.slug)),

  // --- Async job status ---
  jobStatus: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const queue = getQueue();
      const job = await queue.getJob(input.id);
      if (!job) return { exists: false };
      const state = await job.getState();
      const failedReason = job.failedReason;
      const returnvalue = job.returnvalue;
      const progress = job.progress;
      return {
        exists: true,
        id: job.id,
        name: job.name,
        state,
        progress,
        failedReason,
        returnvalue,
        attemptsMade: job.attemptsMade,
      };
    }),

  queueStatus: publicProcedure.query(async () => {
    const queue = getQueue();
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);
    return {
      queue: INDEX_QUEUE,
      prefix: BULLMQ_PREFIX,
      counts: { waiting, active, completed, failed, delayed },
    };
  }),
});

export type AppRouter = typeof appRouter;
