# Phase 15c — Theme-Consistent Color System

> User: "banyak pewarnaan yg tidak sesuai tema dark mode atau light mode"

## Problem
63 hardcoded hex colors (#5e6ad2, #7170ff, #4f46e5, etc.) bypass the CSS
variable theme system in globals.css. These don't adapt between light/dark mode
properly — the `dark:` variant changes text color but background stays the same.

## Color Mapping

### `#5e6ad2` (indigo-600)
- Light: `--brand: #5e6ad2` (same)
- Dark: `--brand: #5e6ad2` (same)
→ Replace with `var(--brand)`

### `#4f46e5` (indigo-700)
- Light: `--accent: #4f46e5`
- Dark: `--accent: #7170ff`
→ Replace with `var(--accent)`

### `#7170ff` (light blue, dark mode accent)
- Light: `var(--accent)` (#4f46e5)
- Dark: `var(--accent)` (#7170ff)
→ Replace `dark:text-[#7170ff]` → `dark:text-[var(--accent)]`

### `#6a75e0` (hover lighter)
→ Replace with `var(--accent-hover)`

### `/10`, `/15`, `/20`, `/30` opacity tints
- `bg-[#5e6ad2]/15` → `bg-[var(--brand)]/15`
- `bg-[#5e6ad2]/10` → `bg-[var(--brand)]/10`
- `bg-[#5e6ad2]/30` → `bg-[var(--brand)]/30`

## Files to fix
- `[section]/[...slug]/page.tsx` (~16 instances)
- `[section]/page.tsx` (~5 instances)
- `components/Sidebar.tsx` (2 instances)
- `components/DocForm.tsx` (~6 instances)
- `components/CommandMenu.tsx` (~6 instances)
- `components/Header.tsx` (2 instances)
- `components/McpConfigSnippet.tsx` (1 instance)
- `page.tsx` (check)
