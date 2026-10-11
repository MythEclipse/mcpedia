"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Lock, Key, Mail, Eye, EyeOff, ArrowLeft } from "lucide-react"
import { authClient } from "@/lib/auth-client"

/**
 * Sign in / sign up.
 *
 * This replaced a single-field password form that POSTed to /api/auth/login,
 * which compared the submitted string to ADMIN_PASSWORD and set a cookie whose
 * value was the literal "admin" for every successful login. better-auth manages
 * real per-user credentials: the password is hashed into `account.password` and
 * the session is a random token row in `session`, not a shared cookie value.
 *
 * The first account to sign up is granted the `admin` role (see auth-server.ts
 * `databaseHooks`); later ones are plain "user" and cannot reach /create or the
 * CRUD routes.
 */
export default function LoginPage() {
	const router = useRouter()
	const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in")
	const [email, setEmail] = useState("")
	const [password, setPassword] = useState("")
	const [name, setName] = useState("")
	const [showPassword, setShowPassword] = useState(false)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		setLoading(true)
		setError(null)

		try {
			const result =
				mode === "sign-in"
					? await authClient.signIn.email({
							email: email.trim(),
							password,
						})
					: await authClient.signUp.email({
							email: email.trim(),
							password,
							name: name.trim() || email.trim(),
						})

			if (result.error) {
				throw new Error(result.error.message ?? "Authentication failed.")
			}

			router.push("/create")
			router.refresh()
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		} finally {
			setLoading(false)
		}
	}

	const fieldClass =
		"w-full pl-9 pr-3 py-2.5 bg-[var(--bg-elevated)] border border-[var(--border-color)] hover:border-[var(--text-muted)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--text-primary)] transition-colors font-mono"

	return (
		<div className="flex min-h-[65vh] items-center justify-center px-4">
			<div className="w-full max-w-md bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl p-6 sm:p-8 shadow-xs relative">
				<div className="text-center mb-7">
					<div className="w-10 h-10 rounded-lg bg-[var(--brand)] text-[var(--brand-fg)] font-bold text-sm flex items-center justify-center mx-auto mb-3 shadow-xs font-mono">
						<Lock className="w-4 h-4" />
					</div>
					<h1 className="text-xl font-bold text-[var(--text-primary)] tracking-tight">
						{mode === "sign-in" ? "Admin Sign In" : "Create Account"}
					</h1>
					<p className="text-xs text-[var(--text-muted)] mt-1">
						{mode === "sign-in"
							? "Sign in to authorize document mutations."
							: "The first account created becomes the admin."}
					</p>
				</div>

				{error && (
					<div className="p-3 mb-5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-500 dark:text-rose-400 text-xs font-medium animate-fade-in">
						{error}
					</div>
				)}

				<form onSubmit={handleSubmit} className="space-y-4">
					{mode === "sign-up" && (
						<div>
							<label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5 font-mono">
								Name
							</label>
							<div className="relative">
								<input
									type="text"
									value={name}
									onChange={(e) => setName(e.target.value)}
									placeholder="Ada Lovelace"
									className={fieldClass}
									autoFocus
								/>
								<Mail className="w-3.5 h-3.5 text-[var(--text-dim)] absolute left-3 top-3.5 pointer-events-none" />
							</div>
						</div>
					)}

					<div>
						<label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5 font-mono">
							Email
						</label>
						<div className="relative">
							<input
								type="email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								placeholder="admin@example.com"
								className={fieldClass}
								required
								autoFocus={mode === "sign-in"}
							/>
							<Mail className="w-3.5 h-3.5 text-[var(--text-dim)] absolute left-3 top-3.5 pointer-events-none" />
						</div>
					</div>

					<div>
						<label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5 font-mono">
							Password
						</label>
						<div className="relative">
							<input
								type={showPassword ? "text" : "password"}
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								placeholder={
									mode === "sign-up" ? "At least 12 characters" : "••••••••••••"
								}
								className={`${fieldClass} pr-10`}
								required
								minLength={mode === "sign-up" ? 12 : undefined}
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
						<span>
							{loading
								? "AUTHENTICATING..."
								: mode === "sign-in"
									? "SIGN_IN"
									: "CREATE_ACCOUNT"}
						</span>
					</button>
				</form>

				<button
					type="button"
					onClick={() => {
						setMode(mode === "sign-in" ? "sign-up" : "sign-in")
						setError(null)
					}}
					className="mt-4 w-full text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer font-mono"
				>
					{mode === "sign-in"
						? "No account yet? Create one"
						: "Already have an account? Sign in"}
				</button>

				<div className="mt-7 pt-5 border-t border-[var(--border-color)] flex items-center justify-between text-xs text-[var(--text-muted)]">
					<Link
						href="/"
						className="hover:text-[var(--text-primary)] transition-colors flex items-center gap-1"
					>
						<ArrowLeft className="w-3.5 h-3.5" />
						<span>Return to Home</span>
					</Link>
					<span className="text-[10px] text-[var(--text-dim)] font-mono">
						Session Cookie
					</span>
				</div>
			</div>
		</div>
	)
}
