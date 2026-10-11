import { NextRequest, NextResponse } from "next/server"
import { ADMIN_PASSWORD } from "@mcpedia/config"
import {
	COOKIE_MAX_AGE,
	COOKIE_NAME,
	safeTimingEqual,
	signCookie,
	verifyCookie,
} from "@/lib/auth"

// POST /api/auth/login — verify admin password, set a signed cookie.
// Uses a simple HMAC cookie (no JWT library) — sufficient for a single-admin KB.
//
// The signing helpers now live in @/lib/auth so the CRUD routes verify the
// same way this route mints; they used to hold private copies that never
// actually checked the signature.

export async function POST(req: NextRequest) {
	const body = await req.json().catch(() => ({}))
	const { password } = body

	if (!ADMIN_PASSWORD || typeof password !== "string") {
		return NextResponse.json(
			{ ok: false, error: "Unauthorized" },
			{ status: 401 },
		)
	}

	const ok = safeTimingEqual(password, ADMIN_PASSWORD)

	if (!ok) {
		return NextResponse.json(
			{ ok: false, error: "Unauthorized" },
			{ status: 401 },
		)
	}

	const cookie = signCookie("admin")
	const res = NextResponse.json({ ok: true })
	res.cookies.set(COOKIE_NAME, cookie, {
		maxAge: COOKIE_MAX_AGE,
		httpOnly: true,
		path: "/",
		sameSite: "lax",
		secure: process.env.NODE_ENV === "production",
	})
	return res
}

// GET /api/auth/login — returns 200 if currently authenticated, 401 otherwise.
export async function GET(req: NextRequest) {
	const cookie = req.cookies.get(COOKIE_NAME)?.value
	if (verifyCookie(cookie)) return NextResponse.json({ ok: true })
	return NextResponse.json({ ok: false }, { status: 401 })
}

// DELETE /api/auth/login — clear the cookie (logout).
export async function DELETE() {
	const res = NextResponse.json({ ok: true })
	res.cookies.delete({ name: COOKIE_NAME, path: "/" })
	return res
}

// Exported for server components to call directly.
export function isAuthenticated(req: NextRequest): boolean {
	const cookie = req.cookies.get(COOKIE_NAME)?.value
	return verifyCookie(cookie)
}
