import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { CONTENT_ROOT } from "@mcpedia/config"

/** List all markdown/mdx content files relative to CONTENT_ROOT. */
export function listContentFiles(): string[] {
	const out: string[] = []
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir)) {
			const full = join(dir, entry)
			const st = statSync(full)
			if (st.isDirectory()) walk(full)
			else if (/\.mdx?$/.test(entry)) out.push(relative(CONTENT_ROOT, full))
		}
	}
	walk(CONTENT_ROOT)
	return out
}

/** Read a content file's raw text by relative path. */
export function readContentFile(relPath: string): string {
	return readFileSync(join(CONTENT_ROOT, relPath), "utf8")
}
