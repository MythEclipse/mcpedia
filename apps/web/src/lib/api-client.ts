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
 * ## THE API CONTRACT — IMPLEMENTED, AND VERIFIED
 *
 * This was written when apps/api was outside this task's write scope, and it
 * listed three server-side additions as blockers. All three have since landed in
 * apps/api, and the assertions below are the live ones:
 *
 *   a. better-auth's handler is MOUNTED at /api/auth/* on the API app
 *      (apps/api/src/app.ts). The path matches this client's `basePath` and the
 *      dev proxy in vite.config.ts.
 *
 *   b. auth.me ALSO resolves the session cookie. The response shape is unchanged:
 *      { authenticated, role, via }. `via` gained "session" beside the existing
 *      "webhook-secret", and stays null when unauthenticated. A signed-in
 *      non-admin now reports { authenticated: true, role: "user" }, which is
 *      deliberately NOT the same answer as "not signed in" — the SPA renders
 *      read-only for the first and gates for the second.
 *
 *   c. The write gate accepts a valid admin session in addition to the header
 *      (`requireWriteAuthOrSession`). The secret comparison, the fail-closed
 *      behaviour on the MCP path, and the MCP x-webhook-secret flow are unchanged;
 *      see apps/api/src/presentation/session-gate.test.ts for the proof that the
 *      added path is additive rather than a loosening.
 *
 * Nothing here sends a secret, and nothing here needs to: the browser proves who
 * it is with an httpOnly session cookie it never reads.
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
	isOrpcErrorJson,
	OrpcCallError,
	OrpcTransportError,
	rpcCall,
	rpcUrl,
} from "./orpc-client"

import { rpcCall } from "./orpc-client"

/**
 * Mirrors apps/api/src/presentation/context.ts `AppRole`.
 *
 * "user" is the value better-auth's bootstrap rule gives every account after the
 * first — see apps/api/src/auth.ts. The SPA only needs to tell admin from not, so
 * this is a union rather than a boolean: a signed-in non-admin is a real state
 * that renders read-only, and widening the type later is not a breaking change.
 */
export type AppRole = "admin" | "user"

/**
 * Mirrors the auth.me handler in apps/api/src/presentation/routers/auth.ts.
 *
 * `via` stays a plain `string`: it is diagnostic detail, and the server is free to
 * add another value without breaking every consumer's build. Only `role` gates UI
 * — nothing branches on how the caller proved who they are.
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

/**
 * The default document-type list DocForm offers.
 *
 * Section ids do NOT have a counterpart here any more. They used to — a
 * DEFAULT_SECTION_LIST mirroring the nine seeded ids — and the create form
 * merged it into the datalist because an install with no documents had no
 * sections to offer. Section ids now come from documents.sections alone, which
 * lists every REGISTERED section including ones holding no documents yet, so the
 * merged list was a second copy of the same nine names waiting to drift.
 *
 * Document TYPES are a different thing: they are a fixed vocabulary this app
 * defines (documentation/writeup/research/note), not content an operator edits,
 * so they stay.
 */
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
