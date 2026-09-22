# ObsidianWeb

**A local-first knowledge workbench with no database — an Obsidian vault is the single source of truth.**

A directory of Markdown notes (frontmatter, wikilinks, headings) *is* the domain model.
From it the app builds a case board, calendar, interview prep, timeline, a 3D knowledge graph and a
study loop in real time. Next.js (vinext) / React 19 / TypeScript, deployed to Cloudflare Workers.

![ObsidianWeb](public/og.png)

- 🇯🇵 [日本語](README.md) ・ 🇨🇳 [中文](README.zh.md)

---

## What makes the design interesting

### 1. Deciding not to have a database

`db/schema.ts` is **empty on purpose**. The persistence layer is the Obsidian vault itself —
plain Markdown files.

```
Obsidian (Local REST API) ──► app/api/vault?scope=… ──► readAllNotes() ──► views
        ▲                          │
        └── writes: state = frontmatter scalar lines / reviews & practice = append-only notes ──┘
```

- No copy of the data means **divergent truths cannot structurally occur**. Edit in Obsidian
  or edit in the browser — there is still exactly one fact.
- The API key lives only in the server process; it never reaches browser code or the repo
  (`lib/server/obsidian.ts`).
- There are only two write primitives. **State** (case status / channel / follow-up, TODO status)
  goes through `lib/server/frontmatter-patch.ts`, which replaces only the scalar lines each route
  permits and never touches the body. **Records** (review annotations, feedback, practice) go
  through `lib/server/note-append.ts` into append-only notes. Since read-modify-write is not
  atomic, each route serializes writes per note path (`createKeyedSerialQueue`); different notes
  and different routes never wait on each other.
- Optimistic locking: a case that has `status_updated` sends it, a TODO sends the on-disk `mtime`,
  as the version; a mismatch returns 409 and the UI reloads. After a case-status write, derived
  statistics are flagged `derivedState: stale` rather than pretending to be current until
  `vault:stats` runs again.
- The application channel is a **historical fact** and cannot be overwritten by a status change.
  An unrated case shows "—", not 0.

### 2. "Generated blocks": one source of truth for derived values

Aggregates, ratios and trends are **mechanically forbidden from being hand-written**.

```markdown
<!-- generated:<id> do-not-edit -->
(only scripts may write in here)
<!-- /generated -->
```

Once a derived number is dissolved into prose it is cut off from its source: the source
changes, the prose does not, and nothing errors. That accident actually happened here,
so **facts (written by humans) and derivations (computed by machines)** are separated as
a type-level distinction, enforced by `npm run vault:check` (frontmatter validation) and
`npm run vault:stats` (regeneration).

The same idea applies to evaluation data. A company's six-axis fit assessment is drawn only from
structured YAML in frontmatter; an axis with no evidence stays `null` and is **left blank**, and no
total score is synthesized (`lib/company-overview.ts`). Schema and criteria versions are tracked
separately, so radars from an older rubric are never placed side by side with the new one.

### 3. Validation in three layers instead of CI

The vault is external data that may not exist on another machine, so binding it to the
code tests would make CI fail for no reason — and red lights nobody trusts get ignored.
Hence three layers:

| Layer | Fires | Behaviour |
|---|---|---|
| Agent stop hook | Every time the AI finishes a turn | **exit 2 blocks the turn**, reason fed back to the AI |
| `npm run dev` startup | When you want to look at the page | Warning only, never blocks |
| Vault repo pre-commit | On `git commit` | **Rejects the commit** on inconsistency |

`vault:check` validates more than enums: the chapter structure of each prep-doc version
(`prep_version`), the `case` / `meeting` either-or, and the nested YAML of company profiles and
fit reports.

### 4. Incremental cache, built for a runtime without `fs`

Re-reading the whole vault is slow — but the server runs on workerd, where `nodejs_compat`
is a virtual filesystem, so `fs` mtimes are unavailable.

Instead the cache issues **one `POST /search/` with the JsonLogic expression
`{"var":"stat.mtime"}` and gets mtimes for the entire vault in a single request** (12ms measured).
Every subsequent read is "one scan + refetch only what changed" (`lib/server/vault-cache.ts`).
Views request only the note types they need via `/api/vault?scope=` (`lib/vault-scope.ts`).

Read-after-write consistency and metadata-cache lag are pinned down by tests derived from
actual measurements; the lost-update from rapid clicks on the board is prevented by the
per-route serial queue.

### 5. Prep-doc versions coexist inside the vault

Interview prep docs for one case mix the old 12-section layout (v1) with the new 5-chapter one
(v2). Historical docs are never rewritten; the web app **switches layout per selected doc**.
Research material accumulates only "up to that doc's point in time", so URLs from a later round
never leak back into an earlier one (`lib/interview-prep-index.ts`). A meeting with no job case
can form its own series via `meeting: [[meeting TODO]]`.

Append-only notes are read the same way. The answer-practice queue only appends
`attempt / complete / snooze` events; `queued / active / completed / snoozed` is **derived by
folding** them (`lib/review-practice.ts`). Speaker decisions take only the latest explicit ruling,
and an uncertain note like "can't remember" sends the sentence back to unresolved.

### 6. 3D stage: interaction dynamics extracted into zero-dependency pure functions

three.js renders semantic relationships as a four-armed galaxy ("memory atlas") and activity over
time as a 3D timeline. UnrealBloom with a soft-knee highlight pass, a three-layer starfield, an
"energy probe" pointer and a particle momentum field.

- Probe position and tilt are critically damped, energy is exponential attack/release — all
  **closed-form** (`lib/stage-interaction.mjs`); particle coasting is the **closed-form** momentum field
  (`lib/stage-motion.mjs`). Frame-rate independent, and the GLSL and CPU formulas are
  **compared verbatim by tests**
- Mouse and hand tracking share one state machine; the input source is locked while pressing or dragging
- Hand tracking (MediaPipe Tasks Vision, wasm and model **self-hosted**): the pinch threshold is
  resolved as per-hand **adaptive envelope** (aspect-corrected) > stored calibration > default,
  with a 24ms floor for a tap. Pinch-drag and fist-drag reuse OrbitControls' own rotation math;
  two hands pan, zoom and rotate. Instant fist takeover and displacement-based grab live on the
  recognition side
- Defaults are the 2D "relation map" (one-hop neighbourhood) and the "chronicle list"
  (month index, daily density); 3D is an "exploration mode" the app remembers

### 7. Local LLM bridge

Generation goes through a local bridge bound to `127.0.0.1` only (`scripts/codex-bridge.mjs`,
launched by `scripts/dev-with-obsidian.sh`).

- The start script mints a throwaway token per run; the web app and the bridge are bound to the same token
- The login method is verified — API-key auth is **refused**
- `OPENAI_API_KEY` / `CODEX_API_KEY` are stripped from the child process environment
- The start script picks a free port on collision, eliminating "old bridge alive,
  new page gets 503"

---

## Views

Top-level navigation: Overview / Actions / Job search / Interview / Training / Library.
⌘K opens page commands and full-text search.

| View | Contents |
|---|---|
| Overview | "Current action" card (write a TODO's status back as in-progress / done / on hold in place) plus actions, cases in flight, unapplied postings, the next 7 days, awaiting replies, reviews and today's practice |
| Actions / Calendar | Interviews, action deadlines and awaiting-reply dates on one calendar as colour-coded "commitments". An interview event jumps straight to that round's prep doc (future) or review (past); if company, date, round and time do not all match, it shows an empty state instead of guessing |
| Case board | The "decision desk" (queue + detail) is the default. Full-text search, multi-axis filters, side-by-side compare (up to 3). Save the channel together with a status change; write back follow-ups (waiting for / follow-up date / next event) |
| Pipeline analytics | Four glance cards — in progress, interview stage, awaiting result, ready to apply — plus hand analysis |
| Session | Prep docs per case or meeting. v2 has five tabs — company overview / session overview / motivation / reverse questions / material — plus on-the-spot backups. Six-axis fit radar (axes without evidence stay blank) and side-by-side comparison of up to 3 companies. v1 docs get a "briefing" mode to read through before the interview |
| Playbook | Answer library, readable in the full-text reading layer. Shared assets open as an overlay from the session's material links |
| Interview review | A whole-session "overview" → transcript joined with annotations → five-dimension scores. Novel-style full-text reading (Chinese / Japanese, speaker decisions applied) |
| Answer practice | Improved answers queued from reviews, spoken aloud before reveal. Self-ratings (smooth / stuck / unknown) and done / snooze are recorded append-only |
| Japanese training | Focused drills built from interview evidence: six kinds (key verb chunks, error fixes, interviewer phrasing, answer structure, job-specific tech, factual wording) run through three phases — quick scan → focused fix → stress test. Ability profile, problem map and corpus tabs |
| Focused training | Five drill styles: Chinese→Japanese chunks, collocation completion, pattern substitution, improvised expression, safe rephrasing |
| Library | Trust-layer badges and summary cards, cross filters by area and scene, scope/sort kept in the URL |
| Reading mode | From a note's detail into a book-style full-screen reader: five font sizes, table of contents, document info, backlinks, reading position restored. Inside the memory atlas / timeline it opens as a dark layer within the stage without leaving the scene |
| Relation map / Memory atlas | Default is a 2D map of the one-hop neighbourhood around a company, skill or note. 3D is the four-armed galaxy with the shared mouse/hand energy probe |
| Chronicle / Timeline | Default is a chronicle with month index, daily density and type filters. 3D lands on today and lists that day's notes and events in a side panel |

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
npm test       # tsc --noEmit → build → node --test (440 tests)
npm run lint   # eslint --max-warnings 0
```

`npm test` includes type checking and a production build. Tests concentrate on the data layer
extracted as pure functions (`lib/*.ts`, `lib/*.mjs`), covering parsers, normalization,
race conditions, rendered output, GLSL/CPU formula parity and hand-gesture frame sequences.

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
| 3D & input | three.js (EffectComposer / UnrealBloomPass) / MediaPipe Tasks Vision |
| Styling | Tailwind CSS 4 + design tokens (`base.css`) + cross-cutting primitives (`ux-refresh.css`) + per-view density CSS |
| Tests | `node:test` (no external runner) |
| Data | Obsidian Local REST API (**no database**) |

## Layout

```
app/         Routes, API routes, views (React)
lib/         Data layer — zero-import pure functions wherever possible, for testability
lib/server/  Server-only: Obsidian access, cache, frontmatter patch, serial queue, bridge
scripts/     Vault validation/regeneration, dev server, bridge, MediaPipe fetch
tests/       node:test — 440 cases
```

## License

Personal project. No license granted (all rights reserved).
