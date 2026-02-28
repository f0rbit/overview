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

## 8. Completion Status

All planned phases are complete:

- ✅ Phase 0: Scaffold
- ✅ Phase 1: Core Git Operations (scanner, worktree, git-status, git-graph, git-stats)
- ✅ Phase 1.5: Core Integration + Tests
- ✅ Phase 2: TUI Components (repo-list, git-graph, widget-container, status-bar, config loader)
- ✅ Phase 3: Main Screen + Wiring
- ✅ Phase 4: Actions + Polish (subprocess actions, filter/sort, file watcher, help overlay)
- ✅ Phase 5: Final Integration + Release (binary build, default config, AGENTS.md, integration tests)

### Decisions Resolved
- Project location: standalone at `~/dev/overview/` ✅
- GitHub integration: included in v1 via widget system (gh CLI widgets) ✅
- No SQLite caching — fresh scan each time ✅
- ANSI rendering: git graph uses `--color=always` output rendered directly ✅
