/**
 * The command palette must list SECTIONS FROM THE DATABASE, not from this bundle.
 *
 * ## WHY THIS FILE EXISTS
 *
 * CommandMenu used to carry five hardcoded quick actions, three of which named
 * sections: "Documentation Hub" -> /docs, "CTF & Writeups Directory" ->
 * /writeups, "Research & Benchmarks" -> /research, each with its own blurb and a
 * lucide icon. Section names are content now (the `sections` table), so those
 * three rows were a SECOND source of truth: registering a section did not put it
 * in the palette, deleting one left a row pointing at a URL with no registry row
 * behind it, and renaming one changed the header nav but not the palette.
 *
 * The failure mode is quiet — the palette still renders, still looks right, and
 * is simply out of date — which is why the mapping is asserted here.
 *
 * ## WHY A PURE FUNCTION AND NOT A RENDER
 *
 * CommandMenu returns its closed-state button until `open` is true, so
 * renderToStaticMarkup (the technique used in routes-render.test.tsx, in the
 * absence of a DOM environment) can only ever see the closed button — a render
 * assertion here would fail on markup the palette never emits. The mapping from
 * registry row to shortcut is therefore `paletteSectionsFrom` in
 * apps/web/src/lib/sections.ts, a leaf module importing no React, and this is a
 * unit test of it. The component's remaining job is composing APP_ACTIONS with
 * its result.
 *
 * ## WHAT IS DELIBERATELY STILL HARDCODED
 *
 * "Create New Document" (/create) and "Multi-Modal Hybrid Search" (/search) stay
 * literals in APP_ACTIONS. They are routes this application defines, not registry
 * entries; a blanket "no hardcoded titles" rule would make deleting a section
 * remove the create button. They are asserted to be absent from this function's
 * output, which is the boundary.
 */
import { describe, expect, it } from "vitest"
import type { SectionInfo } from "./api-client"
import { paletteSectionsFrom } from "./sections"

/** The label a registry row carries — nothing in the source names it. */
const REGISTERED_LABEL = "Threat Intel"

const registered = {
	id: "threat-intel",
	label: REGISTERED_LABEL,
	icon: "🛰️",
	desc: "Indicators and adversary tracking",
	docCount: 3,
} as SectionInfo

describe("paletteSectionsFrom", () => {
	it("builds a shortcut for a section the bundle has never heard of", () => {
		// The core claim: every field reaches the palette from the registry
		// payload. A hardcoded list cannot produce this label or this glyph.
		const [row] = paletteSectionsFrom([registered])

		expect(row).toBeDefined()
		expect(row?.title).toBe(REGISTERED_LABEL)
		expect(row?.subtitle).toBe("Indicators and adversary tracking")
		// The glyph is data, so an operator picks the icon — not the bundle.
		expect(row?.glyph).toBe("🛰️")
		expect(row?.href).toBe("/threat-intel")
		// Prefixed so a section id can never collide with an APP_ACTIONS id.
		expect(row?.id).toBe("section-threat-intel")
	})

	it("produces nothing for a section the registry does not list", () => {
		// The other half of the claim: the old hardcoded rows must be gone.
		// "Writeups" was one of them and is not in this payload.
		const rows = paletteSectionsFrom([registered])
		const titles = rows.map((r) => r.title)

		expect(titles).not.toContain("Writeups")
		expect(titles).not.toContain("Documentation")
		expect(titles).not.toContain("Research")
		expect(titles).not.toContain("Create New Document")
		expect(titles).not.toContain("Multi-Modal Hybrid Search")
	})

	it("returns nothing at all when the registry has not loaded", () => {
		// undefined is the loading/failed state. Falling back to a built-in id
		// list here would advertise sections the operator may have deleted.
		expect(paletteSectionsFrom(undefined)).toEqual([])
		expect(paletteSectionsFrom([])).toEqual([])
	})

	it("shows a doc count when the registry row has no description", () => {
		// An operator can register a section through MCP without writing a
		// blurb. An empty subtitle renders as a blank line that reads like a
		// bug, so the live count stands in.
		const [row] = paletteSectionsFrom([
			{ ...registered, desc: "", docCount: 1 } as SectionInfo,
		])

		expect(row?.subtitle).toBe("1 document")
	})

	it("pluralises the doc count", () => {
		const [one] = paletteSectionsFrom([
			{ ...registered, desc: "", docCount: 1 } as SectionInfo,
		])
		const [many] = paletteSectionsFrom([
			{ ...registered, desc: "", docCount: 4 } as SectionInfo,
		])

		expect(one?.subtitle).toBe("1 document")
		expect(many?.subtitle).toBe("4 documents")
	})

	it("keeps registry order, so the palette matches the header nav", () => {
		// The API orders by sortOrder then id. Re-sorting here would put the
		// palette out of step with the nav it sits above.
		const rows = paletteSectionsFrom([
			{ ...registered, id: "beta", label: "Beta" } as SectionInfo,
			{ ...registered, id: "alpha", label: "Alpha" } as SectionInfo,
		])

		expect(rows.map((r) => r.id)).toEqual(["section-beta", "section-alpha"])
	})

	it("drops malformed rows instead of rendering broken shortcuts", () => {
		// The payload crosses a network boundary; one bad record must not take
		// the palette down or emit a link to /undefined.
		const rows = paletteSectionsFrom([
			registered,
			null,
			undefined,
			{} as SectionInfo,
		])

		expect(rows).toHaveLength(1)
		expect(rows[0]?.href).toBe("/threat-intel")
	})
})
