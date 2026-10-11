/**
 * A link to a document or folder by slug.
 *
 * WHY THIS EXISTS. Every card, list row and breadcrumb in the Next app wrote
 * `<Link href={`/${slug}`}>`. That was free under the App Router, where href is
 * just a string. TanStack's typed `to` is not: it is checked against the
 * registered route tree, so `/${slug}` fails to typecheck because `slug` is a
 * `string` and the router knows the route is `/$section/$`.
 *
 * Passing params properly means splitting the slug back into the section and
 * the splat — which every one of these call sites was already doing by hand in
 * the path string. So this does the split once, and each component stays a
 * plain `<DocLink to={doc.slug}>`.
 *
 * The split is not cosmetic: `/$section` and `/$section/$` are two distinct
 * routes, and a one-segment slug must match the former. Navigating a bare
 * section to the splat route leaves the section page's highlight logic reading
 * a path it never sees.
 *
 * WHY THE CAST. `Link` is a generic component whose `params` prop is inferred
 * per call site (link.d.ts: `LinkComponent<TComp, TDefaultFrom>`), so it cannot
 * be named as a type here without pinning every generic by hand. The cast
 * keeps one narrow, local escape hatch instead of scattering `as any` through
 * eight components — and the union below still rejects a slug that splits into
 * the wrong shape, which is the mistake worth catching.
 */
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"

/** Split "docs/setup/install" into {section: "docs", splat: "setup/install"}. */
export function splitSlug(slug: string): {
	section: string
	splat?: string
} {
	const [section, ...rest] = slug.split("/").filter(Boolean)
	return {
		section: section ?? "docs",
		splat: rest.length > 0 ? rest.join("/") : undefined,
	}
}

/**
 * The subset of Link's props these two links take. Everything that positions
 * or styles an anchor still flows through untouched.
 */
type AnchorProps = Omit<
	React.ComponentProps<typeof Link>,
	"to" | "params" | "search" | "children"
>

/**
 * Link pinned to the two slug routes.
 *
 * `params` is re-declared as a plain object rather than Link's default
 * reducer form, which is what lets `{section, _splat}` typecheck at the two
 * call sites below.
 */
type SlugLink = (
	props: {
		to: "/$section" | "/$section/$"
		params: { section: string; _splat?: string }
	} & AnchorProps & { children?: ReactNode },
) => React.ReactElement

const SlugRouterLink = Link as unknown as SlugLink

export function DocLink({
	to,
	children,
	...rest
}: { to: string; children?: ReactNode } & AnchorProps) {
	const { section, splat } = splitSlug(to)

	// A one-segment slug is the section index; anything deeper is the splat
	// route. Both are real routes, so this picks the one that matches.
	if (!splat) {
		return (
			<SlugRouterLink to="/$section" params={{ section }} {...rest}>
				{children}
			</SlugRouterLink>
		)
	}

	return (
		<SlugRouterLink
			to="/$section/$"
			params={{ section, _splat: splat }}
			{...rest}
		>
			{children}
		</SlugRouterLink>
	)
}

/**
 * A link to the search page.
 *
 * Separate from DocLink because /search is a static route whose search params
 * are required — TanStack's MakeRequiredSearchParams rejects a bare
 * `to="/search"`. Defaulting q/mode here keeps every call site to
 * `<SearchLink>`, with no props at all for the "just go to search" case.
 */
export function SearchLink({
	q,
	mode,
	children,
	...rest
}: {
	q?: string
	mode?: "hybrid" | "keyword" | "semantic"
	children?: ReactNode
} & Omit<
	React.ComponentProps<typeof Link>,
	"to" | "search" | "params" | "children"
>) {
	return (
		<Link
			to="/search"
			search={{ q: q ?? undefined, mode: mode ?? "hybrid" }}
			{...rest}
		>
			{children}
		</Link>
	)
}
