/**
 * The application layer: use cases, built by factories.
 *
 * Every file here depends on `../domain` and nothing else from the outside
 * world. That is what makes the use cases testable with plain object literals —
 * a `make*` factory takes its collaborators as an argument, so a test supplies
 * `vi.fn()`s and exercises real logic with no database, no Redis and no disk.
 *
 * The composition root (infrastructure/compose.ts) is the ONLY place that knows
 * which concrete implementation satisfies each port. Everything else receives
 * its dependencies already bound.
 */
export * from "./document.use-cases"
export * from "./read.use-cases"
export * from "./index.use-cases"
export * from "./revision.use-cases"
export * from "./export.use-cases"
