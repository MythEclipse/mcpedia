import { type SQL, sql } from "drizzle-orm"
import {
	boolean,
	customType,
	index,
	integer,
	jsonb,
	pgTable,
	real,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core"

// tsvector isn't a first-class drizzle type; wrap the raw Postgres type.
const tsvector = customType<{ data: string }>({
	dataType() {
		return "tsvector"
	},
})

export const documents = pgTable(
	"documents",
	{
		id: text("id").primaryKey(), // slug
		slug: text("slug").notNull().unique(),
		title: text("title").notNull(),
		type: text("type").notNull(),
		section: text("section").notNull(),
		status: text("status").notNull().default("published"),
		author: text("author").notNull().default(""),
		tags: text("tags").array().notNull().default(sql`'{}'`),
		path: text("path").notNull(),
		body: text("body").notNull().default(""),
		// Weighted search vector: title (A) + body (B), using the 'simple' config so
		// mixed ID/EN queries match literally without stemming. Lazy closure over
		// `documents` (must NOT reference the table eagerly — it is in TDZ here).
		searchVector: tsvector("search_vector")
			.notNull()
			.generatedAlwaysAs(
				(): SQL =>
					sql`setweight(to_tsvector('simple', coalesce(${documents.title}, '')), 'A') || setweight(to_tsvector('simple', coalesce(${documents.body}, '')), 'B')`,
			),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
		// Dynamic custom metadata fields (JSONB) — e.g. CTF writeup fields
		// (event, challenge, category, difficulty, points). Content creators
		// add arbitrary key-value pairs that are rendered as dynamic badges.
		extraFields: jsonb("extra_fields").notNull().default(sql`'{}'::jsonb`),
	},
	(t) => ({
		searchIdx: index("documents_search_idx").using("gin", t.searchVector),
		sectionIdx: index("documents_section_idx").on(t.section),
	}),
)

// Phase 2: semantic search chunks. Each row is an embedded slice of a document
// LEGACY. Nothing writes to this table any more.
//
// It stored the local chunker's output plus its embeddings, which is exactly
// what hindsight now produces on its own side. The declaration is KEPT on
// purpose, for two reasons:
//
//   1. Removing it from the schema would make the next `drizzle-kit generate`
//      emit a DROP TABLE, silently deleting every stored chunk on migrate.
//      That is a destructive, irreversible change to a live database and it
//      must be a deliberate migration, never a side effect of a search
//      refactor.
//   2. `onDelete: "cascade"` plus the explicit delete in
//      drizzle.document.repository.ts keeps a deleted document from leaving
//      orphaned chunk rows behind, which is still the right behaviour while
//      the table exists.
//
// Nothing reads from it. The drop belongs in its own reviewed migration, once
// someone confirms no rollback to the old search path is needed.
export const documentChunks = pgTable(
	"document_chunks",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		documentId: text("document_id")
			.notNull()
			.references(() => documents.id, { onDelete: "cascade" }),
		slug: text("slug").notNull(),
		chunkIndex: integer("chunk_index").notNull(),
		content: text("content").notNull(),
		// `embedding` is a plain float array (real[]) rather than a pgvector
		// column because the shared imrnes Postgres has no pgvector extension.
		embedding: real("embedding").array(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => ({
		slugIdx: index("document_chunks_slug_idx").on(t.slug),
	}),
)

export type DocumentChunkRow = typeof documentChunks.$inferSelect
export type NewDocumentChunkRow = typeof documentChunks.$inferInsert

// Phase 3: document revision system. Each row is an immutable snapshot of a
// document's body + metadata at a point in time (taken by the indexer whenever
// the body actually changes). revisionNo is per-document and monotonically
// increasing so the latest revision is always max(revision_no).
export const documentRevisions = pgTable(
	"document_revisions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		documentId: text("document_id")
			.notNull()
			.references(() => documents.id, { onDelete: "cascade" }),
		slug: text("slug").notNull(),
		revisionNo: integer("revision_no").notNull(),
		title: text("title").notNull(),
		body: text("body").notNull(),
		// Metadata snapshot (type/section/status/author/tags) as JSON so a revision
		// is self-describing even if the live document is later restructured.
		meta: jsonb("meta").notNull().$type<{
			type: string
			section: string
			status: string
			author: string
			tags: string[]
		}>(),
		// Why this revision was created (e.g. "index", "git-push", "restore").
		reason: text("reason").notNull().default("index"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => ({
		docIdx: index("document_revisions_document_id_idx").on(t.documentId),
		slugIdx: index("document_revisions_slug_idx").on(t.slug),
		docRevIdx: index("document_revisions_doc_rev_idx").on(
			t.documentId,
			sql`${t.revisionNo} desc`,
		),
	}),
)

export type DocumentRevisionRow = typeof documentRevisions.$inferSelect
export type NewDocumentRevisionRow = typeof documentRevisions.$inferInsert

/**
 * The audit trail: who changed what, when, and through which credential.
 *
 * ## WHY THIS IS A TABLE AND NOT A LOG LINE
 *
 * Every write in this system is reversible, which is exactly what makes an
 * append-only record of the writes worth keeping. The revisions table answers
 * "what did this document look like before"; it cannot answer "who deleted it",
 * and after a deletion there is nothing left to inspect. An audit row is written
 * in the SAME transaction as the change it describes, so an entry cannot exist
 * for a write that was rolled back — a log line can, and would lie.
 *
 * `actorId` is nullable on purpose. A migration run by the indexer and a write
 * by the MCP server both mutate documents, and neither has a better-auth user
 * id. Recording NULL ("system") is honest; recording a placeholder user id
 * would be a lie that later reads as a real actor.
 *
 * `via` records WHICH credential performed the write, which is the one fact
 * that distinguishes a human editing in a browser from a machine re-indexing.
 * Both are legitimate; only the audit row says which happened.
 */
export const documentActivity = pgTable(
	"document_activity",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		/**
		 * The better-auth user, or NULL for a system-initiated write.
		 *
		 * Deliberately NOT a foreign key with `onDelete: cascade` — that would
		 * erase the audit history the moment the account was removed, which is
		 * precisely the case an audit log exists to survive.
		 */
		actorId: text("actor_id"),
		/** "admin" | "user" at the time of the write, or NULL for system writes. */
		actorRole: text("actor_role"),
		/** "webhook-secret" | "session" | "system". */
		via: text("via").notNull().default("system"),
		/** create | update | delete | restore | index | export */
		action: text("action").notNull(),
		/** The document slug acted on. Plain text, not an FK: a delete must keep
		 * its trail even though the row it referenced is gone. */
		resource: text("resource").notNull().default("document"),
		/**
		 * The identifier of the thing acted on — the document slug.
		 *
		 * NOT NULL, and not a foreign key. Both are load-bearing: a nullable
		 * resource id would make "everything that happened to this document" need
		 * a NULL-guard on every read, and a foreign key would delete the audit
		 * row when the document was deleted — erasing the only remaining record
		 * of the thing that happened to it.
		 */
		resourceId: text("resource_id").notNull(),
		/**
		 * Free-form detail — what changed, why, which job id, which commit.
		 *
		 * JSONB rather than columns because the shape differs per action, and a
		 * union of five payload types in a table schema buys nothing over one
		 * JSONB column that the domain types at the port.
		 */
		metadata: jsonb("metadata")
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => ({
		// Supports "what happened to this document" — the query an audit is read
		// for. Leading with slug would help a by-document view but not the
		// recent-activity feed, which is what this table is actually read for.
		createdIdx: index("document_activity_created_at_idx").on(t.createdAt),
		resourceIdx: index("document_activity_resource_idx").on(
			t.resource,
			t.resourceId,
		),
		actorIdx: index("document_activity_actor_id_idx").on(t.actorId),
	}),
)

export type DocumentActivityRow = typeof documentActivity.$inferSelect
export type NewDocumentActivityRow = typeof documentActivity.$inferInsert

export type DocumentRow = typeof documents.$inferSelect
export type NewDocumentRow = typeof documents.$inferInsert

// ---------------------------------------------------------------------------
// better-auth single-tenant user model
// ---------------------------------------------------------------------------
//
// better-auth's drizzle adapter addresses tables by the KEY they are exported
// under (`config.schema[model]` in
// @better-auth/drizzle-adapter/dist/index.mjs, `getSchema()`), and each column
// by the Drizzle property name. With default options it also validates the
// schema at runtime (`checksSchema`), comparing against `getAuthTables({})`.
// Both facts are load-bearing and were verified against the installed 1.7.7,
// not from documentation:
//
//   - Model keys: user, session, account, verification (singular, not plural —
//     `usePlural` defaults to false).
//   - Field names: camelCase, unsnake_cased. better-auth's own generator only
//     snake_cases when `camelCase: false` is passed to the adapter, and we do
//     not pass it, so the field names below are `emailVerified`, `userId`,
//     `ipAddress`, `accessTokenExpiresAt` and so on. Underscored columns would
//     make every lookup miss.
//   - Nullable-or-defaulted: `diffSchema` rejects any column it never writes
//     that is neither nullable nor defaulted. `role` is declared below as
//     `additionalFields`, so better-auth DOES write it (to "user" on insert),
//     and it additionally carries a DEFAULT so a row created by hand or by a
//     future admin path still satisfies the constraint.
//
// These four names do not collide with documents / document_chunks /
// document_revisions, so 0001 is purely additive.

export const AUTH_ROLES = ["admin", "user"] as const
export type AuthRole = (typeof AUTH_ROLES)[number]

export const user = pgTable(
	"user",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		email: text("email").notNull().unique(),
		emailVerified: boolean("email_verified").notNull().default(false),
		image: text("image"),
		// Single-tenant: "admin" may author and mutate; "user" is read-only.
		// Stored as text rather than a pg enum so adding a role later is an
		// additive migration, not an ALTER TYPE.
		role: text("role").$type<AuthRole>().notNull().default("user"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(t) => ({
		roleIdx: index("user_role_idx").on(t.role),
	}),
)

export const session = pgTable(
	"session",
	{
		id: text("id").primaryKey(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		token: text("token").notNull().unique(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(t) => ({
		userIdx: index("session_user_id_idx").on(t.userId),
		expiresIdx: index("session_expires_at_idx").on(t.expiresAt),
	}),
)

export const account = pgTable(
	"account",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: timestamp("access_token_expires_at", {
			withTimezone: true,
		}),
		refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
			withTimezone: true,
		}),
		scope: text("scope"),
		password: text("password"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(t) => ({
		userIdx: index("account_user_id_idx").on(t.userId),
		// better-auth resolves a credential account by provider+accountId.
		providerIdx: index("account_provider_account_idx").on(
			t.providerId,
			t.accountId,
		),
	}),
)

export const verification = pgTable(
	"verification",
	{
		id: text("id").primaryKey(),
		identifier: text("identifier").notNull(),
		value: text("value").notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(t) => ({
		identifierIdx: index("verification_identifier_idx").on(t.identifier),
	}),
)

export type UserRow = typeof user.$inferSelect
export type SessionRow = typeof session.$inferSelect
