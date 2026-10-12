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
	restoreRevision,
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
				"Full-text search across the MCPedia knowledge base (Postgres FTS). Returns ranked documents with a headline snippet.",
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
				"Hybrid search fusing full-text (Postgres FTS) and semantic (embedding) signals via Reciprocal Rank Fusion. Best general-purpose search.",
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
		"mcpedia-doc-chunks",
		new ResourceTemplate("mcpedia://docs/{+slug}/chunks", { list: undefined }),
		{
			title: "MCPedia document chunks",
			description: "Preview of the embedded semantic chunks for a document.",
			mimeType: "application/json",
		},
		async (uri, vars) => {
			const slug = String(vars.slug)
			const doc = await getDocument(slug)
			if (!doc) throw new Error(`Document not found: ${slug}`)
			// Chunk the body the same way the indexer does (size 1000 / overlap 150)
			// so the resource mirrors what semantic search actually sees.
			const { chunkText } = await import("@mcpedia/embeddings")
			const chunks = chunkText(doc.body, { size: 1000, overlap: 150 })
			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "application/json",
						text: JSON.stringify(
							chunks.map((c, i) => ({
								index: i,
								length: c.length,
								preview: c.slice(0, 200),
							})),
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
