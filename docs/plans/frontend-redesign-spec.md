# MCPedia Frontend Redesign — Spec

Status: DRAFT — minta approval sebelum coding
Date: 2026-09-08 WIB
Author: Hermes

## 1. Tujuan

Merombak `apps/web` agar:
- Satu sumber kebenaran: semua data berasal dari `@mcpedia/core` types & `@mcpedia/config` section presets; tidak ada shape duplikat di FE.
- Selaras dengan gateway/BE data flow: tRPC `apps/api` (`/trpc/*`) + REST `/api/*` + MCP `:4021` semua mengembalikan shape yang sama (DocumentMeta, SectionInfo, SearchHit, ExportData).
- Ganti pola fetch ad-hoc (`fetch("/api/...")` tersebar) dengan **SWR** terpusat — cache, revalidate, mutate, optimistic UI, error boundary konsisten.
- Hapus sisa TanStack (saat ini tidak ada deps TanStack — audit `apps/web/package.json` clean; tapi pola akan dibakukan supaya tidak masuk lagi).
- UI: Archival Precision tetap (monochrome, hairline, mono telemetry), tapi lebih live dan terisi data real (bukan placeholder).

## 2. Audit Status Quo

### FE sekarang
- Next.js 16.3.4, App Router, `force-dynamic` di semua page yang baca DB.
- RSC langsung import `@mcpedia/core` (`listDocuments`, `getDocument`, `listSections`, `getRelated`, `listRevisions`, `getExportDocuments`). SEO bagus, tapi client components (Sidebar, Header, Search, CommandMenu) fetch ulang via REST tanpa cache sharing.
- REST: `/api/search?q&mode&limit`, `/api/docs` (list), `/api/sections`, `/api/export?path&sort`, `/api/revisions/restore`, `/api/auth/login`.
- tRPC `apps/api` (Hono) expose: search/semanticSearch/hybridSearch, getDocument, listDocuments, sections, related, revisions, CRUD (gated `x-webhook-secret`), jobStatus, reindex hooks, `/health`, `/metrics`.
- MCP `:4021` Streamable HTTP `/mcp` expose 13 tools (tidak dipakai FE, tapi shape-nya sama).
- Tidak ada `swr` / `@tanstack/react-query` di `apps/web/package.json` — jadi migrasi = greenfield SWR layer, bukan replace.
- Design tokens sudah rapi di `globals.css` (CSS vars light/dark + `--brand`, `--bg-*`, `--text-*`, `--code-*`). Header/Sidebar/Markdown/TOC/DocActions sudah pakai tokens.

### Masalah yang diselesaikan redesign
1. Sidebar & Header fetch `/api/docs` + `/api/sections` tanpa deduplikasi — tiap navigasi fetch ulang, tidak ada stale-while-revalidate.
2. Search page client-side `fetch` manual tanpa debounce terpusat, tanpa cache antar-mode (hybrid/keyword/semantic saling overwrite).
3. Doc page RSC tidak live: setelah create/update/delete atau reindex, harus hard refresh. Tidak ada `mutate` cross-component.
4. Shape drift: Search `snippet` vs `SearchHit` vs `ChunkHit` tidak konsisten antara `/api/search` dan `@mcpedia/search` — perlu typed fetcher.
5. Tidak ada surface untuk queue/embeddings status (BE punya `jobStatus`, `queueStatus`, `INDEX_QUEUE` BullMQ) — FE buta terhadap indexing.

## 3. Arsitektur Target

```
apps/web/app/
  lib/
    fetcher.ts          — typed fetcher (fetch JSON + error envelope)
    swr.ts              — SWRConfig global (dedupingInterval, focusThrottle, errorRetry)
    api.ts              — typed client untuk /api/* (listDocuments, search, sections, export, revisions)
  hooks/
    useSections.ts      — SWR '/api/sections' -> SectionInfo[]
    useDocuments.ts     — SWR '/api/docs?section&status' -> DocumentMeta[]
    useDocument.ts      — SWR '/api/docs/:slug' (baru, GET single) -> Document
    useSearch.ts        — SWR key [q, mode, limit] -> SearchHit[] + debounced
    useRelated.ts       — SWR '/api/related?slug'
    useRevisions.ts     — SWR '/api/revisions?slug'
    useQueueStatus.ts   — SWR '/api/queue/status' poll 5s (opsional, admin only)
  components/
    (existing: Header, Sidebar, CommandMenu, Markdown, TOC, DocActions, ...)
    SearchBar.tsx       — reusable, dipakai Header + Search page + CommandMenu
    SectionCard.tsx     — extract dari page.tsx
    DocumentCard.tsx    — reusable card (recent, related, folder list)
    TagCloud.tsx        — baru: agregasi tags dari docs
    QueueBadge.tsx      — baru: show indexing status (waiting/active/failed)
    EmptyState.tsx / ErrorState.tsx
  app/
    layout.tsx          — tambah <SWRProvider> wrapper (client boundary)
    page.tsx            — refactor: RSC shell + client islands via SWR
    [section]/page.tsx  — sama
    [section]/[...slug]/page.tsx — RSC hero + Markdown, client islands (related/revisions via SWR)
    search/page.tsx     — fully SWR, hapus useState fetch manual
    create/page.tsx     — mutate after create
    dashboard/page.tsx  — BARU (optional phase 2): queue, sections, recent, tag stats
```

### Prinsip SWR
- Satu `fetcher` generic: `fetcher<T>(url: string): Promise<T>` — throw on !ok dengan `info` + `status` untuk error boundary.
- `SWRConfig` di `layout.tsx` client wrapper: `dedupingInterval: 4000`, `focusThrottleInterval: 10000`, `shouldRetryOnError: false` untuk search, `refreshInterval` hanya untuk queue.
- Semua hooks pakai key array/string yang deterministic supaya `mutate` cross-page bisa: `mutate('/api/docs')`, `mutate('/api/sections')`.
- Debounce search di hook, bukan di component: `useDebouncedValue(q, 180ms)` internal ke `useSearch`.
- Optimistic mutate untuk create/update/delete: `mutate('/api/docs', optimisticList, false)` lalu revalidate.

## 4. Kontrak Data (FE ↔ BE)

Semua types import dari `@mcpedia/types` — tidak ada re-declare shape di FE.

| FE Hook | BE Source | Endpoint | Shape |
|---------|-----------|----------|-------|
| useSections | `listSections()` | `GET /api/sections` | `SectionInfo[]` |
| useDocuments | `listDocuments({section,status})` | `GET /api/docs?section=&status=` | `DocumentMeta[]` |
| useDocument | `getDocument(slug)` | `GET /api/docs/:slug` (baru) | `Document` |
| useSearch | `keywordSearch/hybridSearch/semanticSearch` | `GET /api/search?q&mode&limit` | `{results: {slug,title,section,score,snippet}[]}` |
| useRelated | `getRelated(slug)` | `GET /api/related?slug=` (baru, atau reuse via core) | `DocumentMeta[]` |
| useRevisions | `listRevisions(slug)` | `GET /api/revisions?slug=` (baru) | `Revision[]` |
| useQueueStatus | BullMQ `getQueue()` | `GET /api/queue/status` (baru, proxy ke apps/api /metrics atau queue) | `{waiting,active,completed,failed,delayed}` |

**Tambahan endpoint yang perlu dibuat (tipis, proxy ke core):**
- `GET /api/docs/[slug]` — single doc (hindari RSC-only fetch, enable SWR).
- `GET /api/related?slug=&limit=` — wrapper `getRelated`.
- `GET /api/revisions?slug=&limit=` — wrapper `listRevisions`.
- `GET /api/queue/status` — wrapper `getQueue().get*Count()` (admin-only atau public read-only).
- (Opsional) `GET /api/tags` — agregasi tags dari `listDocuments` untuk TagCloud.

Semua endpoint return envelope sama: `{data}` atau `{results}` + `{error}` on 500, dengan `Content-Type: application/json`. Auth untuk mutasi tetap `x-webhook-secret` atau cookie `mcpedia_admin`.

## 5. Perubahan Per-File (Rincian)

### Phase 0 — Foundation (wajib)
- `apps/web/package.json`: tambah `swr: ^2.3.x` (latest 2.x). Tidak tambah TanStack. `bun install` + cek `typecheck`.
- `apps/web/app/lib/fetcher.ts` (baru): `export const fetcher = <T>(url: string): Promise<T> => fetch(url).then(r => { if(!r.ok) throw ...; return r.json() })`
- `apps/web/app/lib/swr.tsx` (baru): `SWRProvider` client component wrapping `SWRConfig`.
- `apps/web/app/lib/api.ts` (baru): typed helpers `searchDocs(q,mode,limit)`, `listDocs()`, `listSections()` — dipakai hooks.
- `apps/web/app/layout.tsx`: bungkus children dengan `<SWRProvider>` (client boundary minimal).

### Phase 1 — Hooks + Refactor Existing Pages
- `hooks/useSections.ts`, `useDocuments.ts`, `useSearch.ts`: ganti `useEffect+fetch` di `Header.tsx`, `Sidebar.tsx`, `search/page.tsx`, `CommandMenu.tsx`, `page.tsx` (home).
- `Header.tsx`: `useSections()` alih-alih `useState+useEffect fetch /api/sections`.
- `Sidebar.tsx`: `useDocuments()` + `useSections()` + filter memo — hilangkan `useEffect fetch /api/docs`.
- `search/page.tsx`: `useSearch(q, mode)` — hapus `handleSearch` manual, pakai `isLoading`, `isValidating`, `error` dari SWR. Mode & section filter tetap local state, tapi key SWR mencakup keduanya.
- `CommandMenu.tsx`: `useSearch(query)` debounced — hapus timer manual.
- `app/page.tsx`: tetap RSC untuk SEO (listDocuments/listSections server), tapi `SectionTree` dan `Recently Updated` bisa jadi client islands yang pakai SWR untuk live update (opsional: keep RSC + `mutate` on focus).
- `[section]/page.tsx` & `[section]/[...slug]/page.tsx`: RSC hero + Markdown tetap, `related` & `revisions` pindah ke client islands `RelatedGrid` & `RevisionList` pakai `useRelated`/`useRevisions`.

### Phase 2 — Fitur Baru (detail)
1. **Dashboard `/dashboard` (baru, admin-aware):**
   - Cards: total docs, sections, queue (waiting/active/failed), embedding provider status.
   - Section breakdown bar (docCount per section).
   - Tag cloud (top 20 tags dengan count).
   - Recent activity (last 10 updated docs).
   - Queue status poll 5s via `useQueueStatus` (hanya jika admin cookie ada, else hide).
2. **Tag Explorer `/tags` atau sidebar widget:**
   - `GET /api/tags` agregasi, klik tag → `/search?tag=...` atau filter docs.
3. **Doc page enhancements:**
   - `QueueBadge` di hero jika doc sedang di-index (query queue by slug).
   - Optimistic revision restore: `mutate('/api/revisions?slug=...')` setelah POST restore.
   - Related docs pakai SWR + `keepPreviousData`.
4. **Search enhancements:**
   - Persist `mode` di URL (`?q=&mode=hybrid`) — sudah ada, pertahankan + SWR key sync.
   - Highlight snippet `mark` sudah ada — pertahankan.
   - Empty & error states pakai `EmptyState`/`ErrorState` components.
5. **Create/Edit:**
   - Setelah `POST /api/docs`, `mutate('/api/docs')` + `mutate('/api/sections')` + `router.push('/${slug}')`.
   - Custom fields (extraFields) tetap flat → `splitPayload` di BE tidak berubah.
6. **Export:**
   - `PdfExportView` tetap, tapi tambah SWR preload `getExportDocuments` untuk preview count sebelum export.

### Phase 3 — Polish & Cleanup
- Hapus semua `fetch` ad-hoc yang tersisa — semua lewat hooks.
- Pastikan `globals.css` tokens dipakai konsisten (tidak ada hard-coded hex baru).
- `CommandMenu` jadi satu-satunya omnisearch entry — `Header` search icon di mobile buka CommandMenu, bukan link `/search`.
- A11y: `aria-live` untuk search results count, `role="status"` untuk queue badge.
- Print/PDF styles sudah ada — tidak diubah.

## 6. File yang Disentuh (Checklist)

Baru:
- `apps/web/app/lib/fetcher.ts`
- `apps/web/app/lib/swr.tsx`
- `apps/web/app/lib/api.ts`
- `apps/web/app/hooks/useSections.ts`
- `apps/web/app/hooks/useDocuments.ts`
- `apps/web/app/hooks/useSearch.ts`
- `apps/web/app/hooks/useRelated.ts`
- `apps/web/app/hooks/useRevisions.ts`
- `apps/web/app/hooks/useQueueStatus.ts`
- `apps/web/app/hooks/useTags.ts` (opsional)
- `apps/web/app/components/SearchBar.tsx`
- `apps/web/app/components/SectionCard.tsx`
- `apps/web/app/components/DocumentCard.tsx`
- `apps/web/app/components/TagCloud.tsx`
- `apps/web/app/components/QueueBadge.tsx`
- `apps/web/app/components/EmptyState.tsx`
- `apps/web/app/dashboard/page.tsx` (baru)
- `apps/web/app/api/docs/[slug]/route.ts` (baru)
- `apps/web/app/api/related/route.ts` (baru)
- `apps/web/app/api/revisions/route.ts` (baru GET)
- `apps/web/app/api/queue/status/route.ts` (baru)
- `apps/web/app/api/tags/route.ts` (baru, opsional)

Edit:
- `apps/web/package.json` (+ swr)
- `apps/web/app/layout.tsx` (+ SWRProvider)
- `apps/web/app/page.tsx` (extract SectionCard, optional SWR islands)
- `apps/web/app/[section]/page.tsx` (DocumentCard)
- `apps/web/app/[section]/[...slug]/page.tsx` (related/revisions islands)
- `apps/web/app/search/page.tsx` (full SWR)
- `apps/web/app/components/Header.tsx` (useSections)
- `apps/web/app/components/Sidebar.tsx` (useDocuments/useSections)
- `apps/web/app/components/CommandMenu.tsx` (useSearch)
- `apps/web/app/create/page.tsx` (mutate)
- `apps/web/app/components/DocForm.tsx` (mutate setelah submit)

Tidak disentuh:
- `packages/core`, `packages/types`, `packages/config`, `packages/db` (hanya dibaca)
- `apps/api`, `apps/mcp`, `apps/worker` (hanya diproxy)
- `globals.css`, `next.config.ts`, `tailwind` config (kecuali perlu token baru)

## 7. Urutan Implementasi

1. Phase 0 foundation → `bun install && bun run typecheck` green.
2. Phase 1 hooks + Header/Sidebar/Search/CommandMenu → manual test + `next build` smoke.
3. Phase 2 doc page islands + create mutate → test CRUD flow dengan `x-webhook-secret` / admin cookie.
4. Phase 2 dashboard + tags → behind `canEdit` guard jika perlu.
5. Phase 3 cleanup, hapus fetch manual, final `bun run lint && typecheck && build`.

## 8. Verifikasi

- `bun run typecheck` — tidak ada error (SWR types + @mcpedia/types).
- `bun run lint` — rules Next 16 ok.
- `bun --cwd apps/web run build` — semua route `force-dynamic` OK, tidak ada import-time DB throw.
- Manual:
  - Sidebar filter + section count live setelah create doc.
  - Search mode switch (hybrid/keyword/semantic) cache terpisah, tidak flicker.
  - CommandMenu ⌘K debounce 180ms, Enter navigasi benar.
  - Doc related & revisions muncul via SWR tanpa hard refresh.
  - Queue badge (jika ada) poll 5s, tidak spam (dedupingInterval).
  - Dark/light toggle tetap work (SWRProvider tidak break `ThemeToggle`).
- Staging: `curl /api/search?q=test&mode=hybrid`, `/api/sections`, `/api/docs` return shape konsisten dengan tRPC.

## 9. Risiko & Mitigasi

- RSC + SWR double fetch: mitigasi dengan `fallbackData` dari RSC props ke SWR hook di islands (opsi, tidak wajib v1).
- Peningkatan request ke DB: SWR deduping 4s + `revalidateOnFocus: false` untuk search, `true` untuk sections/docs.
- Auth untuk `/api/queue/status`: jadikan public read-only (hanya counts, bukan detail job) — aman.

## 10. Keputusan yang Perlu Kamu Konfirmasi

1. **Dashboard `/dashboard` perlu tidak?** Atau cukup queue badge di existing pages? Rekomendasi: bikin, tapi Phase 2 — bisa ditunda.
2. **Endpoint baru (`/api/docs/[slug]`, `/api/related`, `/api/revisions` GET, `/api/queue/status`, `/api/tags`) setuju?** Alternatif: FE langsung pakai tRPC client (`@trpc/client`) — tapi spec ini pilih REST `/api/*` supaya Next cache & SWR fetcher simpel.
3. **SWR vs tRPC+SWR?** Spec ini pakai SWR+REST (paling simpel, tidak tambah `@trpc/client` di FE). Jika mau tRPC, tambah `createTRPCClient` + `httpBatchLink` — tradeoff: lebih typed tapi lebih berat. Default: SWR+REST.
4. **Keep RSC server fetch untuk SEO atau full client SWR?** Rekomendasi: keep RSC untuk initial HTML (SEO), SWR untuk live revalidation di client islands — hybrid, bukan full SWR.

---

Jawab: `Lanjut Phase 0+1` untuk eksekusi, atau beri koreksi poin 10.
