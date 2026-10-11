export class FetchError extends Error {
	status: number
	info: unknown
	constructor(message: string, status: number, info: unknown) {
		super(message)
		this.name = "FetchError"
		this.status = status
		this.info = info
	}
}

export async function fetcher<T>(url: string): Promise<T> {
	const res = await fetch(url)
	if (!res.ok) {
		let info: unknown = null
		try {
			info = await res.json()
		} catch {
			try {
				info = await res.text()
			} catch {
				info = null
			}
		}
		const msg =
			(info as { error?: string })?.error ||
			(typeof info === "string" ? info : null) ||
			`Request failed: ${res.status} ${res.statusText}`
		throw new FetchError(msg, res.status, info)
	}
	return (await res.json()) as T
}
