import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "node:url"
import { noServerImports } from "./src/build/no-server-imports.ts"

/**
 * Vite config for the SPA that is replacing apps/web's Next.js app.
 *
 * THE NEXT APP STILL EXISTS. app/, next.config.ts and postcss.config.mjs are
 * untouched, and both builds still run: `build` is `vite build` (this SPA) and
 * `build:next` is `next build`. Their outputs do not collide — `dist/` vs
 * `.next/` — so `moon run web:build` runs both and the rollback path stays
 * live at the same time. See apps/web/moon.yml.
 *
 * Tailwind v4 is wired the way v4 actually works under Vite — the
 * `@tailwindcss/vite` PLUGIN, not the PostCSS plugin the Next build uses. The
 * two are not interchangeable: `@tailwindcss/postcss` is a PostCSS pipeline
 * stage and Vite only runs PostCSS for files matching css.postcss, so carrying
 * postcss.config.mjs over would have compiled nothing. `@tailwindcss/vite` is a
 * real plugin that hooks `enforce: "pre"` transform on every .css request, so
 * src/styles.css is all it takes.
 *
 * Plugin order matters only for the router plugin's codegen, which this app
 * does not use (the route tree is hand-written — see src/routes.tsx). Tailwind
 * must still run before Vite's own CSS handling, which its own `enforce: "pre"`
 * guarantees regardless of position here.
 */
export default defineConfig({
	plugins: [noServerImports(), tailwindcss(), react()],
	resolve: {
		alias: {
			// Same `#/*` -> apps/web/src/* contract the Next app uses via its
			// tsconfig "@/*" paths, so code moves between app/ and src/ without
			// its imports being rewritten.
			"#": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	server: {
		// The SPA owns this origin and serves itself, so any path it does not
		// know must reach the API instead of the SPA's catch-all HTML.
		proxy: {
			// Both oRPC mounts exist because apps/api/src/app.ts mounts the same
			// RPCHandler at each; the `prefix` strips the mount segment. Proxying
			// both keeps the SPA's client switchable without a code change.
			"/rpc": { target: "http://127.0.0.1:4020", changeOrigin: false },
			"/trpc": { target: "http://127.0.0.1:4020", changeOrigin: false },
			// better-auth's catch-all. Same-origin so the session cookie stays
			// first-party — a cross-origin call would drop it.
			//
			// The API now serves this path (apps/api/src/app.ts mounts better-auth
			// at /api/auth/*), so this proxy forwards a real endpoint rather than
			// swallowing the request. In production Caddy forwards the same path to
			// the same origin, which is what keeps the cookie first-party in both
			// environments.
			"/api/auth": { target: "http://127.0.0.1:4020", changeOrigin: false },
		},
	},
	build: {
		// Stays out of the way of the Next build's .next/. Without this a stale
		// dist/ is indistinguishable from a fresh one after a rollback.
		outDir: "dist",
		emptyOutDir: true,
	},
})
