import { NextRequest, NextResponse } from "next/server"
import { updateDocument, deleteDocument } from "@mcpedia/core"
import { isAuthorized as isAuthorizedRequest } from "@/lib/auth"

// Web CRUD auth: either the x-webhook-secret header (API/MCP style) OR an
// active better-auth session for an admin user. The check is async because it
// reads the session from the database now — the old HMAC cookie check was a
// synchronous string compare against a cookie value that was the literal
// "admin" for every login.
function isAuthorized(req: NextRequest): Promise<boolean> {
	return isAuthorizedRequest(req.headers)
}

function unauthorized() {
	return NextResponse.json(
		{ ok: false, error: "Unauthorized" },
		{ status: 401 },
	)
}

const STANDARD_FIELDS = new Set([
	"title",
	"body",
	"type",
	"status",
	"author",
	"tags",
	"createdAt",
	"updatedAt",
	"id",
	"path",
	"slug",
])

function parseCustomValue(value: unknown): unknown {
	if (typeof value === "string") {
		const trimmed = value.trim()
		if (trimmed === "true") return true
		if (trimmed === "false") return false
		if (
			/^-?\d+(\.\d+)?$/.test(trimmed) &&
			!(
				trimmed.startsWith("0") &&
				trimmed.length > 1 &&
				!trimmed.startsWith("0.")
			)
		) {
			const num = Number(trimmed)
			if (!isNaN(num)) return num
		}
		if (
			(trimmed.startsWith("[") && trimmed.endsWith("]")) ||
			(trimmed.startsWith("{") && trimmed.endsWith("}"))
		) {
			try {
				return JSON.parse(trimmed)
			} catch {
				return value
			}
		}
	}
	return value
}

function splitPayload(body: Record<string, unknown>): {
	standard: Record<string, unknown>
	extraFields: Record<string, unknown>
} {
	const standard: Record<string, unknown> = {}
	const extraFields: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(body)) {
		if (key === "extraFields" && typeof value === "object" && value !== null) {
			Object.assign(extraFields, value)
		} else if (STANDARD_FIELDS.has(key)) {
			standard[key] = value
		} else if (value !== undefined && value !== null) {
			extraFields[key] = parseCustomValue(value)
		}
	}
	return { standard, extraFields }
}

// PUT /api/docs/{slug...} — Update an existing document.
export async function PUT(
	req: NextRequest,
	{ params }: { params: Promise<{ slug?: string[] }> },
) {
	if (!isAuthorized(req)) return unauthorized()
	const { slug } = await params
	const fullSlug = (slug ?? []).join("/")
	if (!fullSlug) {
		return NextResponse.json(
			{ ok: false, error: "slug required" },
			{ status: 400 },
		)
	}

	const body = await req.json().catch(() => null)
	if (!body) {
		return NextResponse.json(
			{ ok: false, error: "Invalid JSON body" },
			{ status: 400 },
		)
	}

	try {
		const { standard, extraFields } = splitPayload(body)
		const doc = await updateDocument(fullSlug, {
			...standard,
			extraFields,
		} as any)
		return NextResponse.json({ ok: true, slug: doc.slug, doc })
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		return NextResponse.json({ ok: false, error: msg }, { status: 400 })
	}
}

// DELETE /api/docs/{slug...}
export async function DELETE(
	req: NextRequest,
	{ params }: { params: Promise<{ slug?: string[] }> },
) {
	if (!isAuthorized(req)) return unauthorized()
	const { slug } = await params
	const fullSlug = (slug ?? []).join("/")
	if (!fullSlug) {
		return NextResponse.json(
			{ ok: false, error: "slug required" },
			{ status: 400 },
		)
	}

	const result = await deleteDocument(fullSlug)
	return NextResponse.json({ ok: true, deleted: result.deleted })
}
