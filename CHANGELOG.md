## [1.2.3](https://github.com/asepharyana/mcpedia/compare/v1.2.2...v1.2.3) (2026-10-17)


### Bug Fixes

* **migrate:** bundling ran two migrators, breaking every deploy ([ed2bbfd](https://github.com/asepharyana/mcpedia/commit/ed2bbfd310d648993e4da510783ebf75ce0864f7))

## [1.2.2](https://github.com/asepharyana/mcpedia/compare/v1.2.1...v1.2.2) (2026-10-17)


### Bug Fixes

* **worker:** index jobs must read Postgres, not a disk the deploy host lacks ([b224dda](https://github.com/asepharyana/mcpedia/commit/b224dda81350ef9faff70731c4dca696f869e016))

## [1.2.1](https://github.com/asepharyana/mcpedia/compare/v1.2.0...v1.2.1) (2026-10-17)


### Bug Fixes

* **sections:** a partial upsert must not blank the fields it omits ([cffcb7e](https://github.com/asepharyana/mcpedia/commit/cffcb7ec6375a5b72f2ac233bb02c50167dfb3b1))

# [1.2.0](https://github.com/asepharyana/mcpedia/compare/v1.1.5...v1.2.0) (2026-10-17)


### Features

* **sections:** move section metadata from hardcoded tables into the database ([b179000](https://github.com/asepharyana/mcpedia/commit/b1790001c838c034ea19595bc261deabd319e03b))

## [1.1.5](https://github.com/asepharyana/mcpedia/compare/v1.1.4...v1.1.5) (2026-10-17)


### Bug Fixes

* **web:** stop doubling the section in folder breadcrumbs ([5a000e3](https://github.com/asepharyana/mcpedia/commit/5a000e365743f5b8df6d2866a6cc7bed92fa145d))

## [1.1.4](https://github.com/asepharyana/mcpedia/compare/v1.1.3...v1.1.4) (2026-10-17)


### Bug Fixes

* **web:** render the matched route — document URLs showed the section index ([0628324](https://github.com/asepharyana/mcpedia/commit/0628324660856280f9edb88dd2dc30e484c0fce7))

## [1.1.3](https://github.com/asepharyana/mcpedia/compare/v1.1.2...v1.1.3) (2026-10-17)


### Bug Fixes

* **web:** stop advertising pgvector and the Postgres search arm we no longer have ([b2d540b](https://github.com/asepharyana/mcpedia/commit/b2d540b7fc023394797edd8d8c8605b227c80e3a))

## [1.1.2](https://github.com/asepharyana/mcpedia/compare/v1.1.1...v1.1.2) (2026-10-17)


### Bug Fixes

* **scripts:** exit the reindex explicitly so it does not hang after its work ([0f52898](https://github.com/asepharyana/mcpedia/commit/0f52898678bc0855830bbc672052e8c67df62593))

## [1.1.1](https://github.com/asepharyana/mcpedia/compare/v1.1.0...v1.1.1) (2026-10-17)


### Bug Fixes

* **search:** guard the chunks read with the same ownership check as the delete ([7754418](https://github.com/asepharyana/mcpedia/commit/7754418dfdd51373a8651074fc69174dd41b9721))

# [1.1.0](https://github.com/asepharyana/mcpedia/compare/v1.0.7...v1.1.0) (2026-10-17)


### Features

* **search:** namespace the corpora inside one shared hindsight bank ([064d6d7](https://github.com/asepharyana/mcpedia/commit/064d6d76283b0a27510af45ac05df5e9ee2b37c1))

## [1.0.7](https://github.com/asepharyana/mcpedia/compare/v1.0.6...v1.0.7) (2026-10-17)


### Bug Fixes

* **ci:** gate the deploy job on the ref, not the event — a dispatch could deploy a branch ([2522d74](https://github.com/asepharyana/mcpedia/commit/2522d749072c70c6f0d980583d7e8cb4e543083a))

## [1.0.6](https://github.com/asepharyana/mcpedia/compare/v1.0.5...v1.0.6) (2026-10-17)

## [1.0.5](https://github.com/asepharyana/mcpedia/compare/v1.0.4...v1.0.5) (2026-10-16)

## [1.0.4](https://github.com/asepharyana/mcpedia/compare/v1.0.3...v1.0.4) (2026-10-15)


### Bug Fixes

* auto-fix code quality [skip ci] ([1164254](https://github.com/asepharyana/mcpedia/commit/1164254409895285505bb7e296a39a34557e04e3))
* auto-fix code quality [skip ci] ([6bcd2ee](https://github.com/asepharyana/mcpedia/commit/6bcd2eef735f379999a3fd804564ad2b01c33ca9))

## [1.0.3](https://github.com/asepharyana/mcpedia/compare/v1.0.2...v1.0.3) (2026-10-14)


### Bug Fixes

* auto-fix code quality [skip ci] ([6754da8](https://github.com/asepharyana/mcpedia/commit/6754da8ea44baf7f67bb582f4f71ea5bfe75e64c))

## [1.0.2](https://github.com/asepharyana/mcpedia/compare/v1.0.1...v1.0.2) (2026-10-14)

### Bug Fixes

* auto-fix code quality [skip ci] ([da8f5f0](https://github.com/asepharyana/mcpedia/commit/da8f5f0e237c24ebd4272089c0a0373e6757c234))
* auto-fix code quality [skip ci] ([3480b85](https://github.com/asepharyana/mcpedia/commit/3480b85ca02b94333e9418c44a7762fbb38b461a))
* auto-fix code quality [skip ci] ([e759c6e](https://github.com/asepharyana/mcpedia/commit/e759c6e6d1c139795c4a34e1890be793cd80f0f9))
* auto-fix code quality [skip ci] ([9b47ce7](https://github.com/asepharyana/mcpedia/commit/9b47ce70b2f55088a0ebd84064fec11ed9154d4f))
* auto-fix code quality [skip ci] ([eccf279](https://github.com/asepharyana/mcpedia/commit/eccf27966e4921e6a37b7f79d00e02c17c1d1288))

## [1.0.1](https://github.com/asepharyana/mcpedia/compare/v1.0.0...v1.0.1) (2026-10-14)

# 1.0.0 (2026-10-14)


### Bug Fixes

* add remark-gfm plugin to Markdown component for table rendering ([8906ed5](https://github.com/asepharyana/mcpedia/commit/8906ed55a07254e5d2c95530847fc8f74fd3b955))
* **auth:** trust both public hostnames and route /api/auth to the API ([1c2a61d](https://github.com/asepharyana/mcpedia/commit/1c2a61d547be04358b3a05f1d81b11ef022b7d42))
* auto-fix code quality [skip ci] ([badc488](https://github.com/asepharyana/mcpedia/commit/badc4885c022fba034d4c1ac84f128d37be0657d))
* auto-fix code quality [skip ci] ([466bc65](https://github.com/asepharyana/mcpedia/commit/466bc655ac4f687d15b202a5311a871050857679))
* auto-fix code quality [skip ci] ([ea6532c](https://github.com/asepharyana/mcpedia/commit/ea6532c703cb4a08448b9c9dde40b33cf3091099))
* auto-fix code quality [skip ci] ([b4bbf68](https://github.com/asepharyana/mcpedia/commit/b4bbf6892cd3690bce46f39cffb3ebd5b33398bf))
* auto-fix code quality [skip ci] ([10a15a1](https://github.com/asepharyana/mcpedia/commit/10a15a133c5811165e89b30d5d54d713848bf203))
* auto-fix code quality [skip ci] ([006bf79](https://github.com/asepharyana/mcpedia/commit/006bf7965530a370ce506b8c6cb9da3ad87fa5b1))
* bind the admin cookie to a known value, and start testing web code ([9deef02](https://github.com/asepharyana/mcpedia/commit/9deef02461c64bb63136ab12dc72452a06e2ce74))
* bundle @mcpedia/* deps in nix build, fix runtime module resolution ([c22e394](https://github.com/asepharyana/mcpedia/commit/c22e394f9849f96a2bba6561beb4003568fd8409))
* CI build steps — use 'cd X && bun run' not 'bun --cwd' ([628068e](https://github.com/asepharyana/mcpedia/commit/628068e33d340469801e10b6f3055ead17c35d44))
* CI/CD — move web build to CI, VPS only deploys (no build on VPS) ([77792c6](https://github.com/asepharyana/mcpedia/commit/77792c624b2c2b9c40d0f2324cfce5e38c0d0ba5))
* CI/CD — replace broken bun --cwd with turbo --filter for web build ([90e40c4](https://github.com/asepharyana/mcpedia/commit/90e40c4d480bd96084fb4aca8a50c2564882fd8e))
* close three auth bypasses and repair the migration chain ([fe33492](https://github.com/asepharyana/mcpedia/commit/fe33492a9ea0bd578a78226016b53d7dddfcd5b9))
* **config:** don't throw on missing DATABASE_URL at import time ([f4fb43c](https://github.com/asepharyana/mcpedia/commit/f4fb43c1a5edcfdffedbb65b40d82ee49f90714a))
* **config:** redis default ke local 127.0.0.1:6380 (imrnes offline) ([7186741](https://github.com/asepharyana/mcpedia/commit/7186741258a6dfe969ca6b92798999bcc9226e61))
* **core:** strip YAML frontmatter in getDocument before web/MCP render ([ca2bd19](https://github.com/asepharyana/mcpedia/commit/ca2bd19c4851a8f9aaa241f083315fb4d0e1add2))
* correct artifact name in deploy (mcpedia-web-build not mcpedia-web-standalone) ([596d3cf](https://github.com/asepharyana/mcpedia/commit/596d3cf6169f1f8508bd15c90817f3b68f151031))
* correct scripts/moon.yml deps and Biome's own ignore-glob warnings ([0b2d37d](https://github.com/asepharyana/mcpedia/commit/0b2d37dd1f23862f34bafdfadafdc835f907d5a7))
* deploy script — replace broken bun --cwd with subshell cd for VPS build ([e8ed598](https://github.com/asepharyana/mcpedia/commit/e8ed5980fca013608ed06e09d6eb3499d982113e))
* **deploy:** build the SPA with vite and serve dist instead of Next ([82d1d5e](https://github.com/asepharyana/mcpedia/commit/82d1d5e233c6fa10fcd8bf724c8be372680dd947))
* **deploy:** correctly copy prebuilt .next to apps/web/.next on VPS during deployment ([8adfffb](https://github.com/asepharyana/mcpedia/commit/8adfffb6e7f03b98f1689130d83ccfd3d854c5d0))
* **deploy:** make the systemd units restartable and ship them with the code ([5c6da92](https://github.com/asepharyana/mcpedia/commit/5c6da92f79ce92ef90959a88518c2a2a81e0ed22))
* **deploy:** wire Phase 3 services + GitHub git-sync webhook ([ec0ab4d](https://github.com/asepharyana/mcpedia/commit/ec0ab4dbb31904ff43e13fd7835282e07408160f))
* **embeddings:** defer EMBED_* validation to embed() runtime, not constructor ([b454a0f](https://github.com/asepharyana/mcpedia/commit/b454a0fbac31548a70ad4f8a6e61c68f1728cf27))
* give moon's build tasks resolvable binaries and honest outputs ([e1b7a4a](https://github.com/asepharyana/mcpedia/commit/e1b7a4a35d1516a835bebfb388d6f016dc32d7f7))
* guard db:migrate against replaying the squashed baseline ([ed1931e](https://github.com/asepharyana/mcpedia/commit/ed1931e5b93653b5abf2a442cc86461ded9362eb))
* make biome.json actually usable — declare the tool, fix the globs ([b4ce191](https://github.com/asepharyana/mcpedia/commit/b4ce19140bd77af6fecdade50a67dc91a105102e))
* make chunk replacement atomic, as its comment always claimed ([6105cca](https://github.com/asepharyana/mcpedia/commit/6105cca0a646971926d75198901ae245a7c45411))
* make db:push non-fatal in deploy (column may pre-exist) ([3411dcf](https://github.com/asepharyana/mcpedia/commit/3411dcfa9fbe91b14789c7212492276bb9c8bf2f))
* make deploy rollback work for directory payloads ([143a548](https://github.com/asepharyana/mcpedia/commit/143a54814e44e964b6e49360b7c6b9faffafc534))
* make MCP smoke test conditional on DATABASE_URL ([0234c5c](https://github.com/asepharyana/mcpedia/commit/0234c5cbe656badc4c7b3c1d6da0ec52736be8ae))
* **mcp-client:** reject a non-JSON tool payload at the call site ([6baaa8a](https://github.com/asepharyana/mcpedia/commit/6baaa8a0b7ec28e2f6a523ef4553728b8b270cbc))
* merge CI + Deploy into single workflow (fixes artifact sharing) ([074fa9f](https://github.com/asepharyana/mcpedia/commit/074fa9f316e6df8c6265c33994ed93fe7b9f8fdd))
* nix build with dontFixup for .bun symlink issues, use root node_modules + Attic cache push ([aedcfbf](https://github.com/asepharyana/mcpedia/commit/aedcfbf4e721845c1af212f9d80df3996be648e6))
* nix build with dontFixup, root node_modules copy, web path literal fix ([e01ee22](https://github.com/asepharyana/mcpedia/commit/e01ee22438c4470b16248959a808b151849f2518))
* Phase 14 + Phase 15 — UI/UX polish + CI/CD restructure ([ea75d68](https://github.com/asepharyana/mcpedia/commit/ea75d68b1ac7b627e16e222aa9ae80126aef05f5))
* pipe 'yes' to db:push in deploy for non-interactive confirmation ([233e88e](https://github.com/asepharyana/mcpedia/commit/233e88e91198f480cf7283c65d47e60b4bbc4aa7))
* preserve value types in extraFields (no string coercion) ([ceb53ad](https://github.com/asepharyana/mcpedia/commit/ceb53adba427d8d220b9b6b609b23ed508869551))
* **print:** prevent code block header/body page break split and ensure atomic code block flow ([d65c561](https://github.com/asepharyana/mcpedia/commit/d65c5613d37c2dae97566791fef4f246cff0779e))
* remove body field badge, improve sidebar tree styling, use doc titles in homepage tree ([989ee9c](https://github.com/asepharyana/mcpedia/commit/989ee9c4646d6efddadfc97657a2ad722589fe71))
* remove db:push from deploy (column manually applied; push is non-interactive-unfriendly) ([c611601](https://github.com/asepharyana/mcpedia/commit/c611601525fe8bfe85385369afd7050c691c1868))
* remove duplicate tag display from section cards ([d35dd8c](https://github.com/asepharyana/mcpedia/commit/d35dd8c8877ab181e6ec555c049d3440275832ae))
* remove prose-lg class (typography plugin not installed) causing 500 on doc pages ([a82af10](https://github.com/asepharyana/mcpedia/commit/a82af108517518130ad221fb934db9ceb5b3b205))
* remove the hardcoded fallback HMAC key and the length oracle ([804e9e3](https://github.com/asepharyana/mcpedia/commit/804e9e3cdb7d69999392070af9c5b0f898447f20))
* replace all hardcoded hex colors with CSS theme variables ([be923cb](https://github.com/asepharyana/mcpedia/commit/be923cb432ec0c619162b62d432d178c54a64581)), closes [#5e6ad2](https://github.com/asepharyana/mcpedia/issues/5e6ad2) [#7170ff](https://github.com/asepharyana/mcpedia/issues/7170ff) [#4f46e5](https://github.com/asepharyana/mcpedia/issues/4f46e5) [#6a75e0](https://github.com/asepharyana/mcpedia/issues/6a75e0) [#828fff](https://github.com/asepharyana/mcpedia/issues/828fff) [#94a3b8](https://github.com/asepharyana/mcpedia/issues/94a3b8) [#5e6ad2](https://github.com/asepharyana/mcpedia/issues/5e6ad2) [#5e6ad2](https://github.com/asepharyana/mcpedia/issues/5e6ad2) [#5e6ad2](https://github.com/asepharyana/mcpedia/issues/5e6ad2) [#7170ff](https://github.com/asepharyana/mcpedia/issues/7170ff) [#4f46e5](https://github.com/asepharyana/mcpedia/issues/4f46e5) [#7170ff](https://github.com/asepharyana/mcpedia/issues/7170ff) [#4f46e5](https://github.com/asepharyana/mcpedia/issues/4f46e5) [#6a75e0](https://github.com/asepharyana/mcpedia/issues/6a75e0) [#6a75e0](https://github.com/asepharyana/mcpedia/issues/6a75e0) [#828fff](https://github.com/asepharyana/mcpedia/issues/828fff) [#868686](https://github.com/asepharyana/mcpedia/issues/868686) [#6a75e0](https://github.com/asepharyana/mcpedia/issues/6a75e0)
* run the pinned TypeScript in moon tasks, and load the toolchains file ([1ef56e2](https://github.com/asepharyana/mcpedia/commit/1ef56e2c56a26c3e10ebef3ac20f93c2f1565a1c))
* snapshotRevision was not using the predicate its tests cover ([183d28f](https://github.com/asepharyana/mcpedia/commit/183d28ffa1ed8fcc8b626f16a7381a8ad9ca1798))
* strip leading whitespace before shebang in mcpedia-web wrapper script ([2a70a11](https://github.com/asepharyana/mcpedia/commit/2a70a111a23b7c88405443491a0becb8012b2d6f))
* the migration guard never fired, and its remedy was a fictional flag ([177e015](https://github.com/asepharyana/mcpedia/commit/177e01576b8f458c6850b1d29b9839e2c2fd1ba4)), closes [drizzle-team/drizzle-orm#1604](https://github.com/drizzle-team/drizzle-orm/issues/1604)
* **theme:** support full dynamic Light Mode and Dark Mode with CSS variables and storage sync ([aedfb02](https://github.com/asepharyana/mcpedia/commit/aedfb022f39e7031d0bd40696507ee0e0e8ea9e3))
* update MCP smoke test to include 4 new tools (create/delete/list_sections/update) ([d8da598](https://github.com/asepharyana/mcpedia/commit/d8da598f1d3ba8ba6ba23747a53f0363f01935d4))
* use db:push instead of db:migrate in deploy (schema was initially pushed, not migrated) ([144e124](https://github.com/asepharyana/mcpedia/commit/144e124bcb6bf33be465c26bfd5cae08671e8ece))
* use explicit path for indexer in deploy to avoid bun run resolving to wrong package.json ([040d6cb](https://github.com/asepharyana/mcpedia/commit/040d6cb4ff8fc08860b575f1bdc3e78358d97eca))
* **web-ui:** add @tailwindcss/typography plugin to fix table rendering in docs ([3938aeb](https://github.com/asepharyana/mcpedia/commit/3938aeb38d283adf6a5b444194132765c5cc18e1))
* **web-ui:** remove client-side onKeyDown from server component to fix 500 on /docs ([44b887a](https://github.com/asepharyana/mcpedia/commit/44b887a9a007eb62b03b64d7a44154370fe0f4fd))
* **web:** /api/docs accepts web cookie OR x-webhook-secret (not both required) ([98437cb](https://github.com/asepharyana/mcpedia/commit/98437cb999b1ca96d522aef568fc700e548fc5e4))
* **web:** fix doubled section prefix in doc links (404 on click) ([2d974b8](https://github.com/asepharyana/mcpedia/commit/2d974b89526a6d2fe19c9a391fc9d032c9dfb02d))
* **web:** fix working directory in mcpedia-web wrapper script ([666ba85](https://github.com/asepharyana/mcpedia/commit/666ba855a26141ff3996b210d04f444ef4eec41b))
* **web:** remove stray create-next-app layout.tsx (LayoutProps<'/'> removed in Next 16) ([c769766](https://github.com/asepharyana/mcpedia/commit/c7697666fe7b109477a22bc9532f73b03fb831ac))
* **web:** render content pages dynamically so next build needs no DB ([8790a4f](https://github.com/asepharyana/mcpedia/commit/8790a4f65a4a6771642fd3b22d69fae3c989b7df))
* **web:** Sidebar as client component (no DB during SSG) ([050ca51](https://github.com/asepharyana/mcpedia/commit/050ca518c058c5d79b64b0efde8ea6c2e064c259))
* **web:** split PUT/DELETE into /api/docs/[...slug]/route.ts ([8ed8c67](https://github.com/asepharyana/mcpedia/commit/8ed8c677e80370acab8e5b9f044fdbb3ae0fc4cd))
* **web:** stop describing a search stack that no longer exists ([8e9f8dc](https://github.com/asepharyana/mcpedia/commit/8e9f8dc8ec8e321f88d3b8bcf1a06c4f3c3a3175))


### Features

* add dependabot auto-merge workflow ([9d8d876](https://github.com/asepharyana/mcpedia/commit/9d8d876ba7a17ce792b2296b5d97450be857087d))
* add dependabot config (npm auto-deps) ([03616b4](https://github.com/asepharyana/mcpedia/commit/03616b4e601a7e9daac9631065e3a6b32a85d0e7))
* add Word (.docx) export, enhance print density, and fix auth security guards ([5ccba95](https://github.com/asepharyana/mcpedia/commit/5ccba958d22e2c681983eef3209b98d986c84e21))
* **api:** gate writes by session role and distinguish 401 from 403 ([675aaf5](https://github.com/asepharyana/mcpedia/commit/675aaf536498a17671fdb6741074afa1ef46fa33))
* **audit:** record every write with the actor that made it ([7d13e0f](https://github.com/asepharyana/mcpedia/commit/7d13e0f98084f7d028a4745ce08390fcc4bff02c))
* complete search REST route, restore disk sync, and extraFields support across API/MCP ([a67a8c6](https://github.com/asepharyana/mcpedia/commit/a67a8c6469d364c634bf7974b8582aadc4df5670))
* **config:** validate environment at startup with zod ([ad8e982](https://github.com/asepharyana/mcpedia/commit/ad8e982525a550d2f2c43f1a578047c8aff2dbcd))
* **config:** validate the hindsight settings at startup ([d61046e](https://github.com/asepharyana/mcpedia/commit/d61046e46d92fe110c6485f98572a0898f6913b4))
* **core:** add reflect and consolidate ([1512b81](https://github.com/asepharyana/mcpedia/commit/1512b81caa96fdf5e80c0f806714aba490683fb0))
* **core:** back search and indexing with hindsight ([236fa48](https://github.com/asepharyana/mcpedia/commit/236fa48a5cfca2ab706550fbeed49d61ee256e9b))
* **core:** dynamic custom frontmatter fields for CTF writeup metadata ([c760c3c](https://github.com/asepharyana/mcpedia/commit/c760c3c087ad9314482076bef842cb5485699787))
* **core:** propagate typed errors through the remaining layers ([8f2cddb](https://github.com/asepharyana/mcpedia/commit/8f2cddbfcb0d590d3c2fd3d3164127cc7c5f991f))
* **db:** run migrations from a standalone entrypoint ([bbd47bb](https://github.com/asepharyana/mcpedia/commit/bbd47bb1a057c4f9c1d7e7bcaabcde0f7548f10a))
* dynamic custom frontmatter fields + CTF writeup template system ([7fb5559](https://github.com/asepharyana/mcpedia/commit/7fb55590bd0e5e026b6c7c8d742a4eb2ee88cae1))
* enhance Markdown component with syntax highlighting and improve code snippet display ([d62c5d3](https://github.com/asepharyana/mcpedia/commit/d62c5d33a449642f85e0c6c785838850d5e27a34))
* **export:** add single PDF export for sections and events with chapter ordering ([5cd9ea9](https://github.com/asepharyana/mcpedia/commit/5cd9ea92a7da2f0161ddf0e257bf8d7a1247be56))
* **export:** enhance export routing to support /[section]/export, /[section]/[slug]/export, and dynamic route rendering ([864911a](https://github.com/asepharyana/mcpedia/commit/864911af20df1b2285eba7420ee8d7324df5fcce))
* **export:** redesign PDF view for formal publication styling without colors or watermarks ([5d85226](https://github.com/asepharyana/mcpedia/commit/5d85226ff0f8a6be4f33bc31bfa7c7f339815bba))
* **export:** remove author, scope, and slug metadata for cleaner minimal writeup look ([9591c67](https://github.com/asepharyana/mcpedia/commit/9591c67478fdce5612aebdbbe1b0979f7c8bd150))
* **export:** remove cover header banner and confidential footer line from PDF view ([72b53af](https://github.com/asepharyana/mcpedia/commit/72b53afe069efa950911d1a63708a464a418872d))
* **export:** simplify writeup export to pure human-like markdown layout without cards and exclude _index documents ([4f0d2da](https://github.com/asepharyana/mcpedia/commit/4f0d2da8768ad005d4db492d22b769aef70ee2e5))
* fully dynamic custom field badges (auto-style by value, not key name) ([edbd812](https://github.com/asepharyana/mcpedia/commit/edbd812c3019dc6cc25d21a4625192d90f0e802a))
* introduce better-auth as the first user model ([99fee78](https://github.com/asepharyana/mcpedia/commit/99fee78da6967012a0917fb68fce243a47c886cc))
* **mcp-client:** MCP client CLI for interacting with MCPedia server ([ec0abfb](https://github.com/asepharyana/mcpedia/commit/ec0abfbd60338ead2b90986453e0ee5280f5733d))
* **mcpedia:** Phase 1 MVP — monorepo, Core, Web UI, MCP server, Postgres FTS ([ec3a286](https://github.com/asepharyana/mcpedia/commit/ec3a2867d4e728b39f62bae4c7a18732e21b8b7e))
* **mcpedia:** Phase 2 — semantic + hybrid search, tRPC/Hono API ([9397303](https://github.com/asepharyana/mcpedia/commit/9397303f0143c94a11327447145380459ff7876d))
* **mcpedia:** Phase 3 — async indexing (BullMQ), git-sync webhook, revisions, MCP Resources ([8f2229d](https://github.com/asepharyana/mcpedia/commit/8f2229d4475913a3eb73fd71ec90df71eff92f1d))
* **mcpedia:** Phase 4 — operability + correctness hardening ([b92f6f9](https://github.com/asepharyana/mcpedia/commit/b92f6f91fab67721e75e5176ddb3b843793f7d82))
* **mcp:** expose reflect as a tool ([cbf32b1](https://github.com/asepharyana/mcpedia/commit/cbf32b1993de0c6cedd70aef1942982fa29bee06))
* **mcp:** Streamable HTTP transport + deploy; secure restoreRevision ([b621923](https://github.com/asepharyana/mcpedia/commit/b621923868bfe8883a257c216b9f37aa8c3b2aca))
* Phase 11 — CRUD (create/update/delete) + auth + web UI ([57f9001](https://github.com/asepharyana/mcpedia/commit/57f90018dae24d8ede06d793a3fc2624ca522774))
* Phase 14 — hierarchical folder structure (GitHub-style nested folders) ([cc99bd2](https://github.com/asepharyana/mcpedia/commit/cc99bd2b741aac2a28e136334ceca66766a21209))
* Phase 14 — hierarchical folder structure (GitHub-style nested folders) ([ab3a2dc](https://github.com/asepharyana/mcpedia/commit/ab3a2dc456c70e11982428718f37df4f874f65c9))
* **phase7:** grow corpus, MCP write-tools+auth, /metrics observability ([53d636a](https://github.com/asepharyana/mcpedia/commit/53d636af0eceb646b8f1617430947cef9589123b))
* **phase8:** observability dashboard at /dashboard ([0cdf261](https://github.com/asepharyana/mcpedia/commit/0cdf261d40f0a3a427a8eeb01e704bc61fc8213b))
* port the web app to a Vite SPA and restructure core into hexagonal layers ([aec60b3](https://github.com/asepharyana/mcpedia/commit/aec60b31310e2a053c337cb9543c7d6cf00896e1))
* replace tRPC with oRPC and mount the RPC surface at /rpc and /trpc ([38acaf9](https://github.com/asepharyana/mcpedia/commit/38acaf99e779f05fa850dbc1dd9b5ffe7291542e))
* revamp to dynamic database-first architecture and cleanup phase docs ([a9b6738](https://github.com/asepharyana/mcpedia/commit/a9b67385c3b7bd56111fb2ab76b345a68e01032e))
* **ui:** overhaul UI/UX with CommandMenu, modern Linear design, interactive TOC, and live preview ([62116be](https://github.com/asepharyana/mcpedia/commit/62116be88dbc710628e525c6dc9f378aad8b6025))
* update dependabot config ([8f98bed](https://github.com/asepharyana/mcpedia/commit/8f98bed7ddd06853c556e5a6abe0d1bd2e657063))
* update dependabot config ([bd3a089](https://github.com/asepharyana/mcpedia/commit/bd3a0894b408fb720d53425f5540da9bf4b31573))
* **web-ui:** overhaul docs index, doc page, and sidebar with card-based layout ([4bbdbb9](https://github.com/asepharyana/mcpedia/commit/4bbdbb9647ea6e21f3647e6237d1c332f1f30c16))
* **web-ui:** overhaul homepage with hero section, section overview cards, recent docs strip, and MCP info ([d9e09dc](https://github.com/asepharyana/mcpedia/commit/d9e09dceeaea62803c81ca7e40837aa74a54eb8a))
* **web-ui:** widen main content container for better card grid layout ([be9211e](https://github.com/asepharyana/mcpedia/commit/be9211ef219a0b733357e58882694cb2467376ef))
* **web:** FE overhaul — SWR centralized data layer + dashboard + islands ([4330f47](https://github.com/asepharyana/mcpedia/commit/4330f47c6521b2a77cbe78cdf2bb78cf77980173))
* **web:** full layout overhaul — Linear design system ([167d95c](https://github.com/asepharyana/mcpedia/commit/167d95c5e8d40285ea2c12ee8be70518933726b4)), closes [#08090a](https://github.com/asepharyana/mcpedia/issues/08090a) [#f7f8f8](https://github.com/asepharyana/mcpedia/issues/f7f8f8) [#d0d6e0](https://github.com/asepharyana/mcpedia/issues/d0d6e0) [#7170ff](https://github.com/asepharyana/mcpedia/issues/7170ff) [#828fff](https://github.com/asepharyana/mcpedia/issues/828fff) [#191a1b](https://github.com/asepharyana/mcpedia/issues/191a1b) [#23252a](https://github.com/asepharyana/mcpedia/issues/23252a)
* **web:** move the SPA off SWR and onto tanstack query ([29d3d90](https://github.com/asepharyana/mcpedia/commit/29d3d90d8a2a05d307f80db77535182f20513037))
* **web:** overhaul frontend with cyber-intelligence design and interactive topology ([011571e](https://github.com/asepharyana/mcpedia/commit/011571e12db66a5e917b45699fa29c2299d7c2ce))
* **web:** Phase 11 UI/UX — TOC, dark mode toggle, /docs index ([1dd16eb](https://github.com/asepharyana/mcpedia/commit/1dd16ebcba202828d51fe331c933fb1483525bb3))


### Reverts

* **config:** redis default kembali ke imrnes 100.121.180.82 (outage usai) ([a0da49e](https://github.com/asepharyana/mcpedia/commit/a0da49e2f8f64a949f4116ee8ab8568a71b01886))

# Changelog

All notable changes to mcpedia are documented here.
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
and are derived automatically from
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).
