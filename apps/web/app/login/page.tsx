"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Lock, Key, Eye, EyeOff, ArrowLeft } from "lucide-react"

export default function LoginPage() {
	const router = useRouter()
	const [password, setPassword] = useState("")
	const [showPassword, setShowPassword] = useState(false)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		setLoading(true)
		setError(null)

		try {
			const res = await fetch("/api/auth/login", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ password }),
			})

			if (!res.ok) {
				const data = await res.json().catch(() => ({}))
				throw new Error(data.error ?? "Invalid password. Check ADMIN_PASSWORD.")
			}

			router.push("/create")
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		} finally {
			setLoading(false)
		}
	}

	return (
		<div className="flex min-h-[65vh] items-center justify-center px-4">
			<div className="w-full max-w-md bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl p-6 sm:p-8 shadow-xs relative">
				<div className="text-center mb-7">
					<div className="w-10 h-10 rounded-lg bg-[var(--brand)] text-[var(--brand-fg)] font-bold text-sm flex items-center justify-center mx-auto mb-3 shadow-xs font-mono">
						<Lock className="w-4 h-4" />
					</div>
					<h1 className="text-xl font-bold text-[var(--text-primary)] tracking-tight">
						Admin Authentication
					</h1>
					<p className="text-xs text-[var(--text-muted)] mt-1">
						Enter administrative password to authorize document mutations.
					</p>
				</div>

				{error && (
					<div className="p-3 mb-5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-500 dark:text-rose-400 text-xs font-medium animate-fade-in">
						{error}
					</div>
				)}

				<form onSubmit={handleSubmit} className="space-y-4">
					<div>
						<label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5 font-mono">
							Password
						</label>
						<div className="relative">
							<input
								type={showPassword ? "text" : "password"}
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								placeholder="Enter admin password..."
								className="w-full pl-9 pr-10 py-2.5 bg-[var(--bg-elevated)] border border-[var(--border-color)] hover:border-[var(--text-muted)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--text-primary)] transition-colors font-mono"
								required
								autoFocus
							/>
							<Key className="w-3.5 h-3.5 text-[var(--text-dim)] absolute left-3 top-3.5 pointer-events-none" />
							<button
								type="button"
								onClick={() => setShowPassword(!showPassword)}
								className="absolute right-3 top-2.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1 cursor-pointer"
								aria-label={showPassword ? "Hide password" : "Show password"}
							>
								{showPassword ? (
									<EyeOff className="w-3.5 h-3.5" />
								) : (
									<Eye className="w-3.5 h-3.5" />
								)}
							</button>
						</div>
					</div>

					<button
						type="submit"
						disabled={loading}
						className="w-full py-2.5 bg-[var(--brand)] hover:opacity-90 text-[var(--brand-fg)] rounded-lg transition-all font-semibold text-xs shadow-xs disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer uppercase tracking-wider font-mono"
					>
						{loading && (
							<div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
						)}
						<span>{loading ? "AUTHENTICATING..." : "AUTHORIZE_ACCESS"}</span>
					</button>
				</form>

				<div className="mt-7 pt-5 border-t border-[var(--border-color)] flex items-center justify-between text-xs text-[var(--text-muted)]">
					<Link
						href="/"
						className="hover:text-[var(--text-primary)] transition-colors flex items-center gap-1"
					>
						<ArrowLeft className="w-3.5 h-3.5" />
						<span>Return to Home</span>
					</Link>
					<span className="text-[10px] text-[var(--text-dim)] font-mono">
						HTTP Cookie
					</span>
				</div>
			</div>
		</div>
	)
}
