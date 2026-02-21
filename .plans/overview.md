# overview — Multi-Repo Git Health Dashboard TUI

## Executive Summary

`overview` is a terminal UI that scans a directory tree for git repositories (including worktrees), presents them in an interactive hierarchical list with per-repo health summaries, and provides a split-pane detail view with an embedded git graph and comprehensive stats panel. Built with Bun + @opentui/solid (same stack as hackertui), it reuses the proven SolidJS reactive model, focus management, Tokyo Night theming, and vim-style keybinding patterns.

This subsumes the `pulse` concept from `future-ideas.md`, with a narrower scope: git-centric health dashboard, no dependency-ripple analysis, no CI status (v1).

---

## 1. Feasibility Analysis

### Can we build on ggi?

**ggi** is an fzf-based interactive tool (57 lines of bash). Three integration strategies:

| Strategy | Pros | Cons | Verdict |
|----------|------|------|---------|
| **A) Embed fzf output** | Reuses fzf rendering | Can't embed fzf inside opentui — fzf takes over stdin/stdout | **No** |
| **B) Reimplement graph natively** | Full control, pixel-perfect layout | Significant effort to parse/render git graph characters | **Partial** |
| **C) Shell out to ggi** | Zero effort | Takes over the terminal, exits overview | **Fallback action** |
| **D) Hybrid: native static graph + ggi as action** | Best UX: static graph in panel, `g` to launch full ggi | Moderate effort for static graph, but ggi for interactive use | **Recommended** |

**Recommendation: Strategy D (Hybrid)**

- **Right-top panel**: Render `git log --graph --oneline --all -n 30` output directly as ANSI text inside an opentui `<box>`. This is a static, scrollable, colorized view — no interactivity needed in the panel itself. Git's `--color=always` output includes ANSI escape codes that opentui can render via `<text>` elements.
- **Full ggi action**: Press `g` on any repo to suspend overview and launch `ggi` in that repo's directory. When ggi exits, overview resumes. This is identical to how hackertui's comment viewer shells out — we use `process.stdin` passthrough.
- **Why not full native graph?** The git log graph rendering (box-drawing + color) is a solved problem in git itself. Reimplementing the DAG layout for branches/merges is ~500-1000 LOC of complex logic for marginal benefit. The static view gives context; ggi gives interactivity.

### @opentui/solid capabilities (v0.1.80)

From hackertui exploration + opentui changelog through v0.1.80 (2026-02-17). No breaking changes from v0.1.74.

**Components:**
- `<box>` with absolute positioning, flexbox, borders, overflow control
- `<text>` with ANSI color support (fg/bg props accept hex colors)
- `<select>` with j/k navigation, descriptions, scroll indicators, item selection, wrap, fast scroll
- `<scrollbox>` with built-in keyboard navigation (j/k, arrow keys, Page Up/Down, Home/End) when focused. Has `scrollTo()` / `scrollBy()` methods, `stickyScroll` with `stickyStart: "bottom"` for auto-scroll, `viewportCulling: true` (default) for performance
- `<diff>` — diff viewer with line highlighting API (added in 0.1.80)
- `<markdown>` — Markdown renderer with streaming, Tree-sitter syntax highlighting, conceal mode
- `<code>` — syntax-highlighted code blocks via Tree-sitter
- `<tab_select>` — horizontal tab selection
- `<textarea>` — multi-line text input
- `<input>` — single-line text input
- `<Portal>` — renders children into a different mount point (useful for overlays like help screen)

**Hooks / utilities:**
- `useKeyboard()` for input handling
- `useTerminalDimensions()` for responsive layout
- `useTimeline()` for animation
- `onResize()` — terminal resize callback (cleaner than `createEffect` on `useTerminalDimensions`)

**Focus management:** Each focusable component (`<select>`, `<input>`, `<textarea>`, `<scrollbox>`) has a `focused` prop. When focused, components handle their own keyboard navigation. Renderer has `autoFocus` on click. hackertui built a custom FocusManager on top, which is still a reasonable pattern for coordinating multiple panes.

**Limitation**: No built-in split-pane resizing. We'll use fixed ratios (configurable) with flexbox `<box>` layout — same approach as hackertui's comment/browser split.

**Limitation**: No tree component — our custom hierarchical repo list with `<box>` + manual keyboard handling is necessary.

### Git operations performance

Scanning 28 repos at depth 3 with full status:
- `git rev-parse --git-dir` — ~2ms per dir (to detect repos)
- `git status --porcelain` — ~5-20ms per repo
- `git log --oneline -1` — ~3ms per repo
- `git rev-list --count @{u}..HEAD` — ~5ms per repo (unpushed)
- `git rev-list --count HEAD..@{u}` — ~5ms per repo (behind)
- `git branch -a` — ~5ms per repo
- `git stash list` — ~3ms per repo
- `git log --graph --oneline --all -n 30` — ~15ms per repo

**Total per repo: ~40-60ms. For 28 repos: ~1.5s sequential, ~200ms parallel.**

We'll use `Bun.spawn` with parallel execution and progressive rendering — repos appear as they're scanned.

### Worktree detection

Git worktrees are identified by:
1. Bare repos with `git worktree list` showing multiple entries
2. `.git` file (not directory) pointing to another `.git/worktrees/<name>` — these are worktree checkouts
3. We scan for both, group worktrees under their parent repo in the hierarchy

---

## 2. Technical Dependencies

### Runtime
- **Bun** >=1.0 (user has 1.3.3)

### npm packages
| Package | Purpose | Version |
|---------|---------|---------|
| `@opentui/solid` | TUI rendering framework | ^0.1.80 |
| `@opentui/core` | Terminal size utilities | ^0.1.80 |
| `solid-js` | Reactive UI primitives | ^1.9.11 |
| `@f0rbit/corpus` | Result<T,E> error handling | link:../corpus |
| `zod` | Schema validation (config) | ^3.x |
| `@iarna/toml` | TOML config parsing | ^2.2.5 |

### Dev dependencies
| Package | Purpose |
|---------|---------|
| `typescript` | Type checking |
| `@types/bun` | Bun type defs |
| `@babel/core` | SolidJS JSX transform |
| `@babel/preset-typescript` | TS support for babel |
| `babel-preset-solid` | SolidJS compiler |
| `biome` | Linting + formatting |

### System dependencies (all pre-installed)
- `git` — core data source
- `fzf` >=0.54 — for ggi integration
- `delta` — for ggi diff rendering
- `bat` — for ggi markdown rendering

### No new system dependencies required.

---

## 3. Architecture

### Package structure

**Decision: Flat monorepo with 3 packages.** Matches hackertui's proven structure, scaled down (no API package needed — all data is local git).

```
overview/
├── packages/
│   ├── core/              # Git operations, scanning, data collection
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── scanner.ts          # Directory scanner, repo discovery
│   │   │   ├── worktree.ts         # Worktree detection & grouping
│   │   │   ├── git-status.ts       # Per-repo status collection
│   │   │   ├── git-graph.ts        # Git log --graph output capture
│   │   │   ├── git-stats.ts        # Comprehensive stats (lines, authors, etc.)
│   │   │   ├── watcher.ts          # File system watcher for live updates
│   │   │   └── types.ts            # Core types (exported, no separate schema pkg)
│   │   ├── __tests__/
│   │   │   ├── integration/
│   │   │   │   ├── scanner.test.ts
│   │   │   │   └── git-status.test.ts
│   │   │   └── helpers.ts          # Test repo scaffold helpers
│   │   └── package.json
│   └── render/            # TUI components, screens, theming
│       ├── src/
│       │   ├── overview.tsx         # Entry point (main app)
│       │   ├── screens/
│       │   │   ├── index.ts
│       │   │   └── main-screen.tsx  # Primary split-pane screen
│       │   ├── components/
│       │   │   ├── index.ts
│       │   │   ├── repo-list.tsx    # Left panel: hierarchical repo list
│       │   │   ├── git-graph.tsx    # Right-top: git graph viewer
│       │   │   ├── stats-panel.tsx  # Right-bottom: comprehensive stats
│       │   │   ├── status-bar.tsx   # Bottom status/command bar
│       │   │   └── status-badge.tsx # Inline status indicators
│       │   ├── lib/
│       │   │   ├── focus.tsx        # Focus manager (adapted from hackertui)
│       │   │   ├── terminal.ts      # tmux detection, stdin polyfill
│       │   │   └── format.ts        # Time formatting, number formatting
│       │   ├── theme/
│       │   │   ├── index.ts
│       │   │   ├── types.ts
│       │   │   └── tokyonight.ts    # Tokyo Night theme (from hackertui)
│       │   └── config/
│       │       ├── index.ts
│       │       ├── types.ts         # Config Zod schemas
│       │       └── loader.ts        # TOML config loader
│       ├── __tests__/
│       └── package.json
├── package.json            # Root workspace config
├── tsconfig.json
├── biome.json
├── bunfig.toml
└── AGENTS.md
```

**Why no `schema` package?** The types are simple enough to live in `core/src/types.ts` and be imported directly. Adding a third package for ~50 lines of types adds overhead without benefit. If the project grows, extract later.

### Data flow

```
┌──────────────────────────────────────────────────────────┐
│                      CLI Entry                           │
│  bun run src/overview.tsx [--dir ~/dev] [--depth 3]      │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│                  @overview/core                          │
│                                                          │
│  scanner.ts ──► discovers git repos at depth N           │
│       │                                                  │
│       ▼                                                  │
│  worktree.ts ──► groups worktrees under parent           │
│       │                                                  │
│       ▼                                                  │
│  git-status.ts ──► parallel Bun.spawn for each repo      │
│       │              - status --porcelain                │
│       │              - rev-list (ahead/behind)           │
│       │              - branch -a                         │
│       │              - stash list                        │
│       │              - diff --stat                       │
│       ▼                                                  │
│  git-graph.ts ──► git log --graph (on-demand per repo)   │
│                                                          │
│  git-stats.ts ──► heavyweight stats (on-demand)          │
│       │              - shortlog (contributor stats)      │
│       │              - log --since (recent activity)     │
│       │              - count-objects (repo size)         │
│       │              - tag list                          │
│       ▼                                                  │
│  watcher.ts ──► fs.watch on .git dirs for live updates   │
│                                                          │
│  Returns: RepoTree (nested, with status signals)         │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│                  @overview/render                        │
│                                                          │
│  SolidJS signals hold repo tree + selected repo state    │
│                                                          │
│  ┌─────────────────┬───────────────────────────────────┐ │
│  │  repo-list.tsx  │  git-graph.tsx                    │ │
│  │  (left panel)   │  (right-top panel)                │ │
│  │                 ├───────────────────────────────────┤ │
│  │                 │  stats-panel.tsx                  │ │
│  │                 │  (right-bottom panel)             │ │
│  └─────────────────┴───────────────────────────────────┘ │
│                                                          │
│  status-bar.tsx (bottom, always visible)                 │
└──────────────────────────────────────────────────────────┘
```

---

## 4. Language Choice

**TypeScript + Bun.** Justified by:

1. **Ecosystem alignment**: User's primary stack. hackertui, corpus, devpad all TypeScript/Bun
2. **@opentui/solid**: Only available for TypeScript/SolidJS. The TUI framework is the biggest accelerator
3. **Reusable patterns**: Focus management, theme system, config loading — all liftable from hackertui
4. **@f0rbit/corpus**: User's error handling library. Native TypeScript
5. **Bun.spawn**: Excellent subprocess API for git commands. Simpler than Node's child_process
6. **Bun shell** (`$`): Available as fallback for complex shell pipelines

**Alternatives considered:**
- **Go** (installed, 1.22.1): Would require reimplementing TUI framework. Charm/bubbletea is excellent but would mean zero code reuse from hackertui. Significant context switch.
- **Zig** (installed, 0.15.2): No TUI ecosystem. Wrong tool for this job.
- **Rust**: Not installed. User would need to install toolchain.

---

## 5. ASCII Mockup Designs

### 5.1 Main Overview Screen — Default State

```
┌─ overview ──────────────────── ~/dev ──── 28 repos ── scanning... ──┐
│                                                                     │
├─────────────────────────┬───────────────────────────────────────────┤
│  ~/dev                  │ ┌─ git graph ───────────────────────────┐ │
│  ├── algorithms/     ✓  │ │ * 4a2f1c3 (HEAD -> main) fix: t…      │ │
│  ├── bases.nvim/     ✓  │ │ * 8b3e2d1 feat: add treesitter…       │ │
│  ├── burning-blends/ ✓  │ │ * c7f9a0e refactor: extract pa…       │ │
│  ├── byron-kastelic/ ✓  │ │ | * 2d4e6f8 (origin/dev) wip:…        │ │
│  ├── chamber/       ↑3  │ │ | |/                                  │ │
│  ├── corpus/        ↑1  │ │ * | a1b2c3d merge: dev into m…        │ │
│  ├── cs-club-websit… ✓  │ │ |\ \                                  │ │
│  ├── database/       ✓  │ │ | * 5f6g7h8 fix: query perfor…        │ │
│  ├── dev-blog-go/    ✓  │ │ * | 9i0j1k2 chore: bump deps          │ │
│  ├── dev-blog/       ✓  │ │ |/                                    │ │
│  ├── devpad/        ↑2  │ │ * l3m4n5o v2.1.0 release              │ │
│ >├── dotfiles/      ~3  │ │                                       │ │
│  ├── forbit-astro/   ✓  │ └───────────────────────────────────────┘ │
│  ├── gallery/        ✓  │ ┌─ stats: dotfiles ─────────────────────┐ │
│  ├── gm-server/      ✓  │ │                                       │ │
│  ├── hackertui/     ↑1  │ │  branch   main                        │ │
│  ├── key-grip/       ✓  │ │  remote   origin (github.com/…)       │ │
│  ├── media-timeline/ ✓  │ │                                       │ │
│  ├── mycelia/        ✓  │ │  ↑ 0 ahead   ↓ 0 behind               │ │
│  ├── ocn/            ✓  │ │  ~ 3 modified  + 0 staged             │ │
│  ├── rollette/       ✓  │ │  ? 1 untracked  ! 0 conflicts         │ │
│  ├── runbook/       ↑5  │ │  ✂ 2 stashes                          │ │
│  ├── studdy-buddy/   ✓  │ │                                       │ │
│  ├── todo-tracker/   ✓  │ │  last commit  2h ago                  │ │
│  └── ui/            ↑1  │ │  contributors 3                       │ │
│                         │ │  branches     4 local / 6 remote      │ │
│                         │ │  tags         v1.0, v1.1, v2.0        │ │
│                         │ │  repo size    12.4 MB                 │ │
│                         │ │                                       │ │
│                         │ │  ── recent ─────────────────────      │ │
│                         │ │  2h ago  fix: fish config paths       │ │
│                         │ │  1d ago  feat: add ghostty theme      │ │
│                         │ │  3d ago  chore: update nvim plugs     │ │
│                         │ │                                       │ │
│                         │ └───────────────────────────────────────┘ │
├─────────────────────────┴───────────────────────────────────────────┤
│ [NORMAL] j/k:nav  Enter:expand  g:ggi  r:refresh  q:quit  ?:help    │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 Status Badge Legend

```
Status badges in the repo list (right-aligned):

  ✓      Clean — nothing to commit, up to date with remote
  ↑3     Ahead — 3 commits not pushed
  ↓2     Behind — 2 commits to pull
  ↑3↓2   Diverged — ahead AND behind
  ~3     Modified — 3 uncommitted changes (no ahead/behind)
  ~3↑1   Modified + ahead
  !      Conflicts — merge conflicts present
  ?      Untracked only — new files, nothing else
  ✂      Stash — has stashed changes (shown alongside other badges)
```

### 5.3 Color Scheme (Tokyo Night)

```
Colors applied to status badges:
  ✓  green   (#9ece6a)   — clean
  ↑  yellow  (#e0af68)   — unpushed
  ↓  cyan    (#7dcfff)   — behind
  ~  blue    (#7aa2f7)   — modified
  !  red     (#f7768e)   — conflicts
  ?  dim     (#565f89)   — untracked
  ✂  purple  (#bb9af7)   — stash

Panel borders:      #3b4261
Selected repo bg:   #283457
Header text:        #7aa2f7 (primary blue)
Dim text:           #565f89
Normal text:        #c0caf5
```

### 5.4 Worktree Display (Amazon workplace layout)

```
┌─ overview ──── ~/workplace/apollo/src ──── 12 repos ──────────────┐
├─────────────────────────┬─────────────────────────────────────────┤
│  ~/workplace/apollo/src │                                         │
│  ├── ApolloService/  ↑2 │ (git graph for selected repo)           │
│  │   ├── main        ✓  │                                         │
│  │   ├── wt/dev     ~5  │                                         │
│  │   └── wt/hotfix   ✓  │                                         │
│  ├── ApolloConfig/   ✓  │                                         │
│  ├── SharedLibs/    ↑1  │─────────────────────────────────────────│
│  ├── DeployTools/    ✓  │                                         │
│  ...                    │ (stats panel for selected repo)         │
```

Worktrees are shown as children of their parent repo with `wt/` prefix. The parent repo shows its main checkout, worktrees are indented below.

### 5.5 Expanded Repo Detail (Enter on a repo)

When pressing Enter on a repo, the right panels expand to show more detail:

```
┌─ overview ──────────────────── ~/dev ──── 28 repos ─────────────────┐
├─────────────────────────┬───────────────────────────────────────────┤
│  ~/dev                  │ ┌─ git graph: runbook ──────────────────┐ │
│  ├── ...                │ │ * 4a2f1c3 (HEAD -> main, origin…      │ │
│  ├── rollette/       ✓  │ │ * 8b3e2d1 feat(core): add agent       │ │
│ >├── runbook/       ↑5  │ │ * c7f9a0e fix(server): handle …       │ │
│  ├── studdy-buddy/   ✓  │ │ * 2d4e6f8 refactor(schema): dr…       │ │
│  ├── todo-tracker/   ✓  │ │ |\                                    │ │
│  └── ui/            ↑1  │ │ | * 5f6g7h8 (origin/dev) wip: …       │ │
│                         │ │ | * a1b2c3d feat(render): split…      │ │
│                         │ │ |/                                    │ │
│                         │ │ * l3m4n5o merge: release v0.3.0       │ │
│                         │ │ * p6q7r8s v0.3.0                      │ │
│                         │ │ * t9u0v1w chore: cleanup tests        │ │
│                         │ │ * x2y3z4a fix(api): rate limit…       │ │
│                         │ │ * b5c6d7e feat(core): add retry       │ │
│                         │ │ * f8g9h0i initial commit              │ │
│                         │ └───────────────────────────────────────┘ │
│                         │ ┌─ stats: runbook ──────────────────────┐ │
│                         │ │  branch    main (tracking origin)     │ │
│                         │ │  remote    git@github.com:f0rb…       │ │
│                         │ │                                       │ │
│                         │ │  UNPUSHED COMMITS (5):                │ │
│                         │ │   4a2f1c3 feat(core): add agent…      │ │
│                         │ │   8b3e2d1 fix(server): handle …       │ │
│                         │ │   c7f9a0e refactor(schema): dri…      │ │
│                         │ │   2d4e6f8 feat(render): split p…      │ │
│                         │ │   5f6g7h8 wip: event streaming        │ │
│                         │ │                                       │ │
│                         │ │  ~ 0 modified  + 2 staged             │ │
│                         │ │  ? 0 untracked  ! 0 conflicts         │ │
│                         │ │                                       │ │
│                         │ │  ── branches ──────────────────       │ │
│                         │ │  * main          ↑5                   │ │
│                         │ │    dev           ↑2                   │ │
│                         │ │    feature/auth  (no remote)          │ │
│                         │ │                                       │ │
│                         │ └───────────────────────────────────────┘ │
├─────────────────────────┴───────────────────────────────────────────┤
│ [DETAIL] j/k:scroll graph  h/l:panel  g:ggi  r:refresh  q:back      │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.6 All-Clean State

```
┌─ overview ──────────────────── ~/dev ──── 28 repos ── all clean ────┐
├─────────────────────────┬───────────────────────────────────────────┤
│  ~/dev                  │ ┌─ git graph ───────────────────────────┐ │
│  ├── algorithms/     ✓  │ │                                       │ │
│ >├── bases.nvim/     ✓  │ │  * a1b2c3d (HEAD -> main, origi…      │ │
│  ├── burning-blends/ ✓  │ │  * d4e5f6g feat: initial setup        │ │
│  ├── ...             ✓  │ │                                       │ │
│  ...                    │ │  (2 commits)                          │ │
│                         │ └───────────────────────────────────────┘ │
│                         │ ┌─ stats: bases.nvim ───────────────────┐ │
│                         │ │                                       │ │
│                         │ │  ✓ Everything clean & up to date      │ │
│                         │ │                                       │ │
│                         │ │  branch     main                      │ │
│                         │ │  last commit 5d ago                   │ │
│                         │ │  commits     47                       │ │
│                         │ │  branches    1 local / 1 remote       │ │
│                         │ │  repo size   284 KB                   │ │
│                         │ │                                       │ │
│                         │ └───────────────────────────────────────┘ │
├─────────────────────────┴───────────────────────────────────────────┤
│ [NORMAL] ✓ all 28 repos clean                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.7 Navigation Flow

```
                    ┌───────────┐
                    │  Launch   │
                    │ overview  │
                    └─────┬─────┘
                          │
                          ▼
                  ┌───────────────┐
                  │  Scan repos   │──── progressive render
                  │  (parallel)   │     repos appear as found
                  └───────┬───────┘
                          │
                          ▼
              ┌───────────────────────┐
              │   NORMAL MODE         │
              │   Repo list focused   │◄────────────────┐
              │   j/k = navigate      │                 │
              │   Right panels update │                 │
              │   on selection change │                 │
              └───┬───────────────┬───┘                 │
                  │               │                     │
            Enter │          g    │                     │
                  ▼               ▼                     │
        ┌─────────────┐  ┌──────────────┐              │
        │ DETAIL MODE │  │ ggi launches │              │
        │ h/l = panel │  │ (subprocess) │              │
        │ j/k = scroll│  │ Full terminal│              │
        │ q = back    │  │ On exit:     │──────────────┘
        └──────┬──────┘  │ resume       │
               │         └──────────────┘
          q/Esc│
               │
               ▼
        Back to NORMAL

  Other keybindings (available in both modes):
    r     = refresh all repos
    R     = full rescan (re-walk directory tree)
    /     = filter repos by name
    s     = sort: name / status / last-commit
    f     = filter: dirty / clean / ahead / behind / all
    ?     = help overlay
    q     = quit (from NORMAL) / back (from DETAIL)
    :     = command mode (vim-style)
    t     = open tmux session for repo (via sessionizer)
    o     = open in $EDITOR (nvim)
```

---

## 6. Data Model

### Core Types

```typescript
// packages/core/src/types.ts

import { z } from "zod";

// === Git Status ===

export const GitFileStatus = z.enum([
  "modified", "added", "deleted", "renamed",
  "copied", "untracked", "ignored", "conflicted"
]);
export type GitFileStatus = z.infer<typeof GitFileStatus>;

export const GitFileChange = z.object({
  path: z.string(),
  status: GitFileStatus,
  staged: z.boolean(),
});
export type GitFileChange = z.infer<typeof GitFileChange>;

export const BranchInfo = z.object({
  name: z.string(),
  is_current: z.boolean(),
  upstream: z.string().nullable(),
  ahead: z.number(),
  behind: z.number(),
  last_commit_time: z.number(), // unix timestamp
});
export type BranchInfo = z.infer<typeof BranchInfo>;

export const StashEntry = z.object({
  index: z.number(),
  message: z.string(),
  date: z.string(),
});
export type StashEntry = z.infer<typeof StashEntry>;

export const RepoStatus = z.object({
  // Identity
  path: z.string(),             // absolute path to repo root
  name: z.string(),             // directory name
  display_path: z.string(),     // relative to scan root

  // Current state
  current_branch: z.string(),
  head_commit: z.string(),      // short hash
  head_message: z.string(),     // first line of commit message
  head_time: z.number(),        // unix timestamp

  // Tracking
  remote_url: z.string().nullable(),
  ahead: z.number(),
  behind: z.number(),

  // Working tree
  modified_count: z.number(),
  staged_count: z.number(),
  untracked_count: z.number(),
  conflict_count: z.number(),
  changes: z.array(GitFileChange),

  // Stash
  stash_count: z.number(),
  stashes: z.array(StashEntry),

  // Branches
  branches: z.array(BranchInfo),
  local_branch_count: z.number(),
  remote_branch_count: z.number(),

  // Metadata
  tags: z.array(z.string()),
  total_commits: z.number(),
  repo_size_bytes: z.number(),
  contributor_count: z.number(),

  // Recent activity
  recent_commits: z.array(z.object({
    hash: z.string(),
    message: z.string(),
    author: z.string(),
    time: z.number(),
  })),

  // Derived
  is_clean: z.boolean(),
  health: z.enum(["clean", "dirty", "ahead", "behind", "diverged", "conflict"]),
});
export type RepoStatus = z.infer<typeof RepoStatus>;

// === Worktree ===

export const WorktreeInfo = z.object({
  path: z.string(),
  branch: z.string(),
  head: z.string(),
  is_bare: z.boolean(),
  is_main: z.boolean(), // true if this is the main checkout
});
export type WorktreeInfo = z.infer<typeof WorktreeInfo>;

// === Repo Tree Node ===

export type RepoNode = {
  name: string;
  path: string;
  type: "directory" | "repo" | "worktree";
  status: RepoStatus | null;   // null for plain directories
  worktrees: WorktreeInfo[];   // non-empty only for repos with worktrees
  children: RepoNode[];        // nested repos/dirs
  depth: number;
  expanded: boolean;           // UI state for tree collapse
};

// === Config ===

export const OverviewConfig = z.object({
  scan_dirs: z.array(z.string()).default(["~/dev"]),
  depth: z.number().default(3),
  refresh_interval: z.number().default(30),    // seconds, 0 = manual only
  theme: z.string().default("tokyonight-night"),
  layout: z.object({
    left_width_pct: z.number().default(35),     // percentage of terminal width
    graph_height_pct: z.number().default(45),   // percentage of right panel height
  }).default({}),
  sort: z.enum(["name", "status", "last-commit"]).default("name"),
  filter: z.enum(["all", "dirty", "clean", "ahead", "behind"]).default("all"),
  ignore: z.array(z.string()).default([         // glob patterns to skip
    "node_modules",
    ".git",
  ]),
  actions: z.object({
    ggi: z.string().default("ggi"),              // path to ggi script
    editor: z.string().default("$EDITOR"),
    sessionizer: z.string().nullable().default(null), // tmux-sessionizer path
  }).default({}),
});
export type OverviewConfig = z.infer<typeof OverviewConfig>;
```

### Git Graph Data

The git graph is captured as raw ANSI-escaped string output from `git log --graph`. We don't parse the DAG — we render git's own output directly. This is stored as:

```typescript
export type GitGraphOutput = {
  lines: string[];      // raw ANSI-escaped lines
  total_lines: number;
  repo_path: string;
};
```

### Refresh Strategy

1. **Initial scan**: Walk directory tree, discover repos, collect status in parallel
2. **Selection change**: Load graph + heavy stats on-demand when repo is selected
3. **Background refresh**: Every N seconds (configurable), re-run `git status` for all repos
4. **File watcher**: Watch `.git/index` and `.git/refs/` for each repo — trigger status refresh on change
5. **Manual refresh**: `r` key re-fetches status for selected repo, `R` re-scans entire directory

---

## 7. Integration Points

### ggi (git graph interactive)

- **Trigger**: Press `g` on any repo in the list
- **Mechanism**: `Bun.spawn` with `{ stdin: "inherit", stdout: "inherit", stderr: "inherit" }` — fully takes over the terminal
- **Working directory**: Selected repo's path
- **On exit**: overview's opentui renderer resumes. SolidJS signals preserved — no state lost
- **Implementation note**: Need to call `renderer.stop()` before spawning, `renderer.start()` after — same pattern as any full-screen subprocess

### tmux-sessionizer

- **Trigger**: Press `t` on any repo
- **Mechanism**: Shell out to the user's sessionizer script with repo path as argument
- **Behavior**: Creates/attaches tmux session for that project. If already in tmux, switches session. If not in tmux, starts new tmux with session
- **Detection**: Check `$TMUX` environment variable

### Neovim

- **Trigger**: Press `o` on any repo
- **Mechanism**: `Bun.spawn(["nvim", "."], { cwd: repo_path, stdin: "inherit", stdout: "inherit" })`
- **Same terminal takeover pattern as ggi**

### Sketchybar (future, v2)

- **Not in MVP scope**
- **Concept**: `overview --check` outputs a JSON summary of health across all repos. Sketchybar polls this to show a green/yellow/red icon
- **Trivial to add**: Just a non-interactive mode that prints and exits

### gh CLI (future, v2)

- **Not in MVP scope**
- **Concept**: Show PR count, CI status per repo. Requires `gh api` calls which are rate-limited
- **DECISION NEEDED**: Whether to include GitHub integration in v1 or defer. Recommendation: defer.

---

## 8. Phase Breakdown

### Phase 0: Scaffold (sequential)
*Unblocks everything. Must complete first.*

| Task | Files | Est. LOC | Notes |
|------|-------|----------|-------|
| 0.1 Root workspace setup | `package.json`, `tsconfig.json`, `biome.json`, `bunfig.toml` | 80 | Bun workspaces, TypeScript paths, biome config |
| 0.2 Core package scaffold | `packages/core/package.json`, `src/index.ts`, `src/types.ts` | 150 | Types + Zod schemas as defined in data model |
| 0.3 Render package scaffold | `packages/render/package.json`, `src/overview.tsx`, theme/, config/, lib/ | 200 | Entry point shell, Tokyo Night theme, focus manager (lifted from hackertui), stdin polyfill, tmux detection |
| 0.4 Install dependencies | `bun install` | 0 | Verify opentui, solid, corpus all resolve |

**Total Phase 0: ~430 LOC, 1 agent, sequential**

---

### Phase 1: Core Git Operations (parallel)
*All git data collection logic. No UI. Fully testable.*

| Task | Files | Est. LOC | Deps | Parallel? |
|------|-------|----------|------|-----------|
| 1.1 Directory scanner | `core/src/scanner.ts` | 120 | Phase 0 | Yes |
| 1.2 Worktree detection | `core/src/worktree.ts` | 80 | Phase 0 | Yes |
| 1.3 Git status collector | `core/src/git-status.ts` | 200 | Phase 0 | Yes |
| 1.4 Git graph capture | `core/src/git-graph.ts` | 60 | Phase 0 | Yes |
| 1.5 Git stats (heavyweight) | `core/src/git-stats.ts` | 150 | Phase 0 | Yes |

**Task details:**

**1.1 Directory scanner** (`scanner.ts`)
- Walk directory tree up to configurable depth
- Detect git repos: check for `.git` directory OR `.git` file (worktree marker)
- Build nested `RepoNode[]` tree preserving directory hierarchy
- Respect `ignore` patterns from config
- Use `Bun.spawn(["git", "rev-parse", "--git-dir"])` to validate repos
- Return `Result<RepoNode[], ScanError>`

**1.2 Worktree detection** (`worktree.ts`)
- For each discovered repo, run `git worktree list --porcelain`
- Parse output into `WorktreeInfo[]`
- Group worktree checkouts under their parent bare repo
- Handle edge case: linked worktrees where `.git` is a file pointing to `../.git/worktrees/<name>`
- Return `Result<WorktreeInfo[], WorktreeError>`

**1.3 Git status collector** (`git-status.ts`)
- Run multiple git commands in parallel per repo via `Promise.all` + `Bun.spawn`:
  - `git status --porcelain=v2 --branch` — staged/unstaged/untracked/conflicts + branch tracking
  - `git rev-list --count @{u}..HEAD` — ahead count
  - `git rev-list --count HEAD..@{u}` — behind count
  - `git stash list --format=%gd:%gs` — stash entries
  - `git log -1 --format=%H:%s:%at` — HEAD commit info
- Parse all output into `RepoStatus`
- Handle repos with no remote (upstream commands fail gracefully)
- Return `Result<RepoStatus, GitError>`

**1.4 Git graph capture** (`git-graph.ts`)
- Run `git log --graph --all --decorate --color=always --oneline -n <limit>` (default limit: 40)
- Capture raw ANSI output as string array
- Return `Result<GitGraphOutput, GitError>`
- On-demand only — called when repo is selected

**1.5 Git stats** (`git-stats.ts`)
- Run on-demand per repo (too expensive for all repos):
  - `git shortlog -sn --all` — contributor count + names
  - `git count-objects -vH` — repo size
  - `git tag --list --sort=-version:refname` — tags
  - `git log --oneline --since="7 days ago"` — recent activity
  - `git branch -a` — full branch list with tracking info
  - `git log -5 --format=%h:%s:%an:%at` — last 5 commits for recent list
- Return `Result<ExtendedStats, GitError>`

**Total Phase 1: ~610 LOC, 5 agents in parallel**

---

### Phase 1.5: Core Integration + Tests (sequential)
*Wire scanner + status together. Integration tests.*

| Task | Files | Est. LOC | Deps |
|------|-------|----------|------|
| 1.5.1 Core orchestrator | `core/src/index.ts` | 100 | Phase 1 |
| 1.5.2 Test helpers | `core/__tests__/helpers.ts` | 120 | Phase 1 |
| 1.5.3 Integration tests | `core/__tests__/integration/scanner.test.ts`, `git-status.test.ts` | 200 | 1.5.1, 1.5.2 |

**Test strategy:**
- Create temporary git repos with `Bun.spawn(["git", "init"])` in a temp directory
- Add commits, branches, modify files to create known states
- Run scanner + status collector against temp directory
- Assert on `RepoStatus` fields
- Cleanup temp dirs in afterAll

**Total Phase 1.5: ~420 LOC, 1 agent, sequential**

---

### Phase 2: TUI Components (parallel)
*All UI components. No wiring between them yet.*

| Task | Files | Est. LOC | Deps | Parallel? |
|------|-------|----------|------|-----------|
| 2.1 Repo list component | `render/src/components/repo-list.tsx`, `status-badge.tsx` | 250 | Phase 0 | Yes |
| 2.2 Git graph panel | `render/src/components/git-graph.tsx` | 100 | Phase 0 | Yes |
| 2.3 Stats panel | `render/src/components/stats-panel.tsx` | 200 | Phase 0 | Yes |
| 2.4 Status bar | `render/src/components/status-bar.tsx` | 80 | Phase 0 | Yes |
| 2.5 Config loader | `render/src/config/loader.ts`, `types.ts` | 100 | Phase 0 | Yes |

**Task details:**

**2.1 Repo list component** (`repo-list.tsx`, `status-badge.tsx`)
- Hierarchical tree view with indent levels
- Collapsible directories (Enter to toggle)
- Status badges right-aligned per repo (see badge legend above)
- j/k/up/down navigation with visible cursor
- g/G for first/last
- Scroll indicator when list exceeds viewport
- Uses opentui `<box>` with manual list rendering (not `<select>` — opentui's `<select>` doesn't support tree rendering with indentation/collapsing, so custom list with `<box>` + manual keyboard handling is correct)
- `status-badge.tsx`: Pure component that renders the colored status indicator

**2.2 Git graph panel** (`git-graph.tsx`)
- Renders `GitGraphOutput.lines` as `<text>` elements inside a `<scrollbox>`
- `<scrollbox>` has native j/k, arrow keys, Page Up/Down, Home/End when focused — no manual keyboard scroll handling needed, just pass `focused` prop
- Box-drawing header with repo name
- Shows "(loading...)" placeholder, "(no graph)" for empty repos
- Truncates lines to panel width

**2.3 Stats panel** (`stats-panel.tsx`)
- Two sections: summary stats (always visible) and detailed stats (scroll for more)
- Summary: branch, remote, ahead/behind, modified/staged/untracked/conflicts, stash count
- Detail: recent commits, branches, tags, contributors, repo size
- Adapts to available height — shows most important info first
- "Clean" state shows a centered checkmark with "Everything clean"

**2.4 Status bar** (`status-bar.tsx`)
- Mode indicator: [NORMAL], [DETAIL], [FILTER], [SEARCH]
- Keybinding hints (context-sensitive)
- Global summary: "3 dirty, 2 ahead" or "all 28 repos clean"
- Error/success messages (flash, auto-clear)
- Command mode with `:` prefix

**2.5 Config loader** (`config/loader.ts`, `config/types.ts`)
- Reads `~/.config/overview/config.toml`
- Falls back to defaults if not present
- Validates with Zod `OverviewConfig` schema
- CLI args override config file values
- Writes default config on first run

**Total Phase 2: ~730 LOC, 5 agents in parallel**

---

### Phase 3: Main Screen + Wiring (sequential)
*Connect components, keyboard handling, data flow.*

| Task | Files | Est. LOC | Deps |
|------|-------|----------|------|
| 3.1 Main screen layout | `render/src/screens/main-screen.tsx` | 300 | Phase 1.5, Phase 2 |
| 3.2 App entry point | `render/src/overview.tsx` | 200 | 3.1 |
| 3.3 CLI argument parsing | `render/src/overview.tsx` (augment) | 50 | 3.2 |
| 3.4 Format utilities | `render/src/lib/format.ts` | 60 | Phase 0 |

**Task details:**

**3.1 Main screen layout** (`main-screen.tsx`)
- Split-pane layout with configurable ratios
- Left panel: `<RepoList>` with full repo tree
- Right-top: `<GitGraph>` updating on selection change
- Right-bottom: `<StatsPanel>` updating on selection change
- Bottom: `<StatusBar>`
- Focus management: left panel focused by default, h/l to switch panels
- Selection change triggers on-demand git graph + stats fetch
- Loading states while fetching

**3.2 App entry point** (`overview.tsx`)
- Initialize scanner with config
- Run initial scan, populate signals
- Set up background refresh interval
- Set up file watcher
- Handle subprocess launches (ggi, nvim, tmux)
- Global keyboard handler (quit, help, command mode)

**3.3 CLI argument parsing**
- `--dir <path>` — override scan directory (default from config)
- `--depth <n>` — override scan depth (default 3)
- `--sort <name|status|last-commit>` — override sort
- `--filter <all|dirty|clean|ahead|behind>` — override filter
- Parse with manual `Bun.argv` handling (no dependency needed for this few args)

**Total Phase 3: ~610 LOC, 1 agent, sequential**

---

### Phase 4: Actions + Polish (parallel)
*Subprocess integration, search/filter, file watching.*

| Task | Files | Est. LOC | Deps | Parallel? |
|------|-------|----------|------|-----------|
| 4.1 Subprocess actions | `render/src/lib/actions.ts` | 100 | Phase 3 | Yes |
| 4.2 Search + filter | `render/src/lib/filter.ts`, update `repo-list.tsx` | 120 | Phase 3 | Yes |
| 4.3 File watcher | `core/src/watcher.ts` | 80 | Phase 3 | Yes |
| 4.4 Help overlay | `render/src/components/help-overlay.tsx` | 80 | Phase 3 | Yes |

**Task details:**

**4.1 Subprocess actions** (`actions.ts`)
- `launchGgi(repo_path)`: Stop renderer, spawn ggi, restart renderer on exit
- `launchEditor(repo_path)`: Same pattern with `$EDITOR`
- `launchSessionizer(repo_path)`: Spawn tmux-sessionizer script
- All return `Result<void, ActionError>`

**4.2 Search + filter** (`filter.ts`)
- `/` enters search mode: fuzzy match on repo name
- `f` cycles filter: all → dirty → clean → ahead → behind → all
- `s` cycles sort: name → status → last-commit → name
- Filter/sort signals fed into repo list

**4.3 File watcher** (`watcher.ts`)
- `Bun.file.watch` (or `fs.watch`) on `.git/index` for each repo
- Debounce 500ms to batch rapid changes
- On change: re-run `gitStatus()` for that repo, update signal
- Configurable enable/disable

**4.4 Help overlay** (`help-overlay.tsx`)
- Full keybinding reference
- Uses `<Portal>` to render into a separate mount point — cleaner than z-index hacking, avoids layout interference with main screen
- Dismiss with `?` or `q` or `Esc`

**Total Phase 4: ~380 LOC, 4 agents in parallel**

---

### Phase 5: Final Integration + Release Prep (sequential)

| Task | Files | Est. LOC | Deps |
|------|-------|----------|------|
| 5.1 End-to-end testing | `render/__tests__/` | 100 | Phase 4 |
| 5.2 Binary build | `package.json` scripts | 20 | Phase 4 |
| 5.3 Default config generation | `config/loader.ts` update | 40 | Phase 4 |
| 5.4 AGENTS.md | `AGENTS.md` | 80 | Phase 4 |

**5.2 Binary build:**
- `bun build src/overview.tsx --compile --outfile overview` to produce standalone binary
- Or: `bun run src/overview.tsx` for dev mode
- Add to `~/.local/bin/overview` for global access

**Total Phase 5: ~240 LOC, 1 agent, sequential**

---

## Summary

| Phase | LOC | Agents | Strategy |
|-------|-----|--------|----------|
| 0: Scaffold | 430 | 1 | Sequential |
| 1: Core Git | 610 | 5 | Parallel |
| 1.5: Core Tests | 420 | 1 | Sequential |
| 2: TUI Components | 730 | 5 | Parallel |
| 3: Main Screen | 610 | 1 | Sequential |
| 4: Actions + Polish | 380 | 4 | Parallel |
| 5: Final | 240 | 1 | Sequential |
| **Total** | **~3,420** | | |

---

## 9. Critical Decisions

### DECISION NEEDED: Project location

Should this live at `~/dev/overview/` as a standalone project, or should it be added as a package inside hackertui's monorepo?

**Recommendation**: Standalone at `~/dev/overview/`. Rationale:
- Different domain (git health vs. Hacker News browsing)
- Different binary entry point
- Sharing @opentui/solid, corpus, and theme code via npm dependencies is cleaner than monorepo coupling
- Can always extract shared TUI primitives into a package later

### DECISION NEEDED: GitHub integration in v1?

Adding `gh api` calls for PR count and CI status per repo would add ~200 LOC and require rate-limit handling. Recommendation: **defer to v2**. The git-local data alone provides enormous value, and gh integration can be added as a Phase 5 task later.

### DECISION NEEDED: SQLite caching?

`pulse` in future-ideas.md suggested SQLite/Drizzle for caching. For overview v1, all data is fetched fresh on each scan (~1.5s for 28 repos in parallel). Caching adds complexity without clear benefit at this scale.

**Recommendation**: No database in v1. If scanning becomes slow (100+ repos, network git remotes), add SQLite caching in v2.

### DECISION NEEDED: @opentui/solid ANSI rendering

The git graph panel renders raw ANSI escape sequences from `git log --graph --color=always`. Need to verify that opentui's `<text>` component passes through ANSI codes correctly. While opentui has an `ansi.ts` module in core, raw ANSI passthrough in `<text>` children is **not a documented feature**. hackertui doesn't render raw ANSI (it uses its own theme colors).

**Mitigation**: If opentui strips ANSI, we have three fallbacks:
1. Parse ANSI codes and convert to opentui style props (moderate effort, ~100 LOC)
2. Use `--color=never` and colorize based on parsed content (easier but less faithful)
3. Use opentui's `<code>` component with a custom Tree-sitter grammar for colorized git output (most complex option, but leverages opentui's built-in syntax highlighting infrastructure)

This should be tested in Phase 0 as a spike before committing to the git graph approach. **This spike is critical** — it determines the rendering strategy for the entire right-top panel.

---

## 10. Testing Strategy

### Integration tests (core package)

```
core/__tests__/
├── helpers.ts                    # createTempRepo(), addCommit(), createBranch(), etc.
├── integration/
│   ├── scanner.test.ts           # Scan temp dirs, verify RepoNode tree
│   ├── git-status.test.ts        # Create repos with known state, verify RepoStatus
│   └── worktree.test.ts          # Create worktrees, verify grouping
```

**Test helpers** create real git repos in temp directories — no mocking. This is the correct approach because:
1. Git operations are inherently filesystem + subprocess operations
2. Mocking `Bun.spawn` would be testing our mock, not our code
3. Real git repos in temp dirs are fast (~50ms to create) and deterministic
4. Cleanup is trivial (`rm -rf tmpdir`)

### What NOT to test

- opentui rendering (framework concern, tested by framework)
- Individual component rendering (visual, verified manually)
- git's own output format (stable, tested by git)

### What TO test

- Scanner correctly discovers repos at various depths
- Scanner ignores directories matching ignore patterns
- Worktree detection groups worktrees correctly
- Status parser handles all edge cases (no remote, detached HEAD, conflicts, bare repos)
- Config loader validates and applies defaults correctly
- Filter/sort logic produces correct ordering

---

## 11. Future Work (Out of Scope for v1)

1. **GitHub integration**: PR count, CI status, issue count per repo via `gh api`
2. **Dependency ripple view**: Show downstream projects affected by changes (from `pulse` concept)
3. **Sketchybar widget**: `overview --check` for status bar icon
4. **tmux persistent pane**: Run as a dedicated tmux window that auto-refreshes
5. **Multi-directory support**: Scan multiple roots (e.g., `~/dev` + `~/workplace`)
6. **Repo grouping**: Group by language, org, or custom tags
7. **Commit diff preview**: Show diff preview in stats panel (leveraging ggi's --show pattern)
8. **Bulk actions**: Push all, pull all, stash all

---

## Suggested AGENTS.md Updates

After this project is created, the following `AGENTS.md` should be placed at `~/dev/overview/AGENTS.md`:

```markdown
# overview — Multi-Repo Git Health Dashboard

## Build & Run
- Dev mode: `bun run dev` (from packages/render)
- Build binary: `bun build packages/render/src/overview.tsx --compile --outfile overview`
- Test: `bun test` (from root)
- Typecheck: `bun run typecheck`

## Architecture
- `packages/core/` — Git operations, scanning, no UI dependencies
- `packages/render/` — opentui/solid TUI components and screens
- No schema package — types live in `core/src/types.ts`

## Key Patterns
- Git operations use `Bun.spawn` with `Result<T, E>` return types
- All git commands run in parallel per repo via `Promise.all`
- Git graph panel renders raw ANSI output from `git log --graph --color=always`
- Subprocess actions (ggi, nvim) stop the renderer, take over stdin/stdout, restart on exit
- Config lives at `~/.config/overview/config.toml`
- Theme system copied from hackertui — Tokyo Night default

## Code Style
- snake_case variables, camelCase functions, PascalCase types
- Result<T, E> from @f0rbit/corpus — never throw, never try/catch
- Early returns over if/else
- No comments except complex logic

## Testing
- Integration tests create real git repos in temp directories
- No mocking of git operations
- Test via `core/` package — verify scanner, status, worktree detection
```
