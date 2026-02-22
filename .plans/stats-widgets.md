# Stats Panel Widget System — Adaptive Layout & External Integrations

## Executive Summary

The stats panel (right-bottom) currently renders a fixed set of git status rows — branch, remote, ahead/behind, working tree counts, stash, and last commit time. On terminals taller than ~30 rows, most of the panel is empty space. This plan introduces:

1. **12 widget components** — small, composable cards showing git, GitHub, devpad, and DX data
2. **An adaptive layout engine** — priority-based space allocation that scales with terminal height
3. **External data providers** — GitHub (via `gh` CLI) and devpad (via `@devpad/api` client) integration with caching
4. **A widget registry** — user-configurable list of enabled widgets with priority ordering
5. **Persistent widget state** — collapse/expand and enable/disable state saved to `~/.config/overview/widgets.json`

### Resolved Decisions

| Decision | Resolution |
|----------|-----------|
| **devpad API access** | Use `@devpad/api` TypeScript client (link dependency). `ApiClient` constructor takes `{ base_url?, api_key? }`, returns `ApiResult<T>` using `@f0rbit/corpus` Result. API key stored in `~/.config/overview/widgets.json`. |
| **GitHub CLI fallback** | Show a placeholder message (`"gh not available"`) in the widget area when `gh` is not installed. NOT silently disabled. |
| **Widget config persistence** | Separate `~/.config/overview/widgets.json` file. NOT in the main `config.json`. |

---

## Part 1: Widget Component Ideas

### 1. `git-status` (existing, refactored)
- **Shows**: Branch, remote, ahead/behind, modified/staged/untracked/conflicts, stash count
- **Source**: `RepoStatus` (already collected)
- **Size**: Small (3-5 rows) — compact version of current stats panel
- **Priority**: HIGH — this is the core information, always shown first
- **Notes**: Refactor from current monolithic `StatsPanel` into standalone widget

### 2. `recent-commits`
- **Shows**: Last 3-5 commits with relative time, short hash, and message. Author shown if multi-contributor.
- **Source**: `RepoStatus.recent_commits` (already in `ExtendedStats`)
- **Size**: Medium (4-7 rows)
- **Priority**: HIGH — immediate context for what happened recently
- **Notes**: Already have the data, just not rendering it

### 3. `branch-list`
- **Shows**: Local branches with tracking status, ahead/behind per branch, stale branches (>30d old)
- **Source**: `RepoStatus.branches` (already collected)
- **Size**: Medium (3-8 rows, depends on branch count)
- **Priority**: MEDIUM — useful but not critical at a glance
- **Notes**: Highlight current branch, show warning icon for stale branches

### 4. `github-prs`
- **Shows**: Open PR count, your PRs awaiting review, PRs needing your review. Each PR shows title, #number, status (draft/review/approved/changes-requested), CI status indicator
- **Source**: `gh pr list --json number,title,state,reviewDecision,statusCheckRollup` via `gh` CLI
- **Size**: Medium (3-8 rows)
- **Priority**: HIGH — PRs are the most actionable GitHub data
- **Notes**: Only available for repos with a GitHub remote. Cache for 2 minutes. Shows `"gh not available"` placeholder when `gh` CLI is missing.

### 5. `github-issues`
- **Shows**: Open issue count, recent issues (last 5), labels as colored dots
- **Source**: `gh issue list --json number,title,labels,createdAt` via `gh` CLI
- **Size**: Medium (3-6 rows)
- **Priority**: LOW — less immediately actionable than PRs
- **Notes**: Cache for 5 minutes. Skip for repos with 0 issues. Shows `"gh not available"` placeholder when `gh` CLI is missing.

### 6. `github-ci`
- **Shows**: Latest workflow run status per workflow (pass/fail/running), duration, branch. Single-line per workflow with colored status icon.
- **Source**: `gh run list --json name,status,conclusion,headBranch -L 5` via `gh` CLI
- **Size**: Small (2-4 rows)
- **Priority**: MEDIUM — quick signal on whether CI is green
- **Notes**: Cache for 1 minute (CI changes frequently). Collapse to single "CI: all green" when all pass. Shows `"gh not available"` placeholder when `gh` CLI is missing.

### 7. `devpad-tasks`
- **Shows**: Open tasks for this project from devpad — title, priority badge, progress status. Grouped by priority (HIGH first).
- **Source**: `@devpad/api` client — `client.tasks.getByProject(project_id)` returns `ApiResult<TaskWithDetails[]>`
- **Size**: Medium (3-8 rows)
- **Priority**: MEDIUM — bridges project management into the TUI
- **Notes**: Requires matching git repo to devpad project (see matching strategy below). Cache for 5 minutes. Shows `"devpad not configured"` placeholder when API key is missing.

### 8. `devpad-milestones`
- **Shows**: Current milestone name, target version, target date, goal completion progress (e.g., "3/7 goals done"). Compact progress bar.
- **Source**: `@devpad/api` client — `client.milestones.getByProject(project_id)` + `client.milestones.goals(id)` for the matched project
- **Size**: Small (2-4 rows)
- **Priority**: LOW — high-level project health, less immediately useful
- **Notes**: Only shown if project has milestones configured. Shows `"devpad not configured"` placeholder when API key is missing.

### 9. `repo-meta`
- **Shows**: Total commits, contributor count, repo size, tag count, latest tag/version
- **Source**: `ExtendedStats` (already collected in `git-stats.ts`)
- **Size**: Small (2-3 rows)
- **Priority**: MEDIUM — quick reference metadata
- **Notes**: Already have the data. Show latest tag prominently if it looks like a semver.

### 10. `file-changes`
- **Shows**: List of modified/staged/untracked files with status icons, truncated paths
- **Source**: `RepoStatus.changes` (already collected)
- **Size**: Medium (3-10 rows, depends on change count)
- **Priority**: MEDIUM — shows exactly what's dirty
- **Notes**: Useful complement to the count-only `git-status` widget. Collapsible.

### 11. `commit-activity`
- **Shows**: Sparkline-style activity chart — commits per day for last 14 days rendered as braille/block characters. Total commits this week vs last week delta.
- **Source**: `git log --format=%at --since="14 days ago"` — new git command
- **Size**: Small (2-3 rows)
- **Priority**: LOW — nice visual indicator of momentum but not critical
- **Notes**: Requires new data collection in `git-stats.ts`. Braille chars (`\u2800`-`\u28FF`) for sparkline.

### 12. `github-release`
- **Shows**: Latest release tag, date, whether current HEAD is ahead of latest release (and by how many commits)
- **Source**: `gh release view --json tagName,publishedAt,name` + `git rev-list <tag>..HEAD --count`
- **Size**: Small (1-2 rows)
- **Priority**: LOW — useful for library maintainers
- **Notes**: Cache for 10 minutes. Only shown if repo has releases. Shows `"gh not available"` placeholder when `gh` CLI is missing.

---

## Part 2: Adaptive Layout System Design

### Core Concept: Widget Slots with Priority Allocation

The layout engine treats the available panel height as a budget. Each widget declares its size requirements and priority. The engine allocates space top-to-bottom by priority, fitting as many widgets as possible.

### Widget Interface

```typescript
// packages/core/src/types.ts (additions)

export type WidgetId =
  | "git-status"
  | "recent-commits"
  | "branch-list"
  | "github-prs"
  | "github-issues"
  | "github-ci"
  | "devpad-tasks"
  | "devpad-milestones"
  | "repo-meta"
  | "file-changes"
  | "commit-activity"
  | "github-release";

export interface WidgetConfig {
  id: WidgetId;
  enabled: boolean;
  priority: number;        // lower = higher priority (rendered first)
  collapsed: boolean;      // user toggle — persisted to widgets.json
}

export interface WidgetSizeRequest {
  min_rows: number;        // minimum height to be useful (e.g., header + 1 data row)
  preferred_rows: number;  // ideal height with all data visible
  max_rows: number;        // cap — no point rendering more than this
}

export interface WidgetRenderProps {
  allocated_rows: number;  // how many rows the layout gave this widget
  width: number;           // panel width in columns
  focused: boolean;        // whether stats panel has focus
}
```

### Layout Algorithm

```
function allocateWidgets(available_rows, widgets[]):
  1. Filter to enabled + non-collapsed widgets
  2. Sort by priority (ascending — lower number = higher priority)
  3. Phase 1 — Minimum allocation:
     - Walk widgets in priority order
     - If remaining_rows >= widget.min_rows: allocate min_rows, subtract from budget
     - If not: skip this widget (and all lower-priority ones)
  4. Phase 2 — Distribute surplus:
     - remaining = available_rows - sum(allocated minimums)
     - Walk allocated widgets in priority order again
     - Give each widget min(remaining, preferred - min) additional rows
     - Subtract granted rows from remaining
  5. Phase 3 — Overflow bonus:
     - If still remaining rows, distribute to widgets up to their max_rows
     - Same priority-first walk
  6. Return: WidgetId -> allocated_rows mapping (only for widgets that got space)
```

This ensures:
- **Small terminals (30-40 rows)**: Only highest-priority widgets shown (git-status + recent-commits)
- **Medium terminals (40-60 rows)**: Core git + 1-2 external widgets
- **Large terminals (60-80+)**: Full dashboard with all enabled widgets

### Collapsed State

When a widget is collapsed, it renders as a single row: `[>] Widget Name (summary)` — e.g., `[>] GitHub PRs (3 open)`. Collapsed widgets still participate in layout but with `min_rows = 1, preferred_rows = 1, max_rows = 1`.

User toggles collapse with a keybinding while the stats panel is focused.

### Scrollable Overflow

If the total min_rows of all enabled widgets exceeds available_rows, the widget container becomes scrollable (using opentui `<scrollbox>`). This is the fallback — the priority system should prevent this in most cases.

### Widget Separator

Between widgets, a thin horizontal line using box-drawing characters: `────────────` in `theme.border` color. This costs 1 row per gap — the layout engine accounts for separators.

### Widget State Persistence (`widgets.json`)

Widget state (collapsed/expanded, enabled/disabled, priority order) persists to a **separate** file at `~/.config/overview/widgets.json`. This keeps the main `config.json` clean and avoids needing a `saveConfig()` for the primary config.

```typescript
// File: ~/.config/overview/widgets.json
// Format:
{
  "widgets": [
    { "id": "git-status",        "enabled": true,  "priority": 0, "collapsed": false },
    { "id": "recent-commits",    "enabled": true,  "priority": 1, "collapsed": false },
    { "id": "github-prs",        "enabled": true,  "priority": 2, "collapsed": false },
    ...
  ],
  "devpad": {
    "api_key": "dp_abc123...",
    "api_url": "https://devpad.tools/api/v1"
  }
}
```

The `devpad` section stores the API key and URL here rather than in the main config, since it's widget-specific configuration. If this file doesn't exist, we use `defaultWidgetConfig()` and devpad widgets show the `"devpad not configured"` placeholder.

```typescript
// packages/render/src/lib/widget-state.ts (new file)

export interface WidgetStateFile {
  widgets: WidgetConfig[];
  devpad?: {
    api_key: string;
    api_url?: string;  // defaults to "https://devpad.tools/api/v1"
  };
}

export type WidgetStateError =
  | { kind: "parse_error"; path: string; cause: string }
  | { kind: "write_error"; path: string; cause: string };

const WIDGETS_PATH = join(CONFIG_DIR, "widgets.json");

export async function loadWidgetState(): Promise<Result<WidgetStateFile, WidgetStateError>>
export async function saveWidgetState(state: WidgetStateFile): Promise<Result<void, WidgetStateError>>
export function defaultWidgetConfig(): WidgetConfig[]
```

### Default Widget Config

```typescript
export function defaultWidgetConfig(): WidgetConfig[] {
  return [
    { id: "git-status",        enabled: true,  priority: 0, collapsed: false },
    { id: "recent-commits",    enabled: true,  priority: 1, collapsed: false },
    { id: "github-prs",        enabled: true,  priority: 2, collapsed: false },
    { id: "file-changes",      enabled: true,  priority: 3, collapsed: false },
    { id: "repo-meta",         enabled: true,  priority: 4, collapsed: false },
    { id: "github-ci",         enabled: true,  priority: 5, collapsed: false },
    { id: "branch-list",       enabled: true,  priority: 6, collapsed: false },
    { id: "devpad-tasks",      enabled: true,  priority: 7, collapsed: false },
    { id: "devpad-milestones",  enabled: false, priority: 8, collapsed: false },
    { id: "commit-activity",   enabled: false, priority: 9, collapsed: false },
    { id: "github-issues",     enabled: false, priority: 10, collapsed: false },
    { id: "github-release",    enabled: false, priority: 11, collapsed: false },
  ];
}
```

---

## Part 3: Data Model & Core Module Changes

### 3.1 Repo-to-Project Matching (devpad)

To show devpad data for a repo, we need to match the selected repo to a devpad project. Strategy:

1. **Primary**: Match `RepoStatus.remote_url` against devpad project `repo_url`
   - Normalize both URLs: strip `.git` suffix, convert SSH to HTTPS form for comparison
   - e.g., `git@github.com:f0rbit/devpad.git` matches `https://github.com/f0rbit/devpad`
2. **Fallback**: Match repo directory name against devpad `project_id`
   - e.g., repo at `~/dev/devpad` matches project with `project_id: "devpad"`

```typescript
// packages/core/src/devpad.ts (new file)

// Lightweight types that mirror what @devpad/api returns but kept
// minimal for the TUI's needs. We import the actual types from
// @devpad/api at the provider layer (render package), not here.

export interface DevpadProject {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  status: string;
  repo_url: string | null;
}

export interface DevpadTask {
  id: string;
  title: string;
  description: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH";
  progress: "UNSTARTED" | "IN_PROGRESS" | "COMPLETED";
  project_id: string | null;
}

export interface DevpadMilestone {
  id: string;
  name: string;
  target_version: string | null;
  target_time: string | null;
  goals_total: number;
  goals_completed: number;
}

export interface DevpadRepoData {
  project: DevpadProject | null;
  tasks: DevpadTask[];
  milestones: DevpadMilestone[];
}
```

### 3.2 GitHub Data Types

```typescript
// packages/core/src/github.ts (new file)

export interface GithubPR {
  number: number;
  title: string;
  state: string;
  review_decision: string | null;
  ci_status: "success" | "failure" | "pending" | "none";
  is_draft: boolean;
  author: string;
}

export interface GithubIssue {
  number: number;
  title: string;
  labels: string[];
  created_at: string;
}

export interface GithubWorkflowRun {
  name: string;
  status: string;
  conclusion: string | null;
  head_branch: string;
  duration_seconds: number | null;
}

export interface GithubRelease {
  tag_name: string;
  name: string;
  published_at: string;
  commits_since: number;
}

export interface GithubRepoData {
  prs: GithubPR[];
  issues: GithubIssue[];
  ci_runs: GithubWorkflowRun[];
  latest_release: GithubRelease | null;
}

export type GithubError =
  | { kind: "not_github_repo" }
  | { kind: "gh_cli_not_found" }
  | { kind: "gh_auth_required" }
  | { kind: "api_error"; cause: string }
  | { kind: "rate_limited" };
```

### 3.3 Caching Layer

```typescript
// packages/core/src/cache.ts (new file)

export interface CacheEntry<T> {
  data: T;
  fetched_at: number;   // unix ms
  ttl_ms: number;
}

export class DataCache<T> {
  private entries = new Map<string, CacheEntry<T>>();

  get(key: string): T | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (Date.now() - entry.fetched_at > entry.ttl_ms) {
      this.entries.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key: string, data: T, ttl_ms: number): void {
    this.entries.set(key, { data, fetched_at: Date.now(), ttl_ms });
  }

  invalidate(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
```

GitHub cache TTLs:
- PRs: 120s (2 min)
- Issues: 300s (5 min)
- CI runs: 60s (1 min)
- Releases: 600s (10 min)

devpad cache TTLs:
- Tasks: 300s (5 min)
- Milestones: 300s (5 min)
- Project match: 600s (10 min) — the repo-to-project mapping rarely changes

### 3.4 GitHub Data Collector

```typescript
// packages/core/src/github.ts

// Uses `gh` CLI — checks for availability once at startup
// All calls go through a single-concurrency queue to avoid
// rate-limit issues when rapidly switching between repos

async function gh(args: string[], cwd: string): Promise<Result<string, GithubError>>
async function collectGithubData(repoPath: string): Promise<Result<GithubRepoData, GithubError>>
function isGithubRemote(remoteUrl: string | null): boolean
function parseGhOwnerRepo(remoteUrl: string): { owner: string; repo: string } | null

// `gh_cli_not_found` error triggers the placeholder message in widgets
// Check is done once via `Bun.which("gh")` and cached for the session
```

When `gh` is not found, each GitHub widget renders:

```
┌─ GitHub PRs ──────────────┐
│  gh not available          │
│  install: https://cli.github.com │
└───────────────────────────┘
```

This is NOT a silent disable — the widget remains visible at its `min_rows` size with the placeholder.

### 3.5 Commit Activity Data

Addition to `git-stats.ts`:

```typescript
export interface CommitActivity {
  // commit counts per day for last 14 days
  // index 0 = 14 days ago, index 13 = today
  daily_counts: number[];
  total_this_week: number;
  total_last_week: number;
}

async function collectCommitActivity(repoPath: string): Promise<Result<CommitActivity, GitStatsError>>
```

Collected via: `git log --format=%at --since="14 days ago" --all`

---

## Part 4: Implementation Phases

### Version Grouping

**v1 Widgets** (build first) — use data we already have or can collect cheaply:

| Widget | Data Source | New Code? |
|--------|-----------|-----------|
| `git-status` | RepoStatus | Refactor existing |
| `recent-commits` | ExtendedStats | Render only |
| `file-changes` | RepoStatus.changes | Render only |
| `repo-meta` | ExtendedStats | Render only |
| `branch-list` | RepoStatus.branches | Render only |

**v1.5 Widgets** (GitHub integration):

| Widget | Data Source | New Code? |
|--------|-----------|-----------|
| `github-prs` | `gh` CLI | New collector + renderer |
| `github-ci` | `gh` CLI | New collector + renderer |
| `github-release` | `gh` CLI + git | New collector + renderer |

**v2 Widgets** (devpad + extras):

| Widget | Data Source | New Code? |
|--------|-----------|-----------|
| `devpad-tasks` | `@devpad/api` | New provider + renderer |
| `devpad-milestones` | `@devpad/api` | New provider + renderer |
| `github-issues` | `gh` CLI | New collector + renderer |
| `commit-activity` | git log | New collector + sparkline renderer |

---

### Phase 1: Layout Engine + Widget Infrastructure (sequential)

**Must complete first — everything else builds on this.**

| Task | Files | Est. LOC | Notes |
|------|-------|----------|-------|
| 1.1 Widget types | `core/src/types.ts` | 40 | Add `WidgetId`, `WidgetConfig`, `WidgetSizeRequest`, `WidgetRenderProps` |
| 1.2 Layout allocator | `render/src/lib/widget-layout.ts` (new) | 120 | `allocateWidgets()` algorithm, separator accounting |
| 1.3 Widget registry | `render/src/components/widgets/registry.ts` (new) | 60 | Map of WidgetId -> component + size declaration |
| 1.4 Widget state persistence | `render/src/lib/widget-state.ts` (new) | 100 | `loadWidgetState()`, `saveWidgetState()`, `defaultWidgetConfig()`, `WidgetStateFile` type. File at `~/.config/overview/widgets.json` |
| 1.5 WidgetContainer component | `render/src/components/widget-container.tsx` (new) | 110 | Replaces `StatsPanel` — loads widget state, runs layout algo, renders widgets in a scrollbox, passes devpad config to provider |
| 1.6 Update MainScreen | `render/src/screens/main-screen.tsx` | 20 | Replace `<StatsPanel>` with `<WidgetContainer>` |

**Total Phase 1: ~450 LOC, 1 agent, sequential**

**BREAKING**: `StatsPanel` component props change. The old `StatsPanel` is replaced by `WidgetContainer`. The `StatsPanel` component moves to `widgets/git-status.tsx` as a widget.

---

### Phase 2: v1 Widgets — Git-Native (parallel)

All use existing data from `RepoStatus` / `ExtendedStats`. No new data collection needed.

| Task | Files | Est. LOC | Deps | Parallel? |
|------|-------|----------|------|-----------|
| 2.1 `git-status` widget | `render/src/components/widgets/git-status.tsx` | 80 | Phase 1 | Yes |
| 2.2 `recent-commits` widget | `render/src/components/widgets/recent-commits.tsx` | 60 | Phase 1 | Yes |
| 2.3 `file-changes` widget | `render/src/components/widgets/file-changes.tsx` | 70 | Phase 1 | Yes |
| 2.4 `repo-meta` widget | `render/src/components/widgets/repo-meta.tsx` | 50 | Phase 1 | Yes |
| 2.5 `branch-list` widget | `render/src/components/widgets/branch-list.tsx` | 70 | Phase 1 | Yes |

Each widget:
- Exports a SolidJS component accepting `WidgetRenderProps` + the relevant data
- Exports a `size_request: WidgetSizeRequest` constant
- Registers itself in the widget registry

**Total Phase 2: ~330 LOC, 5 agents in parallel**

---

### Phase 3: Cache + GitHub Provider (sequential)

| Task | Files | Est. LOC | Notes |
|------|-------|----------|-------|
| 3.1 Cache module | `core/src/cache.ts` (new) | 50 | Generic `DataCache<T>` with TTL |
| 3.2 GitHub collector | `core/src/github.ts` (new) | 200 | `gh` CLI wrapper, JSON parsing, error handling, owner/repo extraction from remote URL. `gh_cli_not_found` error on `Bun.which("gh")` miss. |
| 3.3 GitHub provider hook | `render/src/lib/use-github.ts` (new) | 80 | SolidJS signal wrapper around GitHub collector with cache integration |
| 3.4 Core exports | `core/src/index.ts` | 5 | Export new modules |

**Total Phase 3: ~335 LOC, 1 agent, sequential**

---

### Phase 4: GitHub Widgets (parallel)

All GitHub widgets handle the `gh_cli_not_found` error by rendering a visible placeholder:

```
  gh not available
  install: https://cli.github.com
```

The widget still renders at `min_rows` height — it is NOT hidden or silently disabled.

| Task | Files | Est. LOC | Deps | Parallel? |
|------|-------|----------|------|-----------|
| 4.1 `github-prs` widget | `render/src/components/widgets/github-prs.tsx` | 90 | Phase 3 | Yes |
| 4.2 `github-ci` widget | `render/src/components/widgets/github-ci.tsx` | 70 | Phase 3 | Yes |
| 4.3 `github-release` widget | `render/src/components/widgets/github-release.tsx` | 50 | Phase 3 | Yes |

Each GitHub widget receives a `github_error: GithubError | null` prop alongside the data. When `error?.kind === "gh_cli_not_found"`, render the placeholder. When `error?.kind === "not_github_repo"`, show `"not a GitHub repo"`.

**Total Phase 4: ~210 LOC, 3 agents in parallel**

---

### Phase 5: devpad Integration via `@devpad/api` (sequential)

Uses the `@devpad/api` TypeScript client package as a **link dependency** added to `@overview/core`.

#### Dependency setup

```jsonc
// packages/core/package.json — add:
{
  "dependencies": {
    "@devpad/api": "link:/Users/tom/dev/devpad/packages/api"
  }
}
```

The `@devpad/api` package exports `ApiClient` which takes `{ base_url?, api_key? }` and all methods return `ApiResult<T>` (a `Result<T, ApiResultError>` from `@f0rbit/corpus`). This matches our existing error-handling pattern perfectly — no adapter needed.

#### Key API methods used

```typescript
import { ApiClient } from "@devpad/api";
import type { Project, TaskWithDetails, Milestone, Goal } from "@devpad/api";

const client = new ApiClient({
  base_url: "https://devpad.tools/api/v1",
  api_key: "dp_...",
});

// List all projects (to find matching one by repo_url)
client.projects.list()           // -> ApiResult<Project[]>

// Get tasks for matched project
client.tasks.getByProject(id)    // -> ApiResult<TaskWithDetails[]>

// Get milestones for matched project
client.milestones.getByProject(id)  // -> ApiResult<Milestone[]>

// Get goals for a milestone
client.milestones.goals(id)      // -> ApiResult<Goal[]>
```

#### Provider architecture

```typescript
// render/src/lib/use-devpad.ts (new file)

// Reads devpad config from WidgetStateFile (loaded by widget-state.ts)
// Creates ApiClient lazily when devpad.api_key is present
// Falls back to "devpad not configured" placeholder when key is missing
// Caches project list for 10 min, tasks/milestones for 5 min

export function useDevpad(
  widgetState: WidgetStateFile,
  remoteUrl: Accessor<string | null>,
  repoName: Accessor<string>,
): {
  data: Accessor<DevpadRepoData | null>;
  error: Accessor<string | null>;
  loading: Accessor<boolean>;
}
```

When `widgetState.devpad?.api_key` is not set, `error()` returns `"devpad not configured"` and both devpad widgets show this as a placeholder (same pattern as `gh` CLI unavailable).

| Task | Files | Est. LOC | Notes |
|------|-------|----------|-------|
| 5.1 devpad types | `core/src/devpad.ts` (new) | 50 | Lightweight TUI types + URL normalizer + `matchRepoToProject()` |
| 5.2 Add `@devpad/api` dependency | `core/package.json` | 3 | Add link dependency |
| 5.3 devpad provider hook | `render/src/lib/use-devpad.ts` (new) | 120 | Creates `ApiClient` from widget state config, repo matching, cache |
| 5.4 Wire into WidgetContainer | `render/src/components/widget-container.tsx` | 30 | Pass devpad data to widgets |
| 5.5 Core exports | `core/src/index.ts` | 3 | Export devpad module |

**Total Phase 5: ~206 LOC, 1 agent, sequential**

---

### Phase 6: devpad Widgets + Extras (parallel)

| Task | Files | Est. LOC | Deps | Parallel? |
|------|-------|----------|------|-----------|
| 6.1 `devpad-tasks` widget | `render/src/components/widgets/devpad-tasks.tsx` | 80 | Phase 5 | Yes |
| 6.2 `devpad-milestones` widget | `render/src/components/widgets/devpad-milestones.tsx` | 70 | Phase 5 | Yes |
| 6.3 `github-issues` widget | `render/src/components/widgets/github-issues.tsx` | 60 | Phase 3 | Yes |
| 6.4 `commit-activity` widget + collector | `render/src/components/widgets/commit-activity.tsx`, `core/src/git-stats.ts` (extend) | 100 | Phase 1 | Yes* |

*6.4 modifies `core/src/git-stats.ts` — cannot parallel with anything else touching that file. But since nothing else in Phase 6 touches it, it's fine.

devpad widgets handle missing config the same way as GitHub widgets handle missing `gh`:

```
  devpad not configured
  add api_key to widgets.json
```

**Total Phase 6: ~310 LOC, 4 agents in parallel**

---

### Phase 7: Widget Keyboard Controls + Polish (sequential)

| Task | Files | Est. LOC | Notes |
|------|-------|----------|-------|
| 7.1 Collapse/expand keybindings | `render/src/components/widget-container.tsx`, `main-screen.tsx` | 60 | `c` to collapse focused widget, `C` to collapse all, number keys to toggle specific widgets |
| 7.2 Widget scroll when overflowing | `render/src/components/widget-container.tsx` | 40 | j/k scroll within widget container when focused |
| 7.3 Persist widget state on change | `render/src/components/widget-container.tsx` | 30 | Call `saveWidgetState()` after collapse/expand/enable/disable toggles |
| 7.4 Status bar widget indicator | `render/src/components/status-bar.tsx` | 20 | Show "widgets: 5/8" or similar |
| 7.5 Help overlay update | `render/src/components/help-overlay.tsx` | 15 | Document new widget keybindings |

**Total Phase 7: ~165 LOC, 1 agent, sequential**

---

## Summary

| Phase | Description | LOC | Agents | Strategy |
|-------|-------------|-----|--------|----------|
| 1 | Layout engine + infrastructure + widget state persistence | 450 | 1 | Sequential |
| 2 | v1 git-native widgets | 330 | 5 | Parallel |
| 3 | Cache + GitHub provider | 335 | 1 | Sequential |
| 4 | GitHub widgets (with `gh` placeholder fallback) | 210 | 3 | Parallel |
| 5 | devpad integration via `@devpad/api` | 206 | 1 | Sequential |
| 6 | devpad widgets + extras | 310 | 4 | Parallel |
| 7 | Keyboard controls + persistence + polish | 165 | 1 | Sequential |
| **Total** | | **~2,006** | | |

---

## File Impact Analysis

### Modified files
| File | Change |
|------|--------|
| `core/src/types.ts` | Add widget types (`WidgetId`, `WidgetConfig`, `WidgetSizeRequest`, `WidgetRenderProps`) |
| `core/src/index.ts` | Export new modules (github, devpad, cache) |
| `core/src/git-stats.ts` | Add `collectCommitActivity()` |
| `core/package.json` | Add `@devpad/api` link dependency |
| `render/src/components/stats-panel.tsx` | **Deleted** — replaced by `widget-container.tsx` |
| `render/src/components/index.ts` | Update exports (remove StatsPanel, add WidgetContainer) |
| `render/src/screens/main-screen.tsx` | Replace `StatsPanel` with `WidgetContainer`, add github/devpad data flow |
| `render/src/components/status-bar.tsx` | Add widget count indicator |
| `render/src/components/help-overlay.tsx` | Add widget keybindings |

### New files
| File | Purpose |
|------|---------|
| `core/src/cache.ts` | Generic TTL cache |
| `core/src/github.ts` | GitHub `gh` CLI collector + types |
| `core/src/devpad.ts` | devpad lightweight types + repo matcher |
| `render/src/lib/widget-layout.ts` | Layout allocation algorithm |
| `render/src/lib/widget-state.ts` | Load/save `~/.config/overview/widgets.json` |
| `render/src/lib/use-github.ts` | SolidJS hook for GitHub data |
| `render/src/lib/use-devpad.ts` | SolidJS hook for devpad data (uses `@devpad/api` `ApiClient`) |
| `render/src/components/widget-container.tsx` | Main widget container component |
| `render/src/components/widgets/registry.ts` | Widget registry |
| `render/src/components/widgets/git-status.tsx` | Widget |
| `render/src/components/widgets/recent-commits.tsx` | Widget |
| `render/src/components/widgets/file-changes.tsx` | Widget |
| `render/src/components/widgets/repo-meta.tsx` | Widget |
| `render/src/components/widgets/branch-list.tsx` | Widget |
| `render/src/components/widgets/github-prs.tsx` | Widget |
| `render/src/components/widgets/github-ci.tsx` | Widget |
| `render/src/components/widgets/github-release.tsx` | Widget |
| `render/src/components/widgets/github-issues.tsx` | Widget |
| `render/src/components/widgets/devpad-tasks.tsx` | Widget |
| `render/src/components/widgets/devpad-milestones.tsx` | Widget |
| `render/src/components/widgets/commit-activity.tsx` | Widget |

---

## devpad Repo Matching — Detailed Strategy

From the devpad project list, these projects have `repo_url` set:

| devpad project_id | repo_url |
|-------------------|----------|
| chamber | https://github.com/f0rbit/chamber |
| dev-blog | https://github.com/f0rbit/dev-blog-go |
| devpad | https://github.com/f0rbit/devpad |
| dungeon-generator | https://github.com/f0rbit/dungeon-generator |
| forbit-dev | https://github.com/f0rbit/forbit-astro |
| gm-server | https://github.com/f0rbit/gm-server |
| todo-tracker | https://github.com/f0rbit/todo-tracker |
| key-grip | https://github.com/f0rbit/key-grip |
| burning-blends | https://github.com/f0rbit/burning-blends |
| corpus | https://github.com/f0rbit/corpus |
| gallery | https://github.com/f0rbit/gallery |

URL normalization function:
```typescript
function normalizeGitUrl(url: string): string {
  let normalized = url.trim()
    .replace(/\.git$/, "")
    .replace(/\/$/, "");

  // SSH -> HTTPS
  const sshMatch = normalized.match(/^git@([^:]+):(.+)$/);
  if (sshMatch) {
    normalized = `https://${sshMatch[1]}/${sshMatch[2]}`;
  }

  return normalized.toLowerCase();
}

function matchRepoToProject(
  remote_url: string | null,
  repo_name: string,
  projects: DevpadProject[],
): DevpadProject | null {
  // Primary: URL match
  if (remote_url) {
    const normalized = normalizeGitUrl(remote_url);
    const match = projects.find(p =>
      p.repo_url && normalizeGitUrl(p.repo_url) === normalized
    );
    if (match) return match;
  }

  // Fallback: name match
  return projects.find(p => p.project_id === repo_name) ?? null;
}
```

Note the edge case: `dev-blog` project maps to `dev-blog-go` repo. The URL match handles this correctly because the `repo_url` contains the actual GitHub URL. The name fallback would NOT catch this, which is why URL matching is primary.

---

## GitHub Rate Limiting Strategy

- `gh` CLI handles auth automatically (uses stored token)
- GitHub API rate limit: 5000 requests/hour for authenticated users
- Our approach: **per-repo caching + single-flight dedup**
  - When user selects a repo, check cache first
  - If cache miss, fetch once and cache
  - If user rapidly switches repos, cancel in-flight requests for deselected repos
  - Never fetch GitHub data for repos without a GitHub remote
- **Estimated usage**: ~4 API calls per repo selection (PRs, issues, CI, releases) * generous user switching = ~200 calls/hour max. Well within limits.
- **Optimization**: Batch the 4 calls per repo with `Promise.all` — they're independent

---

## Placeholder Behavior Summary

| Condition | Widget behavior | Placeholder text |
|-----------|----------------|-----------------|
| `gh` CLI not installed | GitHub widgets render at `min_rows` with placeholder | `"gh not available — install: https://cli.github.com"` |
| `gh` installed but not authenticated | GitHub widgets render with auth error | `"gh auth required — run: gh auth login"` |
| Not a GitHub remote | GitHub widgets render at `min_rows` with placeholder | `"not a GitHub repo"` |
| devpad API key not in `widgets.json` | devpad widgets render at `min_rows` with placeholder | `"devpad not configured — add api_key to widgets.json"` |
| devpad API call fails | devpad widgets render with error | `"devpad error: <message>"` |
| No matching devpad project | devpad widgets render with hint | `"no devpad project matched"` |

All placeholders use `theme.fg_dim` color. Widgets are **never silently hidden** due to missing tools/config — they always show a visible explanation of why data is unavailable.

---

## `@devpad/api` Integration Details

### Package: `@devpad/api` (v2.0.0)

- **Location**: `/Users/tom/dev/devpad/packages/api`
- **Exports**: `ApiClient`, type-only re-exports of `Project`, `TaskWithDetails`, `Milestone`, `Goal` from `@devpad/schema`
- **Result type**: `ApiResult<T> = Result<T, ApiResultError>` where `ApiResultError = { message: string; code?: string; status_code?: number }`
- **Auth**: `api_key` field in constructor options, sent as header. Auth mode auto-detected from key prefix.

### Constructor in provider

```typescript
// render/src/lib/use-devpad.ts

import { ApiClient } from "@devpad/api";
import type { Project, TaskWithDetails, Milestone, Goal } from "@devpad/api";

function createDevpadClient(state: WidgetStateFile): ApiClient | null {
  if (!state.devpad?.api_key) return null;
  return new ApiClient({
    base_url: state.devpad.api_url ?? "https://devpad.tools/api/v1",
    api_key: state.devpad.api_key,
  });
}
```

### Data flow

```
widgets.json (devpad.api_key + api_url)
  → ApiClient constructed in use-devpad.ts
    → client.projects.list() to find matching project by repo URL
      → client.tasks.getByProject(project.id)
      → client.milestones.getByProject(project.id) + goals per milestone
        → DevpadRepoData passed to widgets
```

All API calls use `DataCache` with the TTLs specified in Part 3.3. The project list is cached longest (10 min) since it rarely changes. Tasks and milestones are cached for 5 min.

---

## Suggested AGENTS.md Updates

After implementing this feature, add to `AGENTS.md`:

```markdown
## Widget System
- Stats panel replaced by widget container (`render/src/components/widget-container.tsx`)
- Widgets live in `render/src/components/widgets/` — each exports a component + WidgetSizeRequest
- Widget registry in `widgets/registry.ts` maps WidgetId -> component
- Layout algorithm in `render/src/lib/widget-layout.ts`
- Widget state (collapse/enable/priority) persisted to `~/.config/overview/widgets.json`
  - Also stores devpad API key/URL in `devpad` section
  - Loaded by `render/src/lib/widget-state.ts`
- GitHub data collected via `gh` CLI wrapper in `core/src/github.ts`
  - Shows "gh not available" placeholder (not silently disabled) when `gh` missing
- devpad data collected via `@devpad/api` client (`link:` dependency in core/package.json)
  - Provider in `render/src/lib/use-devpad.ts` creates `ApiClient` from widgets.json config
  - Shows "devpad not configured" placeholder when API key missing
- All external data cached via `core/src/cache.ts` with per-source TTLs
- Repo-to-devpad-project matching uses URL normalization (SSH/HTTPS) with name fallback
- opentui constraints: `<text content={...}>` for dynamic strings, `fg`/`bg` for color, no ANSI, no `<span>`
```
