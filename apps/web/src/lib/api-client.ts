/**
 * The SPA's typed view of the API: which procedures this app calls, and where.
 *
 * ## THE CREDENTIAL THE BROWSER MUST NOT HAVE
 *
 * The write gate (apps/api/src/presentation/middleware.ts) accepts exactly one
 * credential today: the `x-webhook-secret` header. The SPA must not learn the
 * secret's VALUE — the browser bundle is public, so a secret shipped to it is
 * disclosed to every reader of the JavaScript. Inventing a client-side secret,
 * or relaxing the gate to accept "logged in and no secret", are both out.
 *
 * The mechanism that keeps the gate intact is a real session:
 *
 *   1. better-auth issues a session cookie (Set-Cookie, httpOnly). The SPA
 *      cannot read it and does not need to.
 *   2. The browser presents that cookie to the API. The API verifies it against
 *      the `session` table and, when the session's user carries the `admin`
 *      role, authorizes the write using the server-held secret.
 *
 * The session is the credential the browser HOLDS; the secret is the credential
 * the server KEEPS. That is the same policy the Next app already implements in
 * apps/web/app/lib/auth.ts (`isAuthorized`: valid header OR an admin session),
 * expressed over HTTP instead of over a Next request context.
 *
 * ## REQUIRED API CONTRACT — NOT YET IMPLEMENTED, AND NOT BY THIS CHANGE
 *
 * apps/api is outside this task's write scope, so the server half is specified
 * here and left as a blocker for whoever owns that package. Three additions,
 * none of which may change how the existing secret path behaves:
 *
 *   a. Mount better-auth's handler at /api/auth/* on the API app, so the SPA
 *      has an auth endpoint to talk to. Today the only such handler is the Next
 *      route at apps/web/app/api/auth/[...all]/route.ts, which the SPA does not
 *      run. Needs better-auth + @better-auth/drizzle-adapter as apps/api deps.
 *
 *   b. Make auth.me ALSO resolve the session cookie. Its response shape is
 *      already the one the SPA consumes and must NOT change:
 *      { authenticated, role, via }. `via` gains a "session" value beside the
 *      existing "webhook-secret"; it stays null when unauthenticated.
 *
 *   c. Let requireWriteAuth accept a valid admin session in addition to the
 *      header. The secret comparison, the fail-closed behaviour on an
 *      unconfigured WEBHOOK_SECRET, and the MCP x-webhook-secret path must all
 *      stay exactly as they are.
 *
 * Until (a) and (b) land, /login cannot reach an auth endpoint and auth.me
 * reports `authenticated: false` for every browser (it only inspects the secret
 * header today). /create's beforeLoad therefore redirects to /login, which is
 * the correct, safe behaviour for an unauthenticated caller — not a crash.
 *
 * ## WHY THE WRITE CALLS SEND NO SECRET HEADER
 *
 * Because the browser is not supposed to have one. src/lib/writes.ts calls the
 * gated procedures with no secret and lets the API decide; a rejection comes
 * back as ORPCError UNAUTHORIZED, which is the authoritative answer. The gate is
 * enforced in the procedure, not in this client, and this client cannot
 * weaken it.
 */

/**
 * The oRPC mount point the SPA talks to.
 *
 * ## WHY /trpc AND NOT /rpc
 *
 * The API mounts the router at BOTH paths (apps/api/src/app.ts), so either
 * would work against the origin directly. But the browser only ever sees what
 * Caddy forwards, and /etc/caddy/Caddyfile currently proxies `/trpc/*` to
 * :4020 on both the wiki. and mcpedia. blocks — there is deliberately NO
 * `/rpc/*` handle. A SPA calling `/rpc` would be swallowed by the web app's
 * catch-all and 404 in production while working perfectly in dev, because the
 * Vite proxy has both paths.
 *
 * So /trpc is the only base that is correct at the edge today. When the Caddy
 * config gains a `/rpc/*` block, switch this constant and the Vite proxy in
 * the same commit.
 */
export const RPC_BASE = "/trpc"

export {
	rpcUrl,
	rpcCall,
	isOrpcErrorJson,
	OrpcCallError,
	OrpcTransportError,
} from "./orpc-client"

import { rpcCall } from "./orpc-client"

/** Mirrors apps/api/src/presentation/context.ts `AppRole`. */
export type AppRole = "admin"

/**
 * Mirrors the auth.me handler in apps/api/src/presentation/routers/auth.ts.
 *
 * `via` is a string, not a literal union, on purpose: it is diagnostic detail
 * and the server is free to add another value ("session") without breaking
 * every consumer's build. Only `role` gates UI.
 */
export interface MeResponse {
	authenticated: boolean
	role: AppRole | null
	via: string | null
}

/**
 * Re-exported from the shared package rather than redeclared.
 *
 * A hand-written copy here is a second definition of a server type: it happened
 * to drift (the router resolves the REAL @mcpedia/types SectionInfo, and the
 * structurally identical local one still failed to unify because the two
 * declarations are nominally distinct in this position). Import it once.
 */
export type { SectionInfo } from "@mcpedia/types"
import type { SectionInfo } from "@mcpedia/types"

/** Mirrors the documents.folderInfo handler. */
export interface FolderInfoResponse {
	classification: string
	folders: string[]
	docCount: number
}

/** auth.me — public and non-throwing; 200 with authenticated:false when out. */
export function fetchMe(signal?: AbortSignal): Promise<MeResponse> {
	return rpcCall(RPC_BASE, ["auth", "me"] as const, undefined, { signal })
}

/** documents.sections — the section ids that already exist. */
export function fetchSections(signal?: AbortSignal): Promise<SectionInfo[]> {
	return rpcCall(RPC_BASE, ["documents", "sections"] as const, undefined, {
		signal,
	})
}

/**
 * documents.folderInfo — classification and the folder tree for one section.
 *
 * The section may not exist yet on a fresh install; the API answers with the
 * same shape regardless, which is why `folders` is a list and not a lookup.
 */
export function fetchFolderInfo(
	section: string,
	path: string,
	signal?: AbortSignal,
): Promise<FolderInfoResponse> {
	return rpcCall(
		RPC_BASE,
		["documents", "folderInfo"] as const,
		{ section, path },
		{ signal },
	)
}

/** The default section list DocForm offers when the API has none yet. */
export const DEFAULT_SECTION_LIST = [
	"docs",
	"writeups",
	"research",
	"notes",
	"guides",
	"tutorials",
	"ctf",
	"api",
	"projects",
]

/** The default document-type list DocForm offers. */
export const DEFAULT_TYPE_LIST = [
	"documentation",
	"writeup",
	"research",
	"note",
	"guide",
	"tutorial",
	"spec",
]

/** Preset custom metadata fields, from app/components/DocForm.tsx. */
export const PRESET_FIELDS = [
	{ key: "difficulty", value: "medium" },
	{ key: "points", value: "100" },
	{ key: "category", value: "pwn" },
	{ key: "event", value: "DEF CON Quals 2024" },
	{ key: "solved", value: "true" },
]
