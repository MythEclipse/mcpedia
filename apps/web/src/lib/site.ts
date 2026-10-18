/**
 * Site identity for the web UI.
 *
 * ## WHY THIS MODULE EXISTS
 *
 * The same facts are rendered in more than one place, and one of those places
 * cannot import this file: `index.html` is the static shell, so its <title>, its
 * meta description and the theme bootstrap's localStorage key are literals that
 * ship as written. Hand-maintaining two copies is how an app ends up with one
 * name in the browser tab and another in the header — the same drift that
 * src/lib/mcp-tools.ts was created to stop for the tool count.
 * src/lib/site.test.ts asserts index.html against these constants, so a rename
 * that misses one of the two copies fails the suite instead of shipping.
 *
 * ## A LEAF MODULE ON PURPOSE
 *
 * It imports nothing, so a test can load it without pulling in the React tree or
 * the `#/…` alias, which the root vitest config resolves only for src paths.
 */
export const SITE_NAME = "Wiki"

/** The line under the main-page heading. */
export const SITE_TAGLINE =
	"A knowledge base of reference documentation, writeups and working notes."

/** The <meta name="description"> body, which is what a search result shows. */
export const SITE_DESCRIPTION =
	"An open knowledge base: reference documentation, CTF writeups and working notes, with full-text and semantic search."

/**
 * The localStorage key holding the light/dark choice.
 *
 * Read in TWO places that must agree byte-for-byte: the inline bootstrap in
 * index.html (which runs before first paint) and ThemeToggle.
 */
export const THEME_STORAGE_KEY = "wiki-theme"

/** Fallback stem for a generated download filename (see lib/export-filename). */
export const EXPORT_FALLBACK = "wiki-export"
