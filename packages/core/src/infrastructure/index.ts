/**
 * The infrastructure layer: everything that talks to Postgres, the embedding
 * provider, the filesystem and the parser.
 *
 * Imports point INWARD only — infrastructure/ may depend on domain/, never the
 * reverse. That direction is the entire point of the hexagonal split, and it is
 * what lets the application layer be exercised with fakes.
 */
export * from "./drizzle.activity.repository"
export * from "./drizzle.document.repository"
export * from "./drizzle.revision.repository"
export * from "./adapters"
export * from "./compose"
export * from "./search.service"
export * from "./content.service"
