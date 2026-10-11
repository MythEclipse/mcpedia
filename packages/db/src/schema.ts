import { sql, SQL } from "drizzle-orm"
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
	vector,
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
// body. `embedding` is a plain float array (real[]). We compute cosine
// similarity in the application layer — pgvector isn't available on the shared
// imrnes Postgres, and brute-force cosine is instant for a KB-sized corpus.
// (pgvector/HNSW is the Phase-4 scale-out path.)
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
