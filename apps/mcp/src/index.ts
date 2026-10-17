import { createHash, timingSafeEqual } from "node:crypto"
import { WEBHOOK_SECRET } from "@mcpedia/config"
import {
	createDocument,
	deleteDocument,
	getDocument,
	getRelated,
	hybridSearch,
	keywordSearch,
	listDocuments,
	listRevisions,
	listSections,
	recallDocumentFacts,
	reflect,
	restoreRevision,
	sectionUseCases,
	semanticSearch,
	updateDocument,
} from "@mcpedia/core"
import {
	enqueueFullIndex,
	enqueueIndexDoc,
	getQueue,
	INDEX_QUEUE,
} from "@mcpedia/queue"
import {
	McpServer,
	ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

// Write tools require the caller to supply `x-webhook-secret` matching the
// configured WEBHOOK_SECRET. Read tools are open. `authSecret` is threaded from
// the HTTP transport (the request header); for stdio it is undefined (local use).
//
// This previously only checked that `authSecret` was non-empty, so ANY value —
// including a plain `x-webhook-secret: x` header, an empty-is-rejected-but-any-
// other-value-is-accepted mistake, or a duplicate header's first entry —
// authorized every write tool. WEBHOOK_SECRET was never imported here, so
// nothing in this file could have caught it. The HTTP transport listens on
// `*:MCP_PORT` (4021) and is reachable from the public internet.
function requireMcpAuth(authSecret?: string) {
	if (!WEBHOOK_SECRET) {
		throw new Error(
			"unauthorized: WEBHOOK_SECRET is not configured; writes are disabled",
		)
	}
	if (!authSecret) {
		throw new Error(
			"unauthorized: this tool requires the x-webhook-secret header",
		)
	}
	// Hash both sides so the comparison never branches on length: timingSafeEqual
	// throws on a length mismatch, so comparing raw strings would need a
	// pre-check that leaks the secret's length one character at a time.
	const digest = (s: string) => createHash("sha256").update(s).digest()
	if (!timingSafeEqual(digest(authSecret), digest(WEBHOOK_SECRET))) {
		throw new Error("unauthorized: invalid x-webhook-secret")
	}
}

export function createMcpServer(authSecret?: string): McpServer {
	const server = new McpServer({
		name: "mcpedia",
		version: "0.1.0",
	})

	server.registerTool(
		"search_documents",
		{
			description:
				"Keyword-weighted search across the MCPedia knowledge base. Returns ranked documents with a headline snippet. Ranking is hindsight's fused score, not a Postgres ts_rank.",
			inputSchema: z.object({
				query: z.string().describe("Free-text search query"),
				limit: z.number().int().positive().max(50).optional(),
			}),
		},
		async ({ query, limit }) => {
			const hits = await keywordSearch(query, limit ?? 20)
			return {
				content: [{ type: "text", text: JSON.stringify(hits, null, 2) }],
			}
		},
	)

	server.registerTool(
		"get_document",
		{
			description:
				"Fetch the full markdown body of a document by its slug (e.g. 'docs/websocket/contract').",
			inputSchema: z.object({
				slug: z
					.string()
					.describe("Document slug, e.g. 'docs/websocket/contract'"),
			}),
		},
		async ({ slug }) => {
			const doc = await getDocument(slug)
			if (!doc) {
				return {
					content: [{ type: "text", text: `Document not found: ${slug}` }],
					isError: true,
				}
			}
			return { content: [{ type: "text", text: doc.body }] }
		},
	)

	server.registerTool(
		"list_sections",
		{
			description:
				"List all active knowledge base sections and document counts from PostgreSQL.",
			inputSchema: z.object({}),
		},
		async () => {
			const sections = await listSections()
			return {
				content: [{ type: "text", text: JSON.stringify(sections, null, 2) }],
			}
		},
	)

	server.registerTool(
		"list_section_registry",
		{
			description:
				"The full section registry: label, icon, description, order and hidden flag for every registered section. Includes hidden sections, which list_sections omits. Reads from the sections table.",
			inputSchema: z.object({}),
		},
		async () => {
			const rows = await sectionUseCases().list()
			return {
				content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
			}
		},
	)

	server.registerTool(
		"upsert_section",
		{
			description:
				"Register a section or update one that exists (this is where a section's name, icon and description live — previously hardcoded in the app). Requires the x-webhook-secret header. Omitted fields keep their defaults: label derives from the id, icon becomes 📁, hidden becomes false. Setting hidden omits the section from navigation without touching its documents.",
			inputSchema: z.object({
				id: z
					.string()
					.describe(
						"Section id — the first segment of every document slug in it (e.g. 'writeups'). Letters, digits, '-' and '_' only.",
					),
				label: z
					.string()
					.optional()
					.describe(
						"Display name (e.g. 'Writeups'). Defaults to the title-cased id.",
					),
				icon: z.string().optional().describe("An emoji or short glyph."),
				desc: z
					.string()
					.optional()
					.describe("One-line blurb shown on the home page."),
				sortOrder: z
					.number()
					.int()
					.optional()
					.describe("Navigation order; lower sorts first."),
				hidden: z
					.boolean()
					.optional()
					.describe("Unlist from navigation (URL and documents still work)."),
			}),
		},
		async ({ id, label, icon, desc, sortOrder, hidden }) => {
			requireMcpAuth(authSecret)
			const row = await sectionUseCases().upsert({
				id,
				label,
				icon,
				desc,
				sortOrder,
				hidden,
			})
			return {
				content: [
					{
						type: "text",
						text: `Section upserted:\n${JSON.stringify(row, null, 2)}`,
					},
				],
			}
		},
	)

	server.registerTool(
		"delete_section",
		{
			description:
				"Unregister a section: removes its registry row (name, icon, description) and NOTHING else. Documents in that section are untouched and remain readable at their URLs, rendering with a title-cased label. To delete documents, delete them individually. Requires the x-webhook-secret header.",
			inputSchema: z.object({
				id: z.string().describe("The section id to unregister."),
			}),
		},
		async ({ id }) => {
			requireMcpAuth(authSecret)
			const result = await sectionUseCases().remove(id)
			return {
				content: [
					{
						type: "text",
						text: result.deleted
							? `Section "${id}" unregistered. Its documents were not touched.`
							: `No registry row for "${id}" — nothing to remove. Documents in that section, if any, are unaffected.`,
					},
				],
			}
		},
	)

	server.registerTool(
		"list_documents",
		{
			description: "List documents, optionally filtered by section.",
			inputSchema: z.object({
				section: z
					.string()
					.optional()
					.describe(
						"Section name to filter by (e.g. 'docs', 'writeups', 'ctf')",
					),
			}),
		},
		async ({ section }) => {
			const docs = await listDocuments({ section })
			return {
				content: [{ type: "text", text: JSON.stringify(docs, null, 2) }],
			}
		},
	)

	server.registerTool(
		"get_related_documents",
		{
			description: "Return documents that share tags with the given slug.",
			inputSchema: z.object({
				slug: z.string(),
				limit: z.number().int().positive().max(20).optional(),
			}),
		},
		async ({ slug, limit }) => {
			const related = await getRelated(slug, limit ?? 5)
			return {
				content: [{ type: "text", text: JSON.stringify(related, null, 2) }],
			}
		},
	)

	server.registerTool(
		"semantic_search",
		{
			description:
				"Semantic (embedding) search across chunked document content. Best for conceptual/paraphrased queries that don't share exact keywords. Returns chunks ranked by cosine similarity.",
			inputSchema: z.object({
				query: z.string().describe("Natural-language query"),
				limit: z.number().int().positive().max(50).optional(),
			}),
		},
		async ({ query, limit }) => {
			const hits = await semanticSearch(query, limit ?? 10)
			return {
				content: [{ type: "text", text: JSON.stringify(hits, null, 2) }],
			}
		},
	)

	server.registerTool(
		"hybrid_search",
		{
			description:
				"Hybrid search over the hindsight bank. Returns matching DOCUMENTS ranked by a fused keyword+semantic score. Best general-purpose search; use reflect only when you need synthesis across documents.",
			inputSchema: z.object({
				query: z.string().describe("Free-text or natural-language query"),
				limit: z.number().int().positive().max(50).optional(),
			}),
		},
		async ({ query, limit }) => {
			const hits = await hybridSearch(query, limit ?? 10)
			return {
				content: [{ type: "text", text: JSON.stringify(hits, null, 2) }],
			}
		},
	)

	server.registerTool(
		"reflect",
		{
			description:
				'SYNTHESIZE across the whole corpus. Runs hindsight\'s reasoning LLM over retrieved facts and observations to answer a question no single fact answers — e.g. "which technique needs no heap leak". Expensive (~16k input tokens per call, measured), so prefer hybrid_search for plain lookup and reach for this only when the answer must weigh several documents against each other.',
			inputSchema: z.object({
				query: z
					.string()
					.describe("A question that requires weighing multiple documents"),
				budget: z
					.enum(["low", "mid", "high"])
					.optional()
					.describe(
						"LLM effort. Defaults to low. Measured on a 3-document bank: low and mid differ by ~30 output tokens, because the corpus retrieval dominates — a bigger budget rarely buys more.",
					),
				maxTokens: z
					.number()
					.int()
					.positive()
					.optional()
					.describe("Cap on response tokens (server default 4096)"),
			}),
		},
		async ({ query, budget, maxTokens }) => {
			const answer = await reflect(query, {
				...(budget ? { budget } : {}),
				...(maxTokens ? { maxTokens } : {}),
			})
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								text: answer.text,
								usage: {
									inputTokens: answer.inputTokens,
									outputTokens: answer.outputTokens,
								},
							},
							null,
							2,
						),
					},
				],
			}
		},
	)

	// --- Mutating & admin tools (require x-webhook-secret) ---
	server.registerTool(
		"index_document",
		{
			description:
				"Enqueue a single-document reindex job (parses, upserts, re-embeds). Requires the x-webhook-secret header. slug is the content path without extension, e.g. 'docs/caddy/reverse-proxy'.",
			inputSchema: z.object({
				slug: z
					.string()
					.describe("Document slug, e.g. 'docs/caddy/reverse-proxy'"),
			}),
		},
		async ({ slug }) => {
			requireMcpAuth(authSecret)
			const relPath =
				slug.endsWith(".md") || slug.endsWith(".mdx") ? slug : `${slug}.md`
			const job = await enqueueIndexDoc(relPath, "mcp")
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({ ok: true, jobId: job.id, slug }),
					},
				],
			}
		},
	)

	server.registerTool(
		"reindex_all",
		{
			description:
				"Enqueue a full-corpus reindex (walks every content file). Requires the x-webhook-secret header.",
			inputSchema: z.object({}),
		},
		async () => {
			requireMcpAuth(authSecret)
			const job = await enqueueFullIndex("mcp")
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({ ok: true, jobId: job.id, kind: "full" }),
					},
				],
			}
		},
	)

	server.registerTool(
		"restore_revision",
		{
			description:
				"Restore a document revision by id (writes its body back into the live row + rebuilds chunks). Requires the x-webhook-secret header.",
			inputSchema: z.object({ id: z.string().describe("Revision UUID") }),
		},
		async ({ id }) => {
			requireMcpAuth(authSecret)
			const result = await restoreRevision(id)
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(result ?? { ok: false, error: "not found" }),
					},
				],
			}
		},
	)

	// --- CRUD write tools (require x-webhook-secret) ---
	server.registerTool(
		"create_document",
		{
			description:
				"Create a new document in PostgreSQL (writes DB row, revision, chunks, and disk backup). Requires the x-webhook-secret header.",
			inputSchema: z.object({
				slug: z
					.string()
					.describe(
						"URL-safe slug (e.g. 'docs/my-new-doc' or 'ctf/challenge-1')",
					),
				title: z.string().describe("Document title"),
				section: z
					.string()
					.describe(
						"Content section (e.g. 'docs', 'writeups', 'research', 'notes', 'guides', 'ctf')",
					),
				body: z.string().describe("Markdown body"),
				type: z
					.string()
					.optional()
					.describe(
						"Document type (e.g. 'documentation', 'writeup', 'research', 'note')",
					),
				status: z.enum(["published", "draft"]).optional(),
				author: z.string().optional(),
				tags: z.array(z.string()).optional(),
				extraFields: z
					.record(z.string(), z.unknown())
					.optional()
					.describe("Dynamic custom metadata key-value pairs"),
			}),
		},
		async ({
			slug,
			title,
			section,
			body,
			type,
			status,
			author,
			tags,
			extraFields,
		}) => {
			requireMcpAuth(authSecret)
			const doc = await createDocument({
				slug,
				title,
				section,
				body,
				type,
				status,
				author,
				tags,
				extraFields,
			})
			return {
				content: [
					{ type: "text", text: JSON.stringify({ ok: true, slug: doc.slug }) },
				],
			}
		},
	)

	server.registerTool(
		"update_document",
		{
			description:
				"Update an existing document in PostgreSQL (title, body, section, tags, status, etc.). Requires the x-webhook-secret header.",
			inputSchema: z.object({
				slug: z.string().describe("Document slug to update"),
				title: z.string().optional(),
				body: z.string().optional(),
				section: z.string().optional(),
				type: z.string().optional(),
				status: z.enum(["published", "draft"]).optional(),
				tags: z.array(z.string()).optional(),
				author: z.string().optional(),
				extraFields: z
					.record(z.string(), z.unknown())
					.optional()
					.describe("Dynamic custom metadata key-value pairs"),
			}),
		},
		async ({
			slug,
			title,
			body,
			section,
			type,
			status,
			tags,
			author,
			extraFields,
		}) => {
			requireMcpAuth(authSecret)
			const doc = await updateDocument(slug, {
				title,
				body,
				section,
				type,
				status,
				tags,
				author,
				extraFields,
			})
			return {
				content: [
					{ type: "text", text: JSON.stringify({ ok: true, slug: doc.slug }) },
				],
			}
		},
	)

	server.registerTool(
		"delete_document",
		{
			description:
				"Delete a document (removes file + DB rows + chunks + revisions). Requires the x-webhook-secret header.",
			inputSchema: z.object({
				slug: z.string().describe("Document slug to delete"),
			}),
		},
		async ({ slug }) => {
			requireMcpAuth(authSecret)
			const result = await deleteDocument(slug)
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({ ok: true, deleted: result.deleted }),
					},
				],
			}
		},
	)

	server.registerTool(
		"queue_status",
		{
			description:
				"Current BullMQ index-queue counts (waiting/active/completed/failed/delayed).",
			inputSchema: z.object({}),
		},
		async () => {
			const queue = getQueue()
			const [waiting, active, completed, failed, delayed] = await Promise.all([
				queue.getWaitingCount(),
				queue.getActiveCount(),
				queue.getCompletedCount(),
				queue.getFailedCount(),
				queue.getDelayedCount(),
			])
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								queue: INDEX_QUEUE,
								counts: { waiting, active, completed, failed, delayed },
							},
							null,
							2,
						),
					},
				],
			}
		},
	)

	// --- MCP Resources (read-only knowledge base surfaced via URIs) ---
	// mcpedia://docs                       -> list all published documents
	// mcpedia://docs/{slug}                -> full markdown body (from disk)
	// mcpedia://docs/{slug}/chunks         -> chunked preview (semantic slices)
	// mcpedia://docs/{slug}/revisions      -> revision history summary
	server.registerResource(
		"mcpedia-docs-list",
		"mcpedia://docs",
		{
			title: "MCPedia document index",
			description: "List of all published documents in the knowledge base.",
			mimeType: "application/json",
		},
		async (uri) => {
			const docs = await listDocuments()
			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "application/json",
						text: JSON.stringify(docs, null, 2),
					},
				],
			}
		},
	)

	server.registerResource(
		"mcpedia-doc-facts",
		new ResourceTemplate("mcpedia://docs/{+slug}/facts", { list: undefined }),
		{
			title: "MCPedia document facts",
			description:
				"The facts hindsight extracted from a document — the units semantic search actually matches against.",
			mimeType: "application/json",
		},
		async (uri, vars) => {
			const slug = String(vars.slug)
			const doc = await getDocument(slug)
			if (!doc) throw new Error(`Document not found: ${slug}`)
			// This used to be a local `chunkText` preview, described as "the chunks
			// semantic search actually sees". That promise is now false: hindsight
			// does its own chunking and stores FACTS, so a locally-computed chunk
			// would mirror nothing. The resource now reports the real units, which
			// is the only version of this that an agent can trust.
			const facts = await recallDocumentFacts(slug)
			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "application/json",
						text: JSON.stringify(
							{
								slug,
								title: doc.title,
								// The body is chunked and embedded by hindsight; its internal
								// segmentation is deliberately not reproduced here, because
								// any local guess would differ from what search used.
								bodyLength: doc.body?.length ?? 0,
								facts,
							},
							null,
							2,
						),
					},
				],
			}
		},
	)

	server.registerResource(
		"mcpedia-doc-revisions",
		new ResourceTemplate("mcpedia://docs/{+slug}/revisions", {
			list: undefined,
		}),
		{
			title: "MCPedia document revisions",
			description: "Revision history summary for a document.",
			mimeType: "application/json",
		},
		async (uri, vars) => {
			const slug = String(vars.slug)
			const revs = await listRevisions(slug, 20)
			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "application/json",
						text: JSON.stringify(revs, null, 2),
					},
				],
			}
		},
	)

	// Registered LAST: the bare {+slug} template is greedy and would otherwise
	// swallow /chunks and /revisions URIs. Specific templates must match first.
	server.registerResource(
		"mcpedia-doc",
		new ResourceTemplate("mcpedia://docs/{+slug}", { list: undefined }),
		{
			title: "MCPedia document",
			description:
				"Full markdown body of a single document, read from disk (source of truth).",
			mimeType: "text/markdown",
		},
		async (uri, vars) => {
			const slug = String(vars.slug)
			const doc = await getDocument(slug)
			if (!doc) {
				throw new Error(`Document not found: ${slug}`)
			}
			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "text/markdown",
						text: doc.body,
					},
				],
			}
		},
	)

	return server
}

// When run directly (bun run src/index.ts), serve over stdio.
const isMain =
	process.argv[1] && import.meta.url === `file://${process.argv[1]}`
if (isMain) {
	const transport = new StdioServerTransport()
	await createMcpServer().connect(transport)
}
