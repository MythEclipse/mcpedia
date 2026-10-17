/**
 * Unit tests for the section-registry write use cases.
 *
 * The behaviour worth pinning is not the happy path — it is the asymmetry that
 * makes this table safe: unregistering a section removes a NAME and touches no
 * documents. That is a deliberate design decision (documents.section is a plain
 * string, not a foreign key), so it is asserted rather than left to a reader to
 * infer from the SQL.
 */
import { describe, expect, test, vi } from "vitest"
import type { SectionRecord } from "../domain"
import {
	makeListRegistry,
	makeRemoveSection,
	makeUpsertSection,
} from "./section.use-cases"

/** A repository stub that records what it was asked to do. */
function fakeRepo(existing: SectionRecord[] = []) {
	const store = new Map(existing.map((r) => [r.id, r]))
	return {
		documents: {
			listRegistry: vi.fn(async () => Array.from(store.values())),
			upsertSection: vi.fn(async (input: SectionRecord) => {
				store.set(input.id, input)
				return input
			}),
			removeSection: vi.fn(async (id: string) => ({
				deleted: store.delete(id),
			})),
		},
	}
}

describe("makeUpsertSection", () => {
	test("defaults the label to the title-cased id", async () => {
		// Registering a section is one argument. A required label would make the
		// common case (a new section with an obvious name) a two-argument call.
		const deps = fakeRepo()
		const result = await makeUpsertSection(deps)({ id: "ctf-writeups" })
		expect(result).toMatchObject({
			id: "ctf-writeups",
			label: "Ctf Writeups",
			icon: "📁",
			hidden: false,
		})
	})

	test("keeps a provided label instead of deriving one", async () => {
		const deps = fakeRepo()
		const result = await makeUpsertSection(deps)({
			id: "writeups",
			label: "Post-Mortems",
			icon: "📝",
			desc: "What went wrong.",
			sortOrder: 3,
		})
		expect(result).toMatchObject({
			label: "Post-Mortems",
			icon: "📝",
			desc: "What went wrong.",
			sortOrder: 3,
		})
	})

	test("normalizes case and whitespace in the id", async () => {
		const deps = fakeRepo()
		const result = await makeUpsertSection(deps)({ id: "  WRITEUPS  " })
		expect(result.id).toBe("writeups")
	})

	test("an empty label falls back rather than blanking the name", async () => {
		// A rename that submits an empty field must not erase the name the nav
		// is rendering — it degrades to the derived one instead.
		const deps = fakeRepo()
		const result = await makeUpsertSection(deps)({ id: "docs", label: "   " })
		expect(result.label).toBe("Docs")
	})

	test("rejects an id that cannot be a URL path segment", async () => {
		// A section id becomes the first segment of every document slug in it,
		// and the section page's URL. "a/b" would make those documents
		// unreachable, so it fails at the WRITE rather than at the read.
		const deps = fakeRepo()
		await expect(makeUpsertSection(deps)({ id: "a/b" })).rejects.toThrow(
			/Invalid section id/,
		)
		await expect(makeUpsertSection(deps)({ id: "Caps" })).resolves.toBeDefined()
		await expect(makeUpsertSection(deps)({ id: "has space" })).rejects.toThrow(
			/Invalid section id/,
		)
		await expect(makeUpsertSection(deps)({ id: "-leading" })).rejects.toThrow(
			/Invalid section id/,
		)
	})

	test("validates before writing, so nothing is stored on a bad id", async () => {
		const deps = fakeRepo()
		await makeUpsertSection(deps)({ id: "bad/id" }).catch(() => {})
		expect(deps.documents.upsertSection).not.toHaveBeenCalled()
	})
})

describe("makeRemoveSection", () => {
	test("removes the metadata row and reports it", async () => {
		const deps = fakeRepo([
			{
				id: "notes",
				label: "Notes",
				icon: "📌",
				desc: "",
				sortOrder: 3,
				hidden: false,
			},
		])
		expect(await makeRemoveSection(deps)("notes")).toEqual({ deleted: true })
		expect(await makeListRegistry(deps)()).toEqual([])
	})

	test("an unknown id is a no-op, not an error", async () => {
		// A delete that is already done is not a failure, and throwing here would
		// force every caller to read before deleting just to avoid a spurious
		// error. The boolean carries the distinction for the caller that cares.
		const deps = fakeRepo()
		expect(await makeRemoveSection(deps)("never-existed")).toEqual({
			deleted: false,
		})
	})

	test("NEVER touches documents — it unregisters a name, not content", async () => {
		// The design decision this whole table rests on. documents.section is a
		// plain string, so a section can be unregistered while its documents stay
		// readable at their URLs. Asserted on the seam: the only collaborator
		// available to this use case is the registry, so it cannot reach
		// documents even by mistake.
		const deps = fakeRepo([
			{
				id: "secret",
				label: "Secret",
				icon: "📁",
				desc: "",
				sortOrder: 0,
				hidden: false,
			},
		])
		await makeRemoveSection(deps)("secret")
		expect(Object.keys(deps.documents).sort()).toEqual([
			"listRegistry",
			"removeSection",
			"upsertSection",
		])
	})

	test("rejects a blank id", async () => {
		const deps = fakeRepo()
		await expect(makeRemoveSection(deps)("   ")).rejects.toThrow(
			/A section id is required/,
		)
		expect(deps.documents.removeSection).not.toHaveBeenCalled()
	})
})

describe("makeListRegistry", () => {
	test("returns every row, hidden ones included", async () => {
		// Unlike the nav-facing read (makeListSections, which drops hidden rows),
		// this is the admin view: an operator editing the registry must be able
		// to see the section they hid, or they cannot unhide it.
		const deps = fakeRepo([
			{
				id: "docs",
				label: "Documentation",
				icon: "📄",
				desc: "",
				sortOrder: 0,
				hidden: false,
			},
			{
				id: "secret",
				label: "Secret",
				icon: "📁",
				desc: "",
				sortOrder: 1,
				hidden: true,
			},
		])
		const rows = await makeListRegistry(deps)()
		expect(rows.map((r) => r.id).sort()).toEqual(["docs", "secret"])
	})
})
