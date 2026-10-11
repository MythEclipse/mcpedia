import { NextRequest, NextResponse } from "next/server"
import {
	createDocument,
	updateDocument,
	deleteDocument,
	listDocuments,
} from "@mcpedia/core"
import { isAuthorized as isAuthorizedRequest } from "@/lib/auth"

// Web CRUD auth: either the x-webhook-secret header (API/MCP style) OR the
// mcpedia_admin cookie (web login). One of the two must be valid.
// The real check lives in @/lib/auth — this only adapts the NextRequest.
function isAuthorized(req: NextRequest): boolean {
	return isAuthorizedRequest(
		req.headers,
		req.cookies.get("mcpedia_admin")?.value,
	)
}

function unauthorized() {
	return NextResponse.json(
		{ ok: false, error: "Unauthorized" },
		{ status: 401 },
	)
}

// Standard DocumentMeta field names — NOT custom fields.
const STANDARD_FIELDS = new Set([
	"slug",
	"title",
	"body",
	"section",
	"type",
	"status",
	"author",
	"tags",
	"createdAt",
	"updatedAt",
	"id",
	"path",
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

/**
 * Separate a flat payload into standard CRUD fields + extraFields (custom metadata).
 * The DocForm sends all fields flat — any key not in STANDARD_FIELDS becomes an
 * entry in extraFields, which is stored as JSONB in the documents table.
 */
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

// GET /api/docs — list all documents (for sidebar navigation).
// Supports ?section=&status= filters.
export async function GET(req: NextRequest) {
	const { searchParams } = new URL(req.url)
	const section = searchParams.get("section") ?? undefined
	const status = searchParams.get("status") ?? undefined
	const docs = await listDocuments({
		...(section ? { section } : {}),
		...(status ? { status } : {}),
	})
	return NextResponse.json(docs)
}

// POST /api/docs — Create a new document.
export async function POST(req: NextRequest) {
	if (!isAuthorized(req)) return unauthorized()

	const body = await req.json().catch(() => null)
	if (!body) {
		return NextResponse.json(
			{ ok: false, error: "Invalid JSON body" },
			{ status: 400 },
		)
	}

	try {
		const { standard, extraFields } = splitPayload(body)
		const doc = await createDocument({ ...standard, extraFields } as any)
		return NextResponse.json({ ok: true, slug: doc.slug, doc })
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		return NextResponse.json({ ok: false, error: msg }, { status: 400 })
	}
}
