import { McpediaClient } from "./client"

// One-shot MCP client — runs a single tool call and prints the result.
//
// Usage:
//   bun run ask search "websocket"
//   bun run ask doc docs/websocket/contract
//   bun run ask tools
//   bun run ask resources
//   bun run ask hybrid "what is MCP"
//   bun run ask create --slug=docs/my-doc --title="My Doc" --body="Hello"
//       (note: create requires WEBHOOK_SECRET env)
//   bun run ask delete docs/my-doc

const MCP_URL = process.env.MCP_URL ?? "https://mcp.asepharyana.my.id/mcp"

/** The section `createDocument` falls back to when none is given. */
const DEFAULT_DOC_SECTION = "docs"

/**
 * Narrow a free-text `--section=` argument to a section the server knows.
 *
 * ## WHY THIS ASKS THE SERVER RATHER THAN CHECKING A LOCAL LIST
 *
 * This used to validate against a hardcoded `["docs","writeups","research",
 * "notes"]`. Those four were the whole section vocabulary when the CLI was
 * written; sections are registry CONTENT now, held in the `sections` table and
 * editable through MCP, so that tuple was a second source of truth that silently
 * rejected every section an operator added — `ask create --section=threat-intel`
 * failed on a section the server would have accepted, and the error named four
 * names that were no longer the complete set. create_document itself takes
 * `z.string()`, so the CLI was stricter than the API it wraps.
 *
 * The registry is read over the same connection the write will use, so a section
 * that validates here is a section that exists there. An unreachable server is
 * reported as an unreachable server; it is NOT treated as an empty registry,
 * which would make every section look unknown.
 *
 * A section with no registry row is still legal to write to — unregistering a
 * section deliberately leaves its documents in place — so the check is a guard
 * against typos, and `--force` is the escape hatch for a deliberately
 * unregistered section.
 */
async function toDocSection(
	client: McpediaClient,
	raw: string | undefined,
	force: boolean,
): Promise<string> {
	if (raw === undefined || raw === "") return DEFAULT_DOC_SECTION
	if (force) return raw

	const sections = await client.listSections()
	if (sections.length === 0) {
		throw new Error(
			`The server reported no sections at all, so "${raw}" cannot be validated. ` +
				`Pass --force to write to it anyway.`,
		)
	}
	const ids = sections.map((s) => s.id)
	if (!ids.includes(raw)) {
		throw new Error(
			`Unknown section "${raw}". The registry has: ${ids.join(", ")}. ` +
				`Register it with upsert_section, or pass --force to write to an ` +
				`unregistered section.`,
		)
	}
	return raw
}

async function main() {
	const [, , command, ...args] = process.argv
	if (!command) {
		console.error("Usage: ask <command> [args...]")
		console.error(
			"Commands: tools, resources, search <q>, ss <q>, hybrid <q>, doc <slug>, related <slug>, create, delete <slug>, index <slug>, status",
		)
		process.exit(1)
	}

	const headers: Record<string, string> = {}
	const secret = process.env.WEBHOOK_SECRET
	if (secret) headers["x-webhook-secret"] = secret

	const client = await McpediaClient.connect(MCP_URL, { headers })

	try {
		switch (command) {
			case "tools": {
				const tools = await client.listTools()
				console.log(
					JSON.stringify(
						tools.map((t) => ({
							name: t.name,
							description: t.description,
						})),
						null,
						2,
					),
				)
				break
			}
			case "resources": {
				const res = await client.listResources()
				console.log(JSON.stringify(res, null, 2))
				break
			}
			case "search": {
				const q = args.join(" ")
				if (!q) throw new Error("search requires a query")
				const hits = await client.search(q)
				console.log(JSON.stringify(hits, null, 2))
				break
			}
			case "ss": {
				const q = args.join(" ")
				if (!q) throw new Error("ss requires a query")
				const hits = await client.semanticSearch(q)
				console.log(JSON.stringify(hits, null, 2))
				break
			}
			case "hybrid": {
				const q = args.join(" ")
				if (!q) throw new Error("hybrid requires a query")
				const hits = await client.hybridSearch(q)
				console.log(JSON.stringify(hits, null, 2))
				break
			}
			case "doc": {
				const slug = args[0]
				if (!slug) throw new Error("doc requires a slug")
				const body = await client.getDocument(slug)
				console.log(body)
				break
			}
			case "related": {
				const slug = args[0]
				if (!slug) throw new Error("related requires a slug")
				const rel = await client.getRelated(slug)
				console.log(JSON.stringify(rel, null, 2))
				break
			}
			case "create": {
				const opts: Record<string, string> = {}
				for (const arg of args) {
					const [k, v] = arg.split("=") as [string, string]
					if (k && v) opts[k.replace("--", "")] = v
				}
				const res = await client.createDocument({
					slug: opts.slug || "",
					title: opts.title || "Untitled",
					section: await toDocSection(
						client,
						opts.section,
						opts.force === "true",
					),
					body: opts.body || "",
					tags: opts.tags ? opts.tags.split(",") : [],
					author: opts.author,
				})
				console.log(JSON.stringify(res, null, 2))
				break
			}
			case "delete": {
				const slug = args[0]
				if (!slug) throw new Error("delete requires a slug")
				const res = await client.deleteDocument(slug)
				console.log(JSON.stringify(res, null, 2))
				break
			}
			case "index": {
				const slug = args[0]
				if (!slug) throw new Error("index requires a slug")
				const res = await client.indexDocument(slug)
				console.log(JSON.stringify(res, null, 2))
				break
			}
			case "status": {
				const res = await client.queueStatus()
				console.log(JSON.stringify(res, null, 2))
				break
			}
			default:
				console.error(`Unknown command: ${command}`)
				process.exit(1)
		}
	} finally {
		await client.disconnect()
	}
}

main().catch((err) => {
	const msg = err instanceof Error ? err.message : String(err)
	if (msg.includes("unauthorized")) {
		console.error(
			"⚠️  Write tools require x-webhook-secret. Set WEBHOOK_SECRET env var.",
		)
	} else {
		console.error(`Error: ${msg}`)
	}
	process.exit(1)
})
