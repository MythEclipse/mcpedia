/**
 * The write path: document create/update through the oRPC gate.
 *
 * ## NO SECRET IS SENT FROM HERE, AND THAT IS THE POINT
 *
 * The Next app threaded WEBHOOK_SECRET into DocForm as a prop and posted it as
 * an `x-webhook-secret` header — which meant the server rendered the secret
 * into HTML for a browser to hold. That prop is deliberately NOT reproduced.
 * The SPA calls the gated procedures with no credential header at all; the API
 * authorizes from the session cookie it already received.
 *
 * So the only two outcomes here are "the API accepted it" and "the API refused",
 * and the refusal arrives as ORPCError UNAUTHORIZED. There is no code path in
 * this file that could make an unauthenticated write succeed.
 */

/** The three fields that are not part of the procedure input. */
export interface DocFormValues {
	title: string
	slug: string
	section: string
	body: string
	type: string
	status: string
	author: string
	tags: string[]
	/** Custom metadata, already flattened to strings by the form. */
	customFields: Array<{ key: string; value: string }>
}

/**
 * Flatten the form's custom fields into `extraFields`.
 *
 * The Next form pushed them straight into the payload as top-level keys
 * (`payload[field.key] = field.value`), which do NOT match
 * CreateDocumentInput's `extraFields: z.record(z.string(), z.unknown())` — they
 * were dropped by zod's default object stripping. Collecting them under
 * `extraFields` is what actually persists them, and is the shape the oRPC
 * schema already expects. Blank keys and values are skipped rather than
 * persisted as empty strings.
 */
export function toExtraFields(
	customFields: ReadonlyArray<{ key: string; value: string }>,
): Record<string, unknown> {
	const extra: Record<string, unknown> = {}
	for (const { key, value } of customFields) {
		const k = key.trim()
		if (!k) continue
		const v = value.trim()
		if (!v) continue
		extra[k] = v
	}
	return extra
}

/**
 * Validate the form before it reaches the network.
 *
 * Mirrors the Next form's guard, which required slug, title and body.
 * `status` is normalized because the procedure's schema is
 * z.enum(["published", "draft"]) — the form's <select> only offers those two,
 * but a hand-edited value would otherwise be a 400 from the server.
 */
export function validateDocForm(values: DocFormValues): string | null {
	if (!values.slug.trim()) return "Slug, title, and markdown body are required."
	if (!values.title.trim())
		return "Slug, title, and markdown body are required."
	if (!values.body.trim()) return "Slug, title, and markdown body are required."
	return null
}

/** Normalize a form status to the enum the procedure accepts. */
export function normalizeStatus(status: string): "published" | "draft" {
	return status === "draft" ? "draft" : "published"
}

/**
 * Include `key` only when `value` is non-blank.
 *
 * `value.trim() || undefined` is NOT enough: JSON.stringify drops an undefined
 * value, but the key is still PRESENT on the object, so `hasOwnProperty("type")`
 * is true and the payload reads as carrying a field the server will not receive.
 * Returning an empty object to spread keeps the key genuinely absent, which is
 * what `z.string().optional()` is asking for.
 */
function ifPresent(key: string, value: string): Record<string, string> {
	const trimmed = value.trim()
	return trimmed ? { [key]: trimmed } : {}
}

/**
 * Build the exact payload documents.create accepts.
 *
 * Exported and tested because it is the seam where the form's shape meets the
 * API's schema: a mismatch here is a silent field drop, not a type error.
 */
export function toCreateInput(values: DocFormValues) {
	const extraFields = toExtraFields(values.customFields)
	return {
		slug: values.slug.trim(),
		title: values.title.trim(),
		section: values.section.trim(),
		body: values.body,
		status: normalizeStatus(values.status),
		tags: values.tags.map((t) => t.trim()).filter(Boolean),
		...(Object.keys(extraFields).length > 0 ? { extraFields } : {}),
		...ifPresent("type", values.type),
		...ifPresent("author", values.author),
	}
}

/** Build the payload documents.update accepts. Same fields, all optional. */
export function toUpdateInput(values: DocFormValues) {
	const extraFields = toExtraFields(values.customFields)
	return {
		slug: values.slug.trim(),
		body: values.body,
		status: normalizeStatus(values.status),
		tags: values.tags.map((t) => t.trim()).filter(Boolean),
		...(Object.keys(extraFields).length > 0 ? { extraFields } : {}),
		...ifPresent("title", values.title),
		...ifPresent("section", values.section),
		...ifPresent("type", values.type),
		...ifPresent("author", values.author),
	}
}
