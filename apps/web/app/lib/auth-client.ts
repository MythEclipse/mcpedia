"use client"

import { createAuthClient } from "better-auth/react"

/**
 * Browser-side better-auth client.
 *
 * Talks to the catch-all route at app/api/auth/[...all]/route.ts, which is the
 * same handler the server uses, so there is exactly one auth endpoint surface.
 */
export const authClient = createAuthClient()
