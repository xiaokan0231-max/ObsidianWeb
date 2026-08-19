# ObsidianWeb

**A local-first knowledge workbench with no database — an Obsidian vault is the single source of truth.**

A directory of Markdown notes (frontmatter, wikilinks, headings) *is* the domain model.
From it the app builds a case board, calendar, timeline, a 3D knowledge graph and a
study loop in real time. Next.js (vinext) / React 19 / TypeScript, deployed to Cloudflare Workers.

![ObsidianWeb](public/og.png)

- 🇯🇵 [日本語](README.md) ・ 🇨🇳 [中文](README.zh.md)

---

## What makes the design interesting

### 1. Deciding not to have a database

`db/schema.ts` is **empty on purpose**. The persistence layer is the Obsidian vault itself —
plain Markdown files.

```
Obsidian (Local REST API) ──► app/api/vault ──► readAllNotes() ──► views
        ▲                          │
        └──── writes touch only whitelisted frontmatter fields ────┘
```

- No copy of the data means **divergent truths cannot structurally occur**. Edit in Obsidian
  or edit in the browser — there is still exactly one fact.
- The API key lives only in the server process; it never reaches browser code or the repo
  (`app/api/vault/route.ts`).
- All writes funnel through one path, constrained by a whitelist of path, note type and
  allowed values. Only the matching frontmatter lines are replaced — the body is never touched.
  Since read-modify-write is not atomic, writes run inside a short serialized section so
  rapid clicks cannot silently drop one (`app/api/jobs/status/route.ts`, `lib/server/serial-queue.ts`).

### 2. "Generated blocks": one source of truth for derived values

Aggregates, ratios and trends are **mechanically forbidden from being hand-written**.

```markdown
<!-- generated:stats do-not-edit -->
(only scripts may write in here)
<!-- /generated -->
```

Once a derived number is dissolved into prose it is cut off from its source: the source
changes, the prose does not, and nothing errors. That accident actually happened here,
so **facts (written by humans) and derivations (computed by machines)** are separated as
a type-level distinction, enforced by `npm run vault:check` (frontmatter validation) and
`npm run vault:stats` (regeneration).

### 3. Validation in three layers instead of CI

The vault is external data that may not exist on another machine, so binding it to the
code tests would make CI fail for no reason — and red lights nobody trusts get ignored.
Hence three layers:

| Layer | Fires | Behaviour |
|---|---|---|
| Agent stop hook | Every time the AI finishes a turn | **exit 2 blocks the turn**, reason fed back to the AI |
| `npm run dev` startup | When you want to look at the page | Warning only, never blocks |
| Vault repo pre-commit | On `git commit` | **Rejects the commit** on inconsistency |

### 4. Incremental cache, built for a runtime without `fs`

Re-reading the whole vault is slow — but the server runs on workerd, where `nodejs_compat`
is a virtual filesystem, so `fs` mtimes are unavailable.

Instead the cache issues **one `POST /search/` with the JsonLogic expression
`{"var":"stat.mtime"}` and gets mtimes for the entire vault in a single request** (12ms measured).
Every subsequent read is "one scan + refetch only what changed" (`lib/server/vault-cache.ts`).

Read-after-write consistency, write serialization and metadata-cache lag are pinned down
by tests derived from actual measurements, not assumptions.

### 5. 3D views and hand-gesture control

three.js renders semantic relationships between notes as a 2.5D "memory atlas", and activity
over time as a 3D timeline. In fullscreen the camera can be driven by hand tracking via
MediaPipe Tasks Vision — the wasm and model files are **self-hosted**
(`scripts/fetch-mediapipe.mjs` fetches them).

### 6. Local LLM bridge

Generation goes through a local bridge bound to `127.0.0.1` only (`scripts/codex-bridge.mjs`).

- A single-use token is minted per run; the web app and the bridge are bound to the same token
- The login method is verified — API-key auth is **refused**
- `OPENAI_API_KEY` / `CODEX_API_KEY` are stripped from the child process environment
- On port collision a free port is picked automatically, eliminating "old bridge alive,
  new page gets 503"

---

## Views

| View | Contents |
|---|---|
| Overview | What matters most right now, plus work in flight |
| Case board | Full-text search with hit highlighting, multi-axis filters, side-by-side compare (up to 3) |
| TODO / Calendar | Picks up both frontmatter due dates and schedules mentioned in note bodies |
| Interview review | Joins transcripts with annotations and scores answer quality on five dimensions |
| Japanese training | Practice / drill / exam loop across eight categories (vocabulary, readings, grammar, …) |
| Timeline | 3D timeline visualizing daily activity as light columns |
| Memory atlas | 2.5D knowledge graph of semantic relationships |

---

## Running it

With Obsidian and the **Local REST API** plugin running:

```bash
npm install
npm run dev
```

Serves `http://localhost:3000`. The start script reads the API key from the Obsidian plugin
config and passes it to the server process only.

| Env var | Purpose |
|---|---|
| `OBSIDIAN_VAULT_PATH` | Vault location |
| `OBSIDIAN_CONFIG_PATH` / `OBSIDIAN_API_URL` | Override defaults |
| `CODEX_BRIDGE_PORT` | Bridge port (default `43127`) |

---

## Quality gates

```bash
npm test       # tsc --noEmit → build → node --test (298 tests)
npm run lint   # eslint --max-warnings 0
```

`npm test` includes type checking and a production build. Tests concentrate on the data layer
extracted as pure functions (`lib/*.ts`, `lib/*.mjs`), covering parsers, normalization,
race conditions and rendered output.

Every shape that actually broke in production — company-name variance across full-width and
half-width characters, the position of the legal-entity suffix, parenthesized aliases — is
pinned by a test.

---

## Stack

| Area | Choice |
|---|---|
| Framework | Next.js 16 / vinext / React 19 (RSC) |
| Language | TypeScript 5.9 (`strict`) |
| Runtime | Cloudflare Workers (wrangler / vite) |
| 3D & input | three.js / MediaPipe Tasks Vision |
| Styling | Tailwind CSS 4 + per-view CSS |
| Tests | `node:test` (no external runner) |
| Data | Obsidian Local REST API (**no database**) |

## Layout

```
app/         Routes, API routes, views (React)
lib/         Data layer — zero-import pure functions wherever possible, for testability
lib/server/  Server-only: Obsidian access, cache, writes, bridge
scripts/     Vault validation/regeneration, dev server, bridge
tests/       node:test — 298 cases
```

## License

Personal project. No license granted (all rights reserved).
