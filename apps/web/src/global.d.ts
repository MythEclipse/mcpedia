/*
 * Module declarations for assets the Vite build handles but tsc cannot resolve.
 *
 * `src/main.tsx` imports `./styles.css` as a pure side effect — its value is
 * never used. TypeScript 7 (pulled in by this PR's dev-dependency bump) rejects
 * side-effect imports of `.css` unless a module declaration exists; TS 5.x
 * silently allowed them, which is why the bump turned this latent gap into a
 * red gate.
 *
 * Declared here rather than inline in main.tsx so every CSS import across the
 * SPA (styles.css, theme.css) is covered in one place. Vite strips these
 * declarations at build time — they only satisfy the typechecker.
 */
declare module "*.css"
