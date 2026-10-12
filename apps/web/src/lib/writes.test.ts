import { describe, expect, it } from "vitest"
import {
	type DocFormValues,
	normalizeStatus,
	toCreateInput,
	toExtraFields,
	toUpdateInput,
	validateDocForm,
} from "./writes"

/**
 * These cover the seam between the editor's state and the API's zod schemas
 * (apps/api/src/presentation/schemas.ts). A mismatch here is a SILENT field
 * drop rather than a type error, which is why it is worth testing directly.
 */

function form(overrides: Partial<DocFormValues> = {}): DocFormValues {
	return {
		title: "Stack Alignment",
		slug: "docs/exploits/alignment",
		section: "docs",
		body: "# hello",
		type: "documentation",
		status: "published",
		author: "asepharyana",
		tags: ["pwn", "x86_64"],
		customFields: [],
		...overrides,
	}
}

describe("toExtraFields", () => {
	it("collects custom fields under one key", () => {
		// The Next form pushed these as TOP-LEVEL payload keys, which
		// CreateDocumentInput's `extraFields: z.record(...)` never read — zod
		// strips unknown keys by default, so they were silently discarded.
		expect(
			toExtraFields([
				{ key: "points", value: "100" },
				{ key: "difficulty", value: "medium" },
			]),
		).toEqual({ points: "100", difficulty: "medium" })
	})

	it("drops blank keys and blank values rather than persisting empty strings", () => {
		expect(
			toExtraFields([
				{ key: "  ", value: "x" },
				{ key: "points", value: "   " },
				{ key: "event", value: "DEF CON" },
			]),
		).toEqual({ event: "DEF CON" })
	})

	it("trims keys and values", () => {
		expect(toExtraFields([{ key: "  event ", value: "  DEF CON  " }])).toEqual({
			event: "DEF CON",
		})
	})

	it("returns an empty object when there is nothing to persist", () => {
		expect(toExtraFields([])).toEqual({})
	})
})

describe("normalizeStatus", () => {
	it("keeps the two values the schema's enum allows", () => {
		// z.enum(["published", "draft"]) — anything else is a 400 from the server.
		expect(normalizeStatus("published")).toBe("published")
		expect(normalizeStatus("draft")).toBe("draft")
	})

	it("falls back to published for an unexpected value", () => {
		// The <select> only offers the two, but the value is form state and
		// normalization is cheaper than a server round trip to discover it.
		expect(normalizeStatus("archive")).toBe("published")
		expect(normalizeStatus("")).toBe("published")
	})
})

describe("validateDocForm", () => {
	it("accepts a complete form", () => {
		expect(validateDocForm(form())).toBeNull()
	})

	it("requires slug, title and body", () => {
		expect(validateDocForm(form({ slug: "" }))).toMatch(/required/i)
		expect(validateDocForm(form({ title: "  " }))).toMatch(/required/i)
		expect(validateDocForm(form({ body: "" }))).toMatch(/required/i)
	})

	it("reports one message rather than three", () => {
		// Same message as the Next form, so the UI text does not change.
		expect(validateDocForm(form({ slug: "", title: "", body: "" }))).toBe(
			"Slug, title, and markdown body are required.",
		)
	})

	it("does not require type, author or tags", () => {
		expect(validateDocForm(form({ type: "", author: "", tags: [] }))).toBeNull()
	})
})

describe("toCreateInput", () => {
	it("produces exactly the fields CreateDocumentInput accepts", () => {
		expect(toCreateInput(form())).toEqual({
			slug: "docs/exploits/alignment",
			title: "Stack Alignment",
			section: "docs",
			body: "# hello",
			type: "documentation",
			status: "published",
			author: "asepharyana",
			tags: ["pwn", "x86_64"],
		})
	})

	it("omits empty optional fields instead of sending empty strings", () => {
		// z.string().optional() rejects "" only where a min(1) applies; omitting
		// is unambiguous and keeps the stored row free of empty noise.
		const input = toCreateInput(form({ type: "   ", author: "" }))
		expect(input).not.toHaveProperty("type")
		expect(input).not.toHaveProperty("author")
	})

	it("trims and filters the tag list", () => {
		expect(
			toCreateInput(form({ tags: [" pwn ", "", "  ", "rop"] })).tags,
		).toEqual(["pwn", "rop"])
	})

	it("includes extraFields only when there is something to persist", () => {
		const none = toCreateInput(
			form({ customFields: [{ key: "points", value: " " }] }),
		)
		expect(none).not.toHaveProperty("extraFields")

		const some = toCreateInput(
			form({ customFields: [{ key: "points", value: "100" }] }),
		)
		expect(some.extraFields).toEqual({ points: "100" })
	})

	it("normalizes an out-of-enum status rather than sending it", () => {
		expect(toCreateInput(form({ status: "archived" })).status).toBe("published")
	})
})

describe("toUpdateInput", () => {
	it("always carries the slug, since it identifies the document", () => {
		// The procedure takes { slug, ...rest } and applies rest as the patch.
		expect(toUpdateInput(form()).slug).toBe("docs/exploits/alignment")
	})

	it("keeps body and status, which the form always has", () => {
		const input = toUpdateInput(form())
		expect(input.body).toBe("# hello")
		expect(input.status).toBe("published")
	})

	it("omits empty optional fields", () => {
		const input = toUpdateInput(form({ type: "", author: "" }))
		expect(input).not.toHaveProperty("type")
		expect(input).not.toHaveProperty("author")
	})

	it("carries extraFields when present", () => {
		expect(
			toUpdateInput(form({ customFields: [{ key: "solved", value: "true" }] }))
				.extraFields,
		).toEqual({ solved: "true" })
	})
})
