#!/usr/bin/env node
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
/**
 * The static file server for the MCPedia web SPA on :4016.
 *
 * WHY THIS EXISTS RATHER THAN `vite preview`. Three reasons, each of which
 * would break the deploy on its own:
 *
 *  1. `vite preview` lives in apps/web/node_modules, and the deploy script
 *     stages exactly one directory — apps/web/dist — under
 *     /opt/mcpedia-web/share. A preview server would need node_modules copied
 *     alongside it.
 *  2. Vite documents `preview` as a local convenience, not a production server.
 *     It is not hardened, and its defaults (host, caching, error pages) are not
 *     what a public domain should be served with.
 *  3. Serving a directory listing of hashed build output is a category of
 *     mistake worth removing structurally. This server only ever emits two
 *     things: an asset that exists, or index.html.
 *
 * WHY THE SPA FALLBACK IS HERE. The router is a TanStack Router client-side
 * router, so every real route arrives here as a bare path like /section/docs.
 * Without the fallback those would 404 on a hard refresh; with it they return
 * index.html and the router resolves them in the browser. The exception is the
 * asset probe: if the request looks like a file (has an extension) and is not
 * present, that is a genuinely missing build artifact and must 404 rather than
 * silently return HTML that the browser will try to execute as a module.
 *
 * Node's stdlib only. The host runs this with a bare `node`, so anything beyond
 * http/fs/path would have to be installed there, and a static file server is
 * not worth a runtime dependency.
 */
import { createServer } from "node:http"
import { extname, join, normalize, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(new URL("./dist", import.meta.url)))
const port = Number(process.env.PORT ?? 4016)
const host = process.env.HOST ?? "127.0.0.1"

/**
 * Content types for the handful of extensions the SPA build emits.
 *
 * An explicit table rather than a lookup library: the set is closed and known,
 * and the one entry that really matters is the JavaScript MIME type — the
 * browser refuses to execute a module served as anything else, which turns a
 * wrong header into a blank page instead of an error.
 */
const TYPES = new Map([
	[".html", "text/html; charset=utf-8"],
	[".js", "text/javascript; charset=utf-8"],
	[".css", "text/css; charset=utf-8"],
	[".json", "application/json; charset=utf-8"],
	[".svg", "image/svg+xml"],
	[".ico", "image/x-icon"],
	[".png", "image/png"],
	[".jpg", "image/jpeg"],
	[".webp", "image/webp"],
	[".woff", "font/woff"],
	[".woff2", "font/woff2"],
	[".map", "application/json; charset=utf-8"],
])

/**
 * Resolve a URL path to a file inside dist/, or null if it escapes.
 *
 * The traversal guard is the reason this is not one line. `normalize` alone
 * still lets `../../etc/passwd` collapse to a path outside root, so the result
 * is compared against root after normalization and rejected unless it is a
 * strict descendant. A request can therefore never name a file the server did
 * not intend to publish.
 */
function resolveWithinRoot(pathname) {
	const decoded = decodeURIComponent(pathname)
	const candidate = resolve(join(root, normalize(decoded)))
	if (candidate !== root && !candidate.startsWith(root + sep)) return null
	return candidate
}

async function statFile(path) {
	try {
		const s = await stat(path)
		return s.isFile() ? s : null
	} catch {
		return null
	}
}

const server = createServer((req, res) => {
	void (async () => {
		const { pathname } = new URL(
			req.url ?? "/",
			`http://${req.headers.host ?? "localhost"}`,
		)

		const send = (status, path) => {
			res.writeHead(status, {
				"content-type": TYPES.get(extname(path)) ?? "application/octet-stream",
				// Hashed asset filenames are content-addressed, so they can be
				// cached indefinitely; index.html must never be, or a deploy
				// would keep serving the old document that names old assets.
				"cache-control": path.endsWith("index.html")
					? "no-cache"
					: "public, max-age=31536000, immutable",
			})
			createReadStream(path).pipe(res)
		}

		const target = resolveWithinRoot(
			pathname === "/" ? "/index.html" : pathname,
		)

		if (target) {
			const direct = await statFile(target)
			if (direct) {
				send(200, target)
				return
			}
			// A directory request (/section/) serves that directory's index.
			const index = await statFile(join(target, "index.html"))
			if (index) {
				send(200, index)
				return
			}
		}

		// Looks like a file but is not one: a real 404, not the SPA shell.
		if (extname(pathname)) {
			res.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
			res.end("not found")
			return
		}

		const shell = join(root, "index.html")
		if (!(await statFile(shell))) {
			res.writeHead(500, { "content-type": "text/plain; charset=utf-8" })
			res.end(
				`no build found at ${root} — run \`pnpm --filter @mcpedia/web build\``,
			)
			return
		}
		send(200, shell)
	})()
})

server.listen(port, host, () => {
	console.log(`mcpedia-web serving ${root} on http://${host}:${port}`)
})
