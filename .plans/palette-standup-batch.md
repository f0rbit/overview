# Command Palette + Standup + AI + Batch Ops

Multi-phase plan for adding a `:`-triggered command palette, standup commands (daily/weekly), an AI provider abstraction (Anthropic + Bedrock), and palette-only batch git operations to `@f0rbit/overview`.

---

## Executive Summary

Four phases, strictly sequential at the phase boundary. Inside each phase, several tasks parallelise via worktrees because they touch independent files.

- **Phase A — Palette infrastructure.** Build the command system (`Command`, registry, parser, fuzzy matcher, `CommandContext`) and the `:`-triggered overlay UI. Land with three trivial built-ins (`:quit`, `:help`, `:reload`). Nothing else depends on this not being there yet.
- **Phase B — Standup view.** Plugin-based `ActivitySource` registry in `core` (built-in `git` source ships in this phase; devpad/SIM/etc. as future plugins), date-math `StandupRange`, an overlay screen that renders summary + raw + (later) AI sections — section rendering is source-agnostic. `:standup daily` and `:standup weekly` register on top of Phase A.
- **Phase C — AI provider abstraction.** Provider interface returning `Promise<Result<SummaryStream, ProviderError>>`. Three concretes: Anthropic, Bedrock, in-memory. Lazy-load production providers (decision below). Wire into the standup view as the optional AI summary section.
- **Phase D — Batch git ops.** `:fetch all`, `:pull all`, `:push all` with `--filter` and `--dry-run`. Pure planner + executor split. Live progress overlay reusing `createPool(n)`. **No keybindings — palette-only**, per the brief.

The architectural seam is the `CommandContext`: commands receive everything they need as parameters, so they're trivially fakeable in tests. The palette state machine is testable without rendering. The AI provider interface is the only network surface and is fully fakeable. The batch planner is pure; only the executor touches subprocesses.

---

## Architecture Overview

### Three seams

```
                    ┌──────────────────────────────────┐
                    │   Palette UI (overlay)           │
                    │   - reads input                  │
                    │   - matches commands via fuzzy   │
                    │   - calls cmd.execute(args, ctx) │
                    └────────────────┬─────────────────┘
                                     │
                  ┌──────────────────▼──────────────────┐
                  │ CommandContext (the seam)           │
                  │  - config (read-only)               │
                  │  - repos accessor                   │
                  │  - selected_repo accessor           │
                  │  - ai_provider | null               │
                  │  - emit(event)  // status, errors   │
                  │  - open_overlay(id, payload)        │
                  │  - renderer suspend/resume hooks    │
                  └──┬─────────────────────┬────────────┘
                     │                     │
       ┌─────────────▼─────┐      ┌────────▼───────────┐
       │ Command registry  │      │ AI Provider iface  │
       │ side-effect imports│     │ summarize() →      │
       │ Command<Args>     │      │ Promise<Result<...>>│
       └─────────────┬─────┘      └────────┬───────────┘
                     │                     │
            ┌────────▼──────┐     ┌────────▼────────┐
            │ Built-ins      │     │ Anthropic       │
            │ Standup        │     │ Bedrock         │
            │ Batch (fetch/  │     │ InMemory (test) │
            │ pull/push)     │     │                 │
            └────────────────┘     └─────────────────┘
```

Three independent seams that compose:

1. **`CommandContext`** — what commands are allowed to know. Anything else is global and forbidden. This is what makes the system testable.
2. **`Command<Args>`** — the unit of behaviour. Has `execute(args, ctx) → Promise<Result<void, E>>`. Never throws.
3. **`AIProvider`** — the only outbound network surface. Production implementations are loaded behind a dynamic `import()` so the bundle stays lean when AI isn't configured.

### Files added (rough map)

```
packages/core/src/
├── activity/
│   ├── types.ts                # ActivitySection, ActivityItem, ActivitySource, RepoActivity, StandupRange (Phase B.1a)
│   ├── registry.ts             # register_activity_source(), get/list (Phase B.1a)
│   ├── sources/
│   │   └── git.ts              # built-in git ActivitySource (Phase B.1b)
│   └── index.ts                # barrel + side-effect imports of built-in sources

packages/render/src/
├── lib/
│   ├── palette/
│   │   ├── types.ts            # Command, CommandContext, ParseError, MatchResult
│   │   ├── registry.ts         # register_command(), get_command(), list_commands()
│   │   ├── parser.ts           # parse_input(): pure, Result<{id, args}, ParseError>
│   │   ├── fuzzy.ts            # match(): pure, scored matches
│   │   ├── context.ts          # createCommandContext(deps) factory
│   │   └── index.ts            # barrel + side-effect imports of built-ins
│   ├── commands/
│   │   ├── builtin.ts          # :quit, :help, :reload  (Phase A)
│   │   ├── standup.ts          # :standup daily|weekly  (Phase B)
│   │   └── batch.ts            # :fetch|:pull|:push all (Phase D)
│   ├── ai/
│   │   ├── provider.ts         # AIProvider interface + types  (Phase C)
│   │   ├── anthropic.ts        # AnthropicProvider             (Phase C, lazy)
│   │   ├── bedrock.ts          # BedrockProvider               (Phase C, lazy)
│   │   ├── in-memory.ts        # InMemoryProvider for tests    (Phase C)
│   │   └── index.ts            # createProvider(config) — the dispatcher
│   └── batch/
│       ├── planner.ts          # plan(): pure, (repos, action, filter) → BatchTask[]
│       └── executor.ts         # execute(tasks, pool, on_progress)
├── components/
│   ├── palette-overlay.tsx     # the :-triggered input + match list (Phase A)
│   ├── standup-overlay.tsx     # standup view: summary + raw + AI  (Phase B)
│   └── batch-overlay.tsx       # live progress overlay              (Phase D)
└── screens/main-screen.tsx     # add palette mode, wire CommandContext (Phase A)
```

### Constraints respected

- **opentui quirks** (from `AGENTS.md`): `<text>` only takes `content` prop, `<scrollbox>` no `flexDirection`, `<box>` inside scrollbox needs `flexShrink={0}`, content-relative coords use `el.y - scrollbox_ref.content.y`. The new overlays follow the `help-overlay.tsx` precedent for positioning + zIndex.
- **`@f0rbit/corpus` Result types** end-to-end. No `throw`, no `try/catch` outside the `try_catch_async` helper.
- **Bun.spawn** for git, never `child_process`. Reuse `createPool(8)` for batch concurrency.
- **Bundle**: `@opentui/core` external; everything else inlined. `@anthropic-ai/sdk` and `@aws-sdk/client-bedrock-runtime` are heavy — see Phase C decision.

---

## Phase A — Command Palette Infrastructure

**Goal:** type-safe, composable, testable command system + working `:`-triggered overlay with three trivial commands.

### A.1 — Command types + registry (≈90 LOC, parallelisable)

**Files:** `lib/palette/types.ts`, `lib/palette/registry.ts`, `lib/palette/index.ts`

`Command<Args>` shape:

```ts
export interface Command<Args = void> {
  id: string;                          // ":quit", ":standup daily"
  label: string;                       // human-readable for the palette list
  description: string;                 // longer text in match details
  keywords?: readonly string[];        // aliases / search terms
  args_schema?: ZodSchema<Args>;       // optional — most builtins are void
  execute: (
    args: Args,
    ctx: CommandContext,
  ) => Promise<Result<void, CommandError>>;
}

export type CommandError =
  | { kind: "invalid_args"; details: string }
  | { kind: "execution_failed"; cause: string }
  | { kind: "cancelled" };
```

Registry mirrors `widgets/registry.ts`:

```ts
const registry = new Map<string, Command<any>>();
export function register_command<Args>(cmd: Command<Args>): void { registry.set(cmd.id, cmd); }
export function get_command(id: string): Command<unknown> | undefined { return registry.get(id); }
export function list_commands(): readonly Command<unknown>[] { return Array.from(registry.values()); }
```

`palette/index.ts` does the side-effect imports of `commands/builtin.ts` (and later `standup.ts`, `batch.ts`).

### A.2 — Pure input parser (≈70 LOC, parallelisable)

**File:** `lib/palette/parser.ts`

```ts
export type ParseError =
  | { kind: "empty" }
  | { kind: "unknown_command"; input: string }
  | { kind: "args_invalid"; command_id: string; cause: string };

export function parse_input(
  raw: string,
): Result<{ command_id: string; args: unknown }, ParseError>;
```

Algorithm: trim → split on first space → first token is the command id (with leading `:`), rest is arg string. If the matched command has an `args_schema`, parse args against it (positional + `--flag value` / `--flag` boolean shorthand). Pure, no I/O — easy to unit-test with table-driven cases.

**Args parser micro-grammar (deliberately small):**
- positional tokens until the first `--flag`
- `--flag value` (next token) or `--flag` (boolean true)
- quoted strings (`"foo bar"`) stay one token

Don't go beyond this. If a command needs richer parsing it owns its own helper.

### A.3 — Fuzzy matcher (≈60 LOC, parallelisable — delegates to a lib)

**File:** `lib/palette/fuzzy.ts`

```ts
export interface MatchResult {
  command: Command<unknown>;
  score: number;
  positions: readonly number[];        // matched-char indices, for highlighting
}
export function match_commands(query: string, commands: readonly Command<unknown>[]): MatchResult[];
```

**Decision: use `fzf-for-js`** (npm package id `fzf`, MIT). Import shape is `import { Fzf } from "fzf"`. Wrap it in a thin function that maps fzf entries → `MatchResult[]`, building the haystack string from `id + label + keywords.join(" ")` per command and surfacing fzf's match positions so the palette UI can highlight matched chars. Bundle impact: ~10 KB gzipped, acceptable.

Pure function, trivially unit-tested with snapshot-style cases. The wrapper is the only thing under test — fzf itself is exercised by upstream's suite.

### A.4 — `CommandContext` factory (≈60 LOC, depends on A.1)

**File:** `lib/palette/context.ts`

```ts
export interface CommandContext {
  config: OverviewConfig;
  repos: () => readonly RepoNode[];           // accessor — current repo tree
  selected_repo: () => RepoNode | null;
  ai_provider: AIProvider | null;             // null until Phase C lands
  emit: (event: PaletteEvent) => void;        // status messages, errors
  open_overlay: (id: string, payload: unknown) => void;  // for :standup, :fetch all
  renderer: { suspend: () => void; resume: () => void; };
}

export type PaletteEvent =
  | { kind: "status"; text: string; level: "info" | "warn" | "error" }
  | { kind: "command_done"; command_id: string }
  | { kind: "command_failed"; command_id: string; error: CommandError };
```

`createCommandContext(deps)` constructor takes the SolidJS signal accessors and renderer ref from `MainScreen` and wires them in. Tests build a fake context from plain objects.

### A.5 — Palette overlay UI (≈180 LOC, depends on A.1–A.4)

**File:** `components/palette-overlay.tsx`

Modeled on `help-overlay.tsx`:
- absolutely positioned, ~60% width, top-third of screen
- single-line input (`<input>` from `@opentui/solid`)
- match list below (rendered with `<For>`, max ~10 visible)
- `j`/`k` or arrows to move selection within matches
- `Enter` runs `selected.execute(args, ctx)`; status emitted on completion
- `Esc` cancels and switches mode back to `NORMAL`
- visible-only when `mode() === "PALETTE"`
- reuses Tokyo Night palette via `theme.*`

Watch the documented quirks:
- input must be inside a `<box>` not nested directly under the absolute box
- match list inside `<scrollbox>` must wrap children in `<box flexDirection="column" flexShrink={0}>`
- `<text content={...} />` only — never children-as-text

### A.6 — Wire into `main-screen.tsx` (≈40 LOC, depends on A.4 + A.5)

Changes (file is at `packages/render/src/screens/main-screen.tsx`):
- add `"PALETTE"` to `AppMode`
- add `[paletteOpen, setPaletteOpen] = createSignal(false)` (or fold into `mode`)
- in `useKeyboard` `NORMAL` branch: `key.raw === ":"` → enter palette mode
- when `mode() === "PALETTE"`, the existing handler returns early so other keys don't fire (suppress `q`, `r`, `f`, `s`, `o`, `t`, `?` — palette steals all input)
- mount `<PaletteOverlay>` alongside `<HelpOverlay>`
- build `CommandContext` once via `createCommandContext({...})` in a `createMemo`

### A.7 — Three trivial built-ins (≈40 LOC, depends on A.1)

**File:** `lib/commands/builtin.ts`

```ts
register_command<void>({
  id: ":quit",
  label: "Quit overview",
  description: "Exit the application",
  keywords: ["exit", "q"],
  execute: async () => { process.exit(0); },
});

register_command<void>({
  id: ":help",
  label: "Show help",
  description: "Open the keybinding reference",
  execute: async (_, ctx) => { ctx.open_overlay("help", null); return ok(undefined); },
});

register_command<void>({
  id: ":reload",
  label: "Reload widgets and repos",
  description: "Run a full rescan",
  execute: async (_, ctx) => { ctx.emit({ kind: "status", text: "rescanning...", level: "info" }); /* trigger via ctx hook */ return ok(undefined); },
});
```

`:reload` needs a `ctx.trigger_rescan()` hook — extend `CommandContext` with a `trigger_rescan: () => void` injected from `main-screen.tsx`.

### A.8 — Tests (≈250 LOC, parallelisable with A.5/A.6)

**Files:** `lib/palette/__tests__/parser.test.ts`, `lib/palette/__tests__/fuzzy.test.ts`, `lib/palette/__tests__/registry.test.ts`, `lib/palette/__tests__/state-machine.test.ts`

- **`parser.test.ts`** — pure unit. Table-driven: `:quit`, `:standup daily`, `:fetch all --filter dirty --dry-run`, malformed inputs (`:`, `:nope`, `:standup` with bad arg).
- **`fuzzy.test.ts`** — pure unit. `"qu"` matches `:quit` highest, `"std"` matches `:standup daily` and `:standup weekly`, `"xyz"` returns empty.
- **`registry.test.ts`** — round-trip register/get/list.
- **`state-machine.test.ts`** — integration without rendering. Build a fake `CommandContext` with stub accessors + an in-memory `emit` array. Drive: open palette → type `:quit` → match list contains `:quit` → execute → `command_done` event emitted with `command_id: ":quit"`. Stub `process.exit` via a configurable `exit` hook on context.

Test counts are estimates; see "Test strategy" below.

### Phase A acceptance

Palette opens with `:`, type-fuzzy matches list, Enter runs, Esc closes. Three commands work. No standup, no batch, no AI. Bundle size impact: ~3 KB (parser + fuzzy + types).

### Phase A parallelism map

| Task | Depends on | Worktree | Owner agent |
|------|------------|----------|-------------|
| A.1 types + registry | — | A | coder-fast |
| A.2 parser | A.1 (types only) | B | coder-fast |
| A.3 fuzzy matcher | A.1 (types only) | C | coder-fast |
| A.4 context | A.1 | A (after A.1) | coder-fast |
| A.5 overlay UI | A.1, A.4 | D | coder (default model — UI judgement calls) |
| A.6 wire into main-screen | A.4, A.5 | merge step | verification coder |
| A.7 built-ins | A.1, A.4 | E | coder-fast |
| A.8 tests | A.1–A.4 | F | coder-fast |

A.1 ships first. Then A.2/A.3/A.4/A.7/A.8 fan out in parallel worktrees. A.5 is a single coder (UI work has more judgement). A.6 happens during the verification step.

A.3 is still parallelisable even though it now delegates to `fzf-for-js` — the wrapper, types, and unit tests are independent of every other task.

---

## Phase B — Standup Commands + View

**Goal:** `:standup daily` and `:standup weekly` both work, render an overlay with summary + raw sections, AI section is a placeholder hook for Phase C.

### B.1a — Generic activity types + registry (≈110 LOC, parallelisable)

**Files:** `packages/core/src/activity/types.ts`, `packages/core/src/activity/registry.ts`, `packages/core/src/activity/index.ts`

The standup pipeline is **plugin-based**: any module can register an `ActivitySource` and the standup command aggregates all of them generically. This keeps the core open for extension — devpad tasks/goals, an out-of-tree Amazon SIM/ticket plugin, etc. — without changing the standup command itself.

```ts
// Generic — what every activity source emits
export interface ActivitySection {
  source_id: string;                        // matches ActivitySource.id
  source_label: string;
  summary_line: string;                     // "3 commits, +127/-43"
  items: readonly ActivityItem[];           // newest first
  metrics?: Record<string, number>;         // optional source-specific aggregates
}

export interface ActivityItem {
  id: string;
  title: string;
  timestamp: number;                        // unix seconds
  author?: string;
  url?: string;
  meta?: Record<string, string>;            // small key/value tags rendered alongside title
}

// Plugin interface
export interface ActivitySource {
  id: string;                               // "git", "devpad", "amazon-sim"
  label: string;                            // "Git Activity", "Devpad Tasks", "SIM Tickets"
  collect(
    repo: RepoNode,
    range: StandupRange,
  ): Promise<Result<ActivitySection | null, ActivityError>>;  // null → omit section
}

// Container — standup view + AI provider consume this
export interface RepoActivity {
  repo_path: string;
  repo_name: string;
  range: StandupRange;
  sections: readonly ActivitySection[];     // one per source that returned non-null
}

// Range types (unchanged)
export interface StandupRange {
  kind: "daily" | "weekly" | "custom";
  since: Date;                       // inclusive
  until: Date;                       // exclusive (now)
  label: string;                     // "past 24h" / "since Monday"
}

export function range_daily(now: Date): StandupRange;
export function range_weekly(now: Date): StandupRange;   // since Monday 00:00 local
export function range_custom(since: Date, now: Date): StandupRange;

// Registry — mirrors components/widgets/registry.ts
export function register_activity_source(source: ActivitySource): void;
export function get_activity_source(id: string): ActivitySource | undefined;
export function list_activity_sources(): readonly ActivitySource[];

export type ActivityError =
  | { kind: "git_failed"; cause: string }
  | { kind: "not_a_repo"; path: string }
  | { kind: "source_failed"; source_id: string; cause: string };
```

`activity/index.ts` does the side-effect imports of every built-in source (currently just `./sources/git`).

**Pure date-math is fully unit-testable.** `range_weekly(new Date("2026-05-08T15:00:00Z"))` → `since` = Monday 2026-05-04 00:00 local TZ, `until` = the input.

### B.1b — Built-in `git` source (≈140 LOC, depends on B.1a)

**File:** `packages/core/src/activity/sources/git.ts`

Implements `ActivitySource` with `id: "git"`, `label: "Git Activity"`. The implementation pattern follows `git-stats.ts`:

- `git log --since=<iso> --pretty=format:%H%x09%h%x09%an%x09%ae%x09%at%x09%s` (commits)
- `git log --since=<iso> --shortstat --pretty=format:%H` (parse for insertions/deletions/files)
- `git log --since=<iso> --pretty=format:%D` (branches touched, parse refs)
- `gh pr list ...` — optional, only when `gh` succeeds; otherwise silently omit PR meta

`collect()` maps the result into `ActivitySection`:

- `summary_line`: `"3 commits, 2 files, +127/-43"`
- `items`: each commit as `{ id: short_sha, title: message, timestamp, author, meta: { branch?, files?: "2", insertions?: "+127", deletions?: "-43" } }`
- `metrics`: `{ commits: 3, insertions: 127, deletions: 43, files_changed: 2 }`
- Returns `ok(null)` (omit section) when there are zero commits in window — keeps empty repos out of the report

Side-effect imports itself in `packages/core/src/activity/index.ts` so any consumer of `@overview/core` automatically gets the git source registered.

### B.2 — Aggregator + standup commands (≈100 LOC, depends on B.1a + Phase A)

**File:** `lib/commands/standup.ts`

The command is a **generic aggregator** — for each repo, it runs every registered `ActivitySource.collect()` in parallel, drops the nulls, and packages the surviving sections into a `RepoActivity`. The command never mentions `git` or `devpad` by name; new sources show up automatically once registered.

```ts
const standup_args_schema = z.object({
  range: z.enum(["daily", "weekly"]),
});

register_command<{ range: "daily" | "weekly" }>({
  id: ":standup",
  label: "Standup report",
  description: "Show activity across all repos",
  keywords: ["report", "summary"],
  args_schema: standup_args_schema,
  execute: async ({ range }, ctx) => {
    const now = new Date();
    const window = range === "daily" ? range_daily(now) : range_weekly(now);
    const repos = ctx.repos();
    const sources = list_activity_sources();
    const pool = createPool(8);

    const activities = await Promise.all(
      collectRepoNodes(repos).map((repo) =>
        pool.run(async () => {
          const results = await Promise.all(sources.map((s) => s.collect(repo, window)));
          const sections = results
            .filter((r): r is { ok: true; value: ActivitySection } => r.ok && r.value !== null)
            .map((r) => r.value);
          return { repo_path: repo.path, repo_name: repo.name, range: window, sections };
        }),
      ),
    );

    ctx.open_overlay("standup", { window, activities });
    return ok(undefined);
  },
});
```

Note: also register two convenience aliases `:standup daily` and `:standup weekly` so the parser can match them as positional args. The args parser handles `:standup weekly` → `args = { range: "weekly" }`.

### B.3 — Standup overlay UI (≈200 LOC, depends on B.1a, B.2, Phase A.5)

**File:** `components/standup-overlay.tsx`

The overlay renders **one template** that handles every section identically — git, devpad, SIM tickets, anything else. Sections (top to bottom inside one absolute overlay):

1. **Header** — `Standup — past 24h` / `Standup — since Mon May 4`
2. **Per-repo blocks** — for each `RepoActivity` with non-empty `sections`:
   - repo header: `▸ <repo_name>`
   - for each `ActivitySection`:
     - `<source_label>` (e.g. `Git Activity`, `Devpad Tasks`)
     - `<summary_line>` one-liner
     - bulleted `items[]`: `<item.title> — <author?> <relative time>` with `meta` rendered as inline tags `[branch=main] [files=2]`
   - if a repo has zero sections (every source returned null), omit the repo entirely
   - if no repos have any sections, show `(no activity in window)`
3. **AI summary** (collapsible, default closed when no provider)
   - if `ctx.ai_provider === null`: `(AI provider not configured — see ~/.config/overview/config.json)`
   - if streaming: render incoming chunks as they arrive (Phase C)
4. **Raw data** (collapsible, default closed) — scrollable expanded view of every `ActivityItem` from every section, grouped by repo

The renderer never hard-codes `commits`, `files_changed`, etc. Anything specific to git lives inside `summary_line`/`items`/`meta` already, and shows up identically for any new source.

Keys: `j`/`k` navigate between sections, `Enter` toggles collapse, `q`/`Esc` close. `r` re-runs the standup with a fresh window. `g` cycles to the next repo when in raw mode.

Render correctly with no AI provider (gracefully degrade).

### B.4 — Tests (≈220 LOC, parallelisable with B.3)

**Files:**
- `core/__tests__/activity-range.test.ts` — pure unit on date math:
  - `range_daily` / `range_weekly` / `range_custom` — fixed `now`, assert ranges
- `core/__tests__/activity-registry.test.ts` — register/get/list round-trip on `register_activity_source`. Confirms duplicate-id handling matches the widgets registry semantics.
- `lib/activity/__tests__/git-source.test.ts` — git source `collect()` against a fixture repo (`createFixtureRepo({ commits: 2 })`), assert section shape: `summary_line`, `items` count, `metrics.commits === 2`. Also assert `collect()` on a repo with zero in-window commits returns `ok(null)`.
- `lib/commands/__tests__/standup.test.ts` — integration via fake `CommandContext`:
  - register a fake `ActivitySource` that returns a deterministic section (no git involved)
  - run `:standup daily`
  - assert `open_overlay("standup", payload)` was called and `payload.activities[0].sections[0]` matches the deterministic section verbatim
  - **Proves the plugin pipeline works end-to-end without git** — exactly the seam an out-of-tree plugin will exercise.

Note: tests no longer assert git-specific top-level fields like `commits`, `files_changed`, `insertions` on `RepoActivity` — those live inside the git source's `ActivitySection.metrics` now. Adjust any earlier draft assertions accordingly.

### B.5 — Plugin loading hook (≈40 LOC, depends on B.1a, can ship later)

**Goal:** reserve a config-driven plugin loader now so out-of-tree sources (e.g. an Amazon SIM/ticket plugin) can register themselves without changes to `@overview/core`. Implementation can land in a follow-up — but the config field must be reserved in this phase to avoid a breaking config change later.

**Reservation (lands in this phase):** add to `OverviewConfig`:

```ts
plugins?: readonly string[];   // npm package names; reserved for B.5 implementation
```

Default: `undefined` (treated as empty list).

**Loader (can ship later):** at startup, after `loadConfig()` resolves, iterate `cfg.plugins` and `await import(name)` each one. Plugin packages register themselves at module load time via `register_activity_source(...)` — same pattern as built-in sources. Failures during dynamic import are reported via the status bar (status event with `level: "error"`) and do not crash the app.

**Out-of-tree plugin shape** (proof-of-concept reference for the SIM plugin):

```
@user/overview-amazon-sim
└── src/index.ts
    import { register_activity_source } from "@overview/core";
    register_activity_source({
      id: "amazon-sim",
      label: "SIM Tickets",
      collect: async (repo, range) => { ... },
    });
```

User installs `bun add -g @user/overview-amazon-sim` and adds `"plugins": ["@user/overview-amazon-sim"]` to `~/.config/overview/config.json`. The standup command picks up SIM sections automatically.

**Future devpad source (out of scope for this phase, listed as the natural next plugin):**

- Lives at `packages/core/src/activity/sources/devpad.ts`
- `collect()` calls `devpad_tasks_list` (MCP) for tasks updated in `range`
- Items: `{ id: task.id, title: task.title, meta: { status, priority, project } }`

### Phase B acceptance

`:standup daily` and `:standup weekly` open the overlay. Empty repos and empty sources are omitted. AI section shows the placeholder. Raw data scrolls. No regressions on existing keybindings. The `plugins` config field is reserved (loader implementation can follow later).

### Phase B parallelism map

| Task | Depends on | Worktree |
|------|------------|----------|
| B.1a generic types + registry | Phase A done | A |
| B.1b git source | B.1a | B |
| B.2 standup command (generic aggregator) | B.1a | C |
| B.3 overlay UI | B.1a | D (coder) |
| B.4 tests | B.1a, B.1b | E |
| B.5 plugin loading hook (config field reserved; loader optional) | B.1a | F |

B.1a ships first. B.1b/B.2/B.3/B.4/B.5 fan out — note B.2 and B.3 only need the generic types, not the git source.

---

## Phase C — AI Provider Abstraction

**Goal:** AI summary section in the standup view streams a narrative summary when configured. Works with both Anthropic personal and Bedrock work.

### C.1 — Provider interface (≈60 LOC, parallelisable)

**File:** `lib/ai/provider.ts`

```ts
export interface SummarizeInput {
  range_label: string;                // "past 24h"
  activities: readonly RepoActivity[]; // from Phase B
  style?: "concise" | "narrative";    // default narrative
}

export type ProviderError =
  | { kind: "not_configured" }
  | { kind: "auth_failed"; cause: string }
  | { kind: "rate_limited"; retry_after_seconds?: number }
  | { kind: "network_failed"; cause: string }
  | { kind: "api_failed"; status: number; cause: string };

export interface SummaryStream {
  // Async generator of text chunks. Iterating awaits the next chunk.
  // Returns the full final string when done.
  chunks(): AsyncIterable<string>;
  final(): Promise<string>;
  abort(): void;
}

export interface AIProvider {
  id: "anthropic" | "bedrock" | "in-memory";
  summarize(input: SummarizeInput): Promise<Result<SummaryStream, ProviderError>>;
}
```

Minimal surface — no vendor knobs leak through. Production providers translate `SummarizeInput` to their SDK call internally. `activities: readonly RepoActivity[]` carries the full plugin-aggregated structure (sections per source), so every provider sees the same source-agnostic input.

### C.2 — Config schema + dispatcher (≈80 LOC, depends on C.1)

**File:** `lib/ai/index.ts` and additions to `config/index.ts`

**Config format: JSON** — the existing `~/.config/overview/config.json` and the existing `merge_deep`-based loader. No TOML, no new parser dep. The new `ai_provider` slot nests under `OverviewConfig` exactly like `layout` and `actions` already do, so existing user configs without it merge through cleanly.

Add to `packages/core/src/types.ts` `OverviewConfig`:

```ts
// addition to packages/core/src/types.ts OverviewConfig
ai_provider: {
  provider: "anthropic" | "bedrock" | null;
  model: string;
  api_key_env?: string;
  aws_region?: string;
  aws_profile?: string;
  max_tokens?: number;
}

// addition to defaultConfig() return:
ai_provider: { provider: null, model: "claude-opus-4-7" }
```

Field semantics:
- `model` — e.g. `"claude-opus-4-7"` (Anthropic) or `"us.anthropic.claude-opus-4-7-v1:0"` (Bedrock)
- `api_key_env` — env var name for Anthropic. Default `ANTHROPIC_API_KEY`
- `aws_region` / `aws_profile` — Bedrock; the AWS SDK default credential chain handles SSO
- `max_tokens` — default 2048

`createProvider(cfg, deps)` dispatcher (lazy-loads heavy SDKs):

```ts
export async function createProvider(
  cfg: AIProviderConfig,
): Promise<Result<AIProvider | null, ProviderError>> {
  if (cfg.provider === null) return ok(null);
  if (cfg.provider === "anthropic") {
    const mod = await import("./anthropic");
    return mod.createAnthropicProvider(cfg);
  }
  if (cfg.provider === "bedrock") {
    const mod = await import("./bedrock");
    return mod.createBedrockProvider(cfg);
  }
  return err({ kind: "not_configured" });
}
```

### C.3 — Anthropic provider (≈140 LOC, parallelisable with C.4)

**File:** `lib/ai/anthropic.ts`

Uses `@anthropic-ai/sdk`. Per the `claude-api` skill loaded earlier:

- Model: `claude-opus-4-7` default (overridable via config)
- `max_tokens`: stream when needed; default 2048 keeps non-streaming fine
- Use `client.messages.stream({ ... })` and adapt to `SummaryStream`
- System prompt: short — describes the role (concise multi-repo standup summarizer) and the format we want (3–5 sentence narrative)
- User prompt: built by the shared `build_prompt(input)` helper (see C.4). Iterates `RepoActivity[]` → `sections[]` → `items[]` generically and formats them as `## <repo_name>\n### <source_label> (<summary_line>)\n- <item.title> [meta tags]`. No source-specific code in the prompt builder — gains support for new `ActivitySource` plugins (devpad, SIM tickets, …) for free.
- Adaptive thinking off (this is a low-effort summary task)
- Errors mapped: 401 → `auth_failed`, 429 → `rate_limited` with `retry_after_seconds`, network → `network_failed`, other → `api_failed`
- Always wrap SDK calls with `try_catch_async` from `@f0rbit/corpus` — never let throws escape

```ts
export async function createAnthropicProvider(
  cfg: AIProviderConfig,
): Promise<Result<AIProvider, ProviderError>> {
  const env_var = cfg.api_key_env ?? "ANTHROPIC_API_KEY";
  const api_key = process.env[env_var];
  if (!api_key) return err({ kind: "auth_failed", cause: `${env_var} not set` });

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: api_key });

  return ok({
    id: "anthropic",
    summarize: async (input) => {
      // ...build prompt, call client.messages.stream(...), wrap stream in SummaryStream
    },
  });
}
```

### C.4 — Bedrock provider (≈160 LOC, parallelisable with C.3)

**File:** `lib/ai/bedrock.ts`

Uses `@aws-sdk/client-bedrock-runtime`. Authentication uses the AWS SDK default credential chain — automatically picks up `AWS_PROFILE`, `AWS_REGION`, SSO sessions from `~/.aws/sso/cache/`, and EC2/container roles. No extra code path needed for SSO; the chain handles it.

- Model id format is different — `us.anthropic.claude-opus-4-7-v1:0` style. Pass through from config.
- Use `InvokeModelWithResponseStreamCommand` for streaming.
- Body shape mirrors the Anthropic Messages API (Bedrock proxies it). Prompt construction is identical to C.3 — both providers use the shared `build_prompt(input)` helper at `lib/ai/prompt.ts`, which iterates `sections[].items[]` generically (source-agnostic). Adding a new `ActivitySource` requires no prompt-builder change.
- Errors: AWS SDK throws — wrap with `try_catch_async`. Map `ExpiredTokenException` / `UnrecognizedClientException` → `auth_failed` (with hint to re-auth SSO). `ThrottlingException` → `rate_limited`.

### C.5 — In-memory provider for tests (≈50 LOC, parallelisable with C.3/C.4)

**File:** `lib/ai/in-memory.ts`

```ts
export interface InMemoryProviderOptions {
  response?: string;
  fail_with?: ProviderError;
  delay_ms?: number;
  chunk_size?: number;
}

export function createInMemoryProvider(opts: InMemoryProviderOptions = {}): AIProvider;
```

Default response is a deterministic 3-sentence summary. Tests inspect `provider.last_input` to assert what was sent. Streams via an async generator that yields characters in chunks of `chunk_size` (default 50) with `delay_ms` between (default 0).

### C.6 — Wire into standup overlay (≈40 LOC, depends on C.1–C.5 and B.3)

When the standup overlay opens with `ctx.ai_provider !== null`:
- call `provider.summarize({...})`
- if `Result.ok`, iterate `chunks()` and append to a SolidJS signal that the AI section binds to
- if `Result.err`, render `(AI summary failed: <kind>)` in red

### C.7 — Bundling decision (DECISION NEEDED)

The brief asks for an explicit recommendation between three options:

**Option A — bundle everything.** Adds ~600 KB minified to `dist/overview.js` (Anthropic SDK ~250 KB + Bedrock SDK ~350 KB). Always loaded at startup even when AI is disabled.

**Option B — lazy dynamic `import()` (RECOMMENDED).** Same total install cost (deps still in `node_modules`), but `Bun.build()` will split them into chunks. Only loaded when `cfg.ai_provider !== null` at startup. Bundle stays lean for users who don't enable AI. Implementation already shown in C.2.

**Option C — separate `@f0rbit/overview-ai` peer package.** Ship as opt-in install. Highest user friction (`bun add -g @f0rbit/overview-ai` after install). Only worth it if AI is rare. Adds release coordination burden.

**Recommendation: Option B (lazy import).** Lowest user friction, smallest baseline bundle, simplest release flow. Bun handles dynamic imports cleanly with `target: "bun"`. Verify by inspecting `bun build --target=bun --outdir=dist` output — should produce a main bundle plus `chunk-anthropic-*.js` and `chunk-bedrock-*.js`.

**Action:** update `scripts/build-bundle.ts` to remove `@anthropic-ai/sdk` and `@aws-sdk/client-bedrock-runtime` from the `external` list (they should bundle as chunks). Run a size baseline before and after.

### C.8 — Claude Agent SDK evaluation (DECISION NEEDED — answered)

The brief asks whether to use the Claude Agent SDK (formerly Claude Code SDK) instead of the bare Anthropic SDK.

**Recommendation: NO — use `@anthropic-ai/sdk` directly.**

Reasoning:
- The Agent SDK shines for multi-turn, tool-using sessions with file ops, bash, etc. Our use case is **one-shot summarisation** — input goes in, narrative comes out, no tools, no follow-ups.
- Agent SDK adds significant weight (it's effectively a hosted-agent client) we don't benefit from.
- Bedrock support: the Agent SDK is Anthropic-API-only (`shared/managed-agents-overview.md` notes Managed Agents is "first-party only — not available on Amazon Bedrock"). The work-via-Bedrock requirement alone disqualifies it.
- The plain Messages API streaming is already simple — `client.messages.stream({ ... })` returns a typed iterable. Wrapping it in our `SummaryStream` is ~30 LOC.

If we ever extend to "ask the agent to investigate this repo" (multi-turn + tool use), revisit then. Not a near-term concern.

### C.9 — Tests (≈200 LOC)

- `lib/ai/__tests__/in-memory.test.ts` — provider behaviours (chunked stream, delay, fail_with)
- `lib/ai/__tests__/prompt.test.ts` — pure unit on `build_prompt(input)` (snapshot-style)
- `lib/ai/__tests__/dispatcher.test.ts` — `createProvider({provider: null})` returns `ok(null)`; missing API key → `auth_failed`
- **Skip** integration tests against real Anthropic / Bedrock — those are dev-time smoke tests, not CI. Document a manual smoke checklist in the plan instead.

### Phase C parallelism map

| Task | Depends on | Worktree |
|------|------------|----------|
| C.1 interface + errors | Phase B done | A |
| C.2 dispatcher + config schema | C.1 | B |
| C.3 Anthropic provider | C.1, prompt helper | C |
| C.4 Bedrock provider | C.1, prompt helper | D |
| C.5 in-memory provider | C.1 | E |
| C.6 wire into standup overlay | C.1, B.3 | F |
| C.9 tests | C.1, C.5 | G |

C.1 ships first. C.2–C.6 fan out. Use `coder` (default) for C.3/C.4 — SDK API surface needs care.

### BREAKING change call-out

- New required field on `OverviewConfig`: `ai_provider: AIProviderConfig`. Default is `{ provider: null, model: "claude-opus-4-7" }`. Existing user configs without it merge through `merge_deep` cleanly — **no breaking change at runtime**, just call out in release notes.
- New env var convention: `ANTHROPIC_API_KEY` (default name).
- **README correction**: the current README references `~/.config/overview/config.toml`, which is wrong — the loader has always used JSON. Add a small task (`pal-C8`, P2) to update the README to say `config.json`, and audit any other docs/comments that mention `config.toml`. Treat this as a docs bug, not a behaviour change.

---

## Phase D — Batch Git Operations (palette-only)

**Goal:** `:fetch all`, `:pull all`, `:push all` with `--filter` and `--dry-run`. No keybindings.

### D.1 — Pure planner (≈100 LOC, parallelisable)

**File:** `lib/batch/planner.ts`

```ts
export type BatchAction = "fetch" | "pull" | "push";
export type BatchFilter = "all" | "dirty" | "clean" | "ahead" | "behind";

export interface BatchTask {
  repo_path: string;
  repo_name: string;
  action: BatchAction;
  status: "queued" | "running" | "succeeded" | "skipped" | "failed";
  skip_reason?: "filter_excluded" | "would_conflict" | "no_remote" | "dry_run";
  result_message?: string;            // git output one-liner for the overlay
  duration_ms?: number;
}

export interface PlanInput {
  repos: readonly RepoNode[];          // already-loaded
  action: BatchAction;
  filter: BatchFilter;
  dry_run: boolean;
  force: boolean;                      // bypasses "would_conflict" skips
}

export function plan(input: PlanInput): readonly BatchTask[];
```

Plan rules:

| Action | Filter rule | Conflict rule |
|--------|-------------|---------------|
| `fetch` | none (always-safe) | none |
| `pull` | filter applies | skip if `health === "dirty"` and not `force` |
| `push` | filter applies | skip if `ahead === 0` (nothing to push); skip if `health === "diverged"` |

`dry_run: true` returns tasks with `status: "skipped"`, `skip_reason: "dry_run"` for everything that would otherwise run.

Pure function. Easy to unit-test exhaustively with table-driven tests.

### D.2 — Executor (≈120 LOC, depends on D.1)

**File:** `lib/batch/executor.ts`

```ts
export interface ExecuteOptions {
  pool_size?: number;                  // default 8
  on_progress: (task: BatchTask, snapshot: readonly BatchTask[]) => void;
  signal?: AbortSignal;                // for Esc cancellation
}

export async function execute(
  tasks: readonly BatchTask[],
  opts: ExecuteOptions,
): Promise<readonly BatchTask[]>;
```

- Reuses `createPool(opts.pool_size ?? 8)` from `@overview/core/concurrency`.
- For each non-skipped task: `Bun.spawn(["git", action], { cwd: repo_path })` — pull/fetch/push respectively. Capture stdout/stderr.
- On each state transition (`queued → running → done|failed`), call `on_progress(task, all_tasks)` so the overlay re-renders.
- `signal.aborted` check before starting each task; in-flight tasks let `git` finish (clean cancellation; killing mid-push is risky).
- Returns the final task list.

### D.3 — Batch commands (≈90 LOC, depends on D.1, D.2, Phase A)

**File:** `lib/commands/batch.ts`

Three commands sharing one factory:

```ts
type BatchArgs = { target: "all"; filter: BatchFilter; dry_run: boolean; force: boolean };

const batch_args_schema = z.object({
  target: z.literal("all"),
  filter: z.enum(["all", "dirty", "clean", "ahead", "behind"]).default("all"),
  dry_run: z.boolean().default(false),
  force: z.boolean().default(false),
});

function batch_command(action: BatchAction, label: string): Command<BatchArgs> {
  return {
    id: `:${action}`,
    label: `${label} all repos`,
    description: `Run git ${action} across all repos`,
    args_schema: batch_args_schema,
    execute: async (args, ctx) => {
      const tasks = plan({ repos: ctx.repos(), action, filter: args.filter, dry_run: args.dry_run, force: args.force });
      ctx.open_overlay("batch", { action, tasks_initial: tasks });
      // executor is kicked off by the overlay onMount (so it can subscribe to progress)
      return ok(undefined);
    },
  };
}

register_command(batch_command("fetch", "Fetch"));
register_command(batch_command("pull", "Pull"));
register_command(batch_command("push", "Push"));
```

**Important:** brief specifies "Commands NOT bound to keys — only reachable via the palette." We do **not** add any keybindings in `main-screen.tsx` for these. Status bar might show `:fetch :pull :push` as a discoverability hint when nothing else is going on, but no `Ctrl-X` or similar.

### D.4 — Batch progress overlay (≈170 LOC, depends on D.2, D.3)

**File:** `components/batch-overlay.tsx`

- Header: `Batch fetch — 5/20  ✓ 3 ✗ 1 - 1`
- Body (scrollable list):
  ```
  [01/20]  overview          fetch  ✓ Already up to date
  [02/20]  scratchpad        fetch  ⟳ ...
  [03/20]  ocn               fetch  - skipped (dry-run)
  [04/20]  legacy            fetch  ✗ failed: remote rejected
  ```
- Status icons: `⟳` (running), `✓` (success), `✗` (failed), `-` (skipped)
- `Esc` aborts via `AbortController` — already-running tasks finish; queued ones get `status: "skipped"`, `skip_reason: "cancelled"` (extend the type)
- After completion, overlay stays open until user hits `q` / `Esc` so they can inspect results.

The overlay owns an `AbortController` and calls `executor.execute(tasks, { pool_size: 8, on_progress, signal: ctrl.signal })` in `onMount`.

### D.5 — Tests (≈220 LOC)

- `lib/batch/__tests__/planner.test.ts` — exhaustive table-driven for the matrix of (action × filter × dry_run × force × repo_health). Pure, fast.
- `lib/batch/__tests__/executor.test.ts` — integration with a fake `git` via test-only `Bun.spawn` shim **OR** generate real fixture repos. Prefer fixture repos: `git init` two test repos in a temp dir, `git fetch` is essentially a no-op (no remote — that's a graceful failure path itself, useful test). For comprehensive coverage, set up a third repo with a configured local file:// remote.
- `lib/commands/__tests__/batch.test.ts` — integration via fake `CommandContext`, assert `open_overlay("batch", ...)` payload.

### Phase D parallelism map

| Task | Depends on | Worktree |
|------|------------|----------|
| D.1 planner | Phase A done | A |
| D.2 executor | D.1 | B |
| D.3 commands | D.1, A.7 pattern | C |
| D.4 overlay UI | D.2, D.3 | D (coder) |
| D.5 tests | D.1, D.2, D.3 | E |

D.1 ships first (D.2 needs the types). D.3/D.5 fan out alongside D.2/D.4.

---

## Test strategy summary

Per the `testing-strategy` skill: integration tests over unit tests, in-memory fakes over mocks.

| Phase | Unit (pure) | Integration (Provider/Context) | Total estimate |
|-------|-------------|-------------------------------|----------------|
| A     | parser, fuzzy wrapper, registry — ~3 files | palette state machine via fake context — ~1 file | ~250 LOC |
| B     | range math, registry — ~2 files | git source against fixture repo, fake-source standup pipeline — ~2 files | ~220 LOC |
| C     | prompt builder, in-memory provider — ~2 files | dispatcher with various configs — ~1 file | ~200 LOC |
| D     | planner exhaustive matrix — ~1 file | executor with fixture repos, command exec — ~2 files | ~220 LOC |

**No `bun:test` mocks.** Every test uses one of: pure function call, fake `CommandContext` built from plain objects, in-memory provider, or fixture git repo created via `Bun.spawn` in a temp dir.

**Fixture-repo helper** (one-time, used by Phase B and D integration tests):

```ts
// lib/__tests__/helpers/fixture-repo.ts
export async function createFixtureRepo(opts: { commits?: number; remote?: string }): Promise<string>
```

Creates a temp dir, `git init`, generates N commits with deterministic timestamps and authors. Teardown via `process.on("exit")` or per-test `afterAll`.

---

## Open questions

These are flagged as `DECISION NEEDED` in the body and surfaced here for explicit confirmation:

1. **Bundling strategy for AI deps** (Phase C.7) — recommend lazy dynamic import (Option B). Acceptable?
2. **Claude Agent SDK** (Phase C.8) — recommend skipping, use bare Anthropic SDK. Acceptable?
3. **Status-bar hint for batch commands** — should the status bar show `:fetch :pull :push` discoverability text, or stay silent? (Currently leaning silent — the palette is the discovery path.)
4. **Default model id** — `claude-opus-4-7` for Anthropic; for Bedrock the equivalent is `us.anthropic.claude-opus-4-7-v1:0` or similar. Should the config have separate `model_anthropic` / `model_bedrock` fields, or share one `model` and trust the user? (Leaning shared `model` — simpler.)

---

## Devpad task tracking

Devpad MCP wasn't available in this planning session (the tools didn't surface in the deferred-tool list). The plan documents the exact task structure below; create devpad entries before kicking off implementation. Each task title, description, dependencies, and priority is enumerated so a parent agent or human can mirror them mechanically.

**Project:** `overview` (existing devpad project — confirm via `devpad_projects_list` before creating tasks).

### Devpad task list

Tasks are listed in execution order. `Deps` references task IDs from the table itself. Priority: **P0** = blocks phase, **P1** = needed for phase acceptance, **P2** = nice-to-have / tests.

| ID | Title | Deps | Priority | Phase |
|----|-------|------|----------|-------|
| pal-A1 | Define `Command<Args>` type + registry barrel | — | P0 | A |
| pal-A2 | Pure input parser (`parse_input`) | pal-A1 | P0 | A |
| pal-A3 | Fuzzy matcher (`match_commands`) | pal-A1 | P0 | A |
| pal-A4 | `CommandContext` factory + types | pal-A1 | P0 | A |
| pal-A5 | Palette overlay UI (`palette-overlay.tsx`) | pal-A1, pal-A4 | P0 | A |
| pal-A6 | Wire palette mode into `main-screen.tsx` | pal-A4, pal-A5 | P0 | A |
| pal-A7 | Three built-in commands (`:quit`, `:help`, `:reload`) | pal-A1, pal-A4 | P1 | A |
| pal-A8 | Tests: parser, fuzzy, registry, state machine | pal-A1–pal-A4 | P1 | A |
| pal-B1a | `core/activity/{types,registry,index}.ts`: generic `ActivitySource`/`ActivitySection`/`RepoActivity` + `StandupRange` + registry | pal-A6 | P0 | B |
| pal-B1b | Built-in git source (`activity/sources/git.ts`) | pal-B1a | P0 | B |
| pal-B2 | `:standup daily|weekly` generic aggregator + arg parsing | pal-B1a, pal-A1 | P0 | B |
| pal-B3 | Standup overlay UI (generic per-section renderer) | pal-B1a | P0 | B |
| pal-B4 | Tests: range math, registry, git source, fake-source standup integration | pal-B1a, pal-B1b | P1 | B |
| pal-B5 | Plugin loading hook (reserve `plugins` config field; loader can follow) | pal-B1a | P1 | B |
| pal-C1 | `AIProvider` interface + `ProviderError` taxonomy | pal-B3 | P0 | C |
| pal-C2 | `createProvider` dispatcher + `AIProviderConfig` schema | pal-C1 | P0 | C |
| pal-C3 | `AnthropicProvider` (lazy import) | pal-C1 | P0 | C |
| pal-C4 | `BedrockProvider` (lazy import, AWS default credential chain) | pal-C1 | P0 | C |
| pal-C5 | `InMemoryProvider` for tests | pal-C1 | P1 | C |
| pal-C6 | Wire AI section into standup overlay (streaming chunks) | pal-C1, pal-B3 | P0 | C |
| pal-C7 | Update `scripts/build-bundle.ts` for chunked dynamic imports | pal-C2 | P1 | C |
| pal-C8 | Fix README: `config.toml` → `config.json` (audit other docs/comments too) | — | P2 | C |
| pal-C9 | Tests: prompt builder, dispatcher, in-memory streaming | pal-C1, pal-C5 | P1 | C |
| pal-D1 | Pure planner (`plan()` with action × filter × dry-run × force matrix) | pal-C6 | P0 | D |
| pal-D2 | Executor (subprocess loop, pool, AbortSignal) | pal-D1 | P0 | D |
| pal-D3 | `:fetch :pull :push` commands | pal-D1, pal-A1 | P0 | D |
| pal-D4 | Batch progress overlay UI | pal-D2, pal-D3 | P0 | D |
| pal-D5 | Tests: planner matrix, executor with fixture repos | pal-D1, pal-D2 | P1 | D |

When devpad is available, the parent agent should call `devpad_tasks_upsert` with `project_id` of `overview` for each row above. Description should link back to the relevant `.plans/palette-standup-batch.md` heading.

---

## Phase orchestration (for the parent orchestrator)

Strict sequence per the global "ALWAYS commit after each phase" rule:

```
Phase A
├── parallel coder-fast in worktrees:
│   ├── Worktree A: pal-A1 → pal-A4
│   ├── Worktree B: pal-A2
│   ├── Worktree C: pal-A3
│   ├── Worktree E: pal-A7
│   └── Worktree F: pal-A8 (tests, separate worktree)
├── single coder (default model) in its own worktree:
│   └── Worktree D: pal-A5 palette overlay UI (judgement-heavy)
└── verification coder (default):
    pal-A6 wire into main-screen + merge worktrees + typecheck + bun test + commit

Phase B
├── pal-B1a ships first (single coder-fast worktree — generic types + registry)
├── parallel coder-fast in worktrees: pal-B1b, pal-B2, pal-B4, pal-B5
├── coder (default) worktree: pal-B3 standup overlay UI
└── verification: merge + typecheck + test + commit

Phase C
├── parallel coder-fast: pal-C1, pal-C2, pal-C5, pal-C9
├── coder (default) worktrees: pal-C3 (Anthropic), pal-C4 (Bedrock), pal-C6 (overlay wiring)
├── coder-fast: pal-C7 (build script tweak)
└── verification: merge + typecheck + test + commit + verify chunk split in dist/

Phase D
├── parallel coder-fast: pal-D1, pal-D3, pal-D5
├── coder-fast: pal-D2 (executor — slightly tricky with AbortSignal)
├── coder (default) worktree: pal-D4 batch overlay UI
└── verification: merge + typecheck + test + lint + commit
```

Each verification coder loads `git-workflow` and produces an atomic commit per phase. Use `coder` (default model) for any task that touches opentui rendering or SDK integration — these need reasoning quality more than throughput.

---

## Suggested AGENTS.md updates

After this lands, propose the following additions to `/Users/tom/dev/overview/AGENTS.md` (do NOT write directly — present for approval):

1. **Add a "Command Palette" section** under "Key Conventions":
   - "All non-trivial commands go through the palette. Side-effect register via `register_command()` in `lib/commands/*.ts`, mirror with `import` in `lib/palette/index.ts`."
   - "Commands receive a `CommandContext` — never reach for global state / signals directly. This is the seam that makes them testable."
   - "Palette overlays follow `palette-overlay.tsx` precedent: absolute positioning, Tokyo Night theme, Esc closes."

2. **Add an "AI Providers" section**:
   - "Production AI deps (`@anthropic-ai/sdk`, `@aws-sdk/client-bedrock-runtime`) are loaded via dynamic `import()` so the bundle stays lean for users without AI configured."
   - "Bedrock uses the AWS SDK default credential chain — supports `AWS_PROFILE`, SSO, EC2 roles. No extra code path."
   - "Default model: `claude-opus-4-7`. Adaptive thinking off (low-effort summarisation only)."
   - "All AI calls return `Result<T, ProviderError>` — wrap SDK calls with `try_catch_async`, never let throws escape."

3. **Add an "Activity Sources" section**:
   - "The standup pipeline is plugin-based via `ActivitySource`. Built-in sources live at `packages/core/src/activity/sources/*.ts` and self-register via side-effect import from `activity/index.ts`."
   - "The standup command and overlay are source-agnostic. Never special-case a source by id — every section flows through `summary_line` / `items` / `meta` uniformly."
   - "Out-of-tree plugins are npm packages listed in `~/.config/overview/config.json` `plugins: string[]`; they call `register_activity_source()` at module load. The loader dynamically `import()`s them at startup."

4. **Add to "Gotchas"**:
   - "When adding a command, do NOT also add a keybinding unless the command is critical-path. Discoverability via the palette is the default — keybindings are reserved for high-frequency operations."

5. **Add to "Testing"** section:
   - "Use `createFixtureRepo()` from `lib/__tests__/helpers/fixture-repo.ts` for any test that needs a real `.git` directory. Builds in temp, tears down on `afterAll`."
   - "For commands and AI providers, use the Provider/Context fakes — `createTestCommandContext({ ... })` and `createInMemoryProvider({ ... })`. No `bun:test` mocks."
   - "For standup pipeline tests, register a fake `ActivitySource` returning a deterministic section — proves the aggregator + overlay work without git."

These should land as part of the Phase D verification commit so future agents see the conventions immediately.

---

## Estimated effort

| Phase | Net new LOC (impl + test) | Calendar effort (single-developer) |
|-------|---------------------------|-------------------------------------|
| A     | ~700                      | 1.5 days                            |
| B     | ~810                      | 1.25 days                           |
| C     | ~730                      | 1.5 days                            |
| D     | ~700                      | 1 day                               |
| **Total** | **~2,940**            | **~5.25 days**                       |

Parallel agents compress this significantly — Phase A can come in under 4 hours of wall clock with 5 worktrees fanning out.
