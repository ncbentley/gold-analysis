<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

- Install with `pnpm install --frozen-lockfile` (pnpm 10.33.3, Node 22). No Docker, Postgres, or API keys are required; the app uses embedded PGlite in `.data/pglite`.
- `pnpm dev` seeds plans and the admin account when the database is empty, then serves Next.js at http://localhost:4317 on `0.0.0.0`. Sign in at `/login` as `admin@example.com` / `admin12345`.
- `pnpm typecheck` needs Next.js generated route types (`PageProps`, `LayoutProps`, `RouteContext`). Run `pnpm dev` or `pnpm build` once so `.next` types exist before `tsc`.
- PGlite is single-process. Stop the dev server before `pnpm db:setup` or `pnpm db:reset` against the same data directory.
