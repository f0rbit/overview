# overview

A terminal UI that scans a directory tree for git repositories, displays them in a hierarchical list with per-repo health indicators, and provides a split-pane detail view with an embedded git graph and widget-based stats panel.

## Why use this

If you work across many git repositories, it is hard to know which ones have uncommitted changes, unpushed commits, or are behind their remote. `overview` gives you a single dashboard that answers "what is the state of all my repos?" at a glance, with the ability to drill into any repo for its full commit graph and metadata -- or launch directly into your editor, ggi, or a tmux session.

## Interface

Three-panel split layout: a hierarchical repo list on the left, a git graph (top-right), and a scrollable widget panel (bottom-right). The repo list shows inline health badges -- selecting a repo loads its graph and widgets on demand.

```
┌─ overview ──────────────────── ~/dev ──── 28 repos ── scanning... ──┐
│                                                                     │
├─────────────────────────┬───────────────────────────────────────────┤
│  ~/dev                  │ ┌─ git graph ───────────────────────────┐ │
│  ├── algorithms/     ✓  │ │ * 4a2f1c3 (HEAD -> main) fix: t...     │ │
│  ├── bases.nvim/     ✓  │ │ * 8b3e2d1 feat: add treesitter...      │ │
│  ├── burning-blends/ ✓  │ │ * c7f9a0e refactor: extract pa...      │ │
│  ├── byron-kastelic/ ✓  │ │ | * 2d4e6f8 (origin/dev) wip:...       │ │
│  ├── chamber/       ↑3  │ │ | |/                                  │ │
│  ├── corpus/        ↑1  │ │ * | a1b2c3d merge: dev into m...       │ │
│  ├── cs-club-websit… ✓  │ │ |\ \                                  │ │
│  ├── database/       ✓  │ │ | * 5f6g7h8 fix: query perfor...       │ │
│  ├── dev-blog-go/    ✓  │ │ * | 9i0j1k2 chore: bump deps          │ │
│  ├── dev-blog/       ✓  │ │ |/                                    │ │
│  ├── devpad/      * ↑2  │ │ * l3m4n5o v2.1.0 release              │ │
│ >├── dotfiles/      ~3  │ │                                       │ │
│  ├── forbit-astro/   ✓  │ └───────────────────────────────────────┘ │
│  ├── gallery/        ✓  │ ┌─ widgets: dotfiles ──────────────────┐  │
│  ├── gm-server/      ✓  │ │                                      │  │
│  ├── hackertui/     ↑1  │ │  branch   main                       │  │
│  ├── key-grip/       ✓  │ │  remote   origin (github.com/...)     │  │
│  ├── media-timeline/ ✓  │ │                                      │  │
│  ├── mycelia/        ✓  │ │  ~ 3 modified  + 0 staged            │  │
│  ├── ocn/            ✓  │ │  ? 1 untracked  ! 0 conflicts        │  │
│  ├── rollette/       ✓  │ │                                      │  │
│  ├── runbook/     > ↑5  │ │  last commit  2h ago                 │  │
│  ├── studdy-buddy/   ✓  │ │  contributors 3                      │  │
│  ├── todo-tracker/   ✓  │ │  branches     4 local / 6 remote     │  │
│  └── ui/            ↑1  │ │  tags         v1.0, v1.1, v2.0       │  │
│                         │ │                                      │  │
│                         │ └──────────────────────────────────────┘  │
├─────────────────────────┴───────────────────────────────────────────┤
│ [NORMAL] j/k:nav  Enter:detail  g:ggi  r:refresh  q:quit  ?:help   │
└─────────────────────────────────────────────────────────────────────┘
```

### Status badges

| Badge | Meaning |
|-------|---------|
| `*` | OpenCode session active (busy) |
| `>` | OpenCode session needs input |
| `!` | OpenCode session errored / merge conflicts |
| `✓` | Clean -- nothing to commit, up to date |
| `↑3` | 3 commits ahead (unpushed) |
| `↓2` | 2 commits behind remote |
| `~3` | 3 uncommitted changes |
| `?` | Untracked files only |

## Install and run

Requires [Bun](https://bun.sh) >= 1.0 and `git`. Optional: `fzf` + `delta` for [ggi](https://github.com/f0rbit/ggi) integration, `gh` CLI for GitHub widgets.

```sh
# run without installing
bunx @f0rbit/overview

# or install globally
bun add -g @f0rbit/overview
overview
```

CLI flags override config values:

```sh
overview --dir ~/workplace --depth 2 --sort status --filter dirty
```

### Development

```sh
git clone https://github.com/f0rbit/overview.git
cd overview
bun install

bun run dev       # run in dev mode
bun run build     # compile standalone binary
./overview
```

### Configuration

Config lives at `~/.config/overview/config.json`. A default is created on first run. Key options:

```json
{
  "scan_dirs": ["~/dev"],
  "depth": 3,
  "refresh_interval": 30,
  "sort": "name",
  "filter": "all",
  "layout": {
    "left_width_pct": 35,
    "graph_height_pct": 45
  },
  "actions": {
    "ggi": "ggi",
    "editor": "$EDITOR",
    "sessionizer": null
  }
}
```

## Keybindings

### Normal mode

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate repo list |
| `Enter` / `l` | Enter detail mode (focus right panels) |
| `Tab` | Cycle focus: list / graph / stats |
| `f` | Cycle filter: all / dirty / clean / ahead / behind |
| `s` | Cycle sort: name / status / last-commit |
| `r` | Refresh selected repo |
| `R` | Full rescan (re-walk directory tree) |
| `g` | Launch ggi in selected repo |
| `o` | Open selected repo in `$EDITOR` |
| `t` | Open tmux session for selected repo |
| `?` | Toggle help overlay |
| `q` / `Esc` | Quit |

### Detail mode

| Key | Action |
|-----|--------|
| `j` / `k` | Scroll focused panel / navigate widgets in stats |
| `h` | Move left (graph, or exit to list if on graph) |
| `l` | Move right (stats) |
| `g` | Launch ggi |
| `o` | Open in `$EDITOR` |
| `t` | Open tmux session |
| `r` | Refresh details |
| `q` / `Esc` | Back to normal mode |

## Widget system

The stats panel is composed of configurable widgets laid out in a responsive grid. Widgets can span the full panel width, half, or a third. Enable/disable and reorder widgets via `~/.config/overview/widgets.json`.

| Widget | Span | Description |
|--------|------|-------------|
| Git Status | third | Working tree status, staged/modified/untracked counts |
| Repo Meta | third | Commits, contributors, repo size, latest tag |
| GitHub CI | third | Recent workflow runs and their status |
| Commit Activity | third | 14-day commit sparkline |
| Latest Release | third | Latest GitHub release and commits since |
| Devpad Milestones | half | Project milestones from devpad |
| GitHub PRs | half | Open pull requests |
| GitHub Issues | half | Open issues |
| File Changes | half | Modified/staged/untracked file list |
| Branches | half | Local and remote branches |
| Devpad Tasks | full | Task list from devpad |

## OpenCode integration

Overview reads [OpenCode](https://github.com/sst/opencode) session state files from `~/.local/state/ocn/` and shows per-repo status indicators in the repo list (`*` busy, `>` needs input, `!` errored). This requires the [ocn](https://github.com/f0rbit/ocn) OpenCode plugin to be installed. Overview works fine without it -- the badges simply won't appear.

## Architecture

Bun workspace monorepo with two packages:

```
overview/
├── packages/
│   ├── core/           # git operations, scanning, file watching
│   │   └── src/
│   │       ├── scanner.ts       # directory tree walker, repo discovery
│   │       ├── worktree.ts      # worktree detection and grouping
│   │       ├── git-status.ts    # parallel status collection via Bun.spawn
│   │       ├── git-graph.ts     # git log --graph capture (ANSI passthrough)
│   │       ├── git-stats.ts     # heavyweight stats (on-demand)
│   │       ├── concurrency.ts   # subprocess pool (capped at 8)
│   │       ├── ocn.ts           # OpenCode session status reader
│   │       ├── watcher.ts       # fs.watch on .git dirs for live updates
│   │       └── types.ts         # core data model
│   └── render/         # TUI components, screens, theming
│       └── src/
│           ├── overview.tsx      # entry point
│           ├── screens/
│           ├── components/       # repo list, git graph, widgets
│           ├── lib/
│           │   ├── widget-grid.ts     # grid layout computation
│           │   ├── widget-state.ts    # widget config persistence
│           │   ├── fetch-context.ts   # request deduplication
│           │   └── filter.ts          # repo filtering/sorting
│           ├── config/
│           └── theme/            # Tokyo Night color scheme
├── package.json
└── tsconfig.json
```

Data flows one direction: `core` scans and collects git data, `render` subscribes to it via SolidJS signals. The git graph panel renders `git log --graph --color=always` output directly -- no DAG parsing. Press `g` to launch ggi for interactive graph exploration (suspends the TUI, resumes on exit).

## Performance

- Debounced repo selection (250ms) with request cancellation
- Capped subprocess concurrency (pool of 8)
- Deduplicated GitHub and Devpad API calls via in-flight tracking
- Memoized computations to avoid redundant re-renders

## Dependencies

### Runtime

| Dependency | Purpose |
|------------|---------|
| [Bun](https://bun.sh) | Runtime, bundler, test runner |
| [@opentui/solid](https://github.com/anomalyco/opentui) | TUI rendering framework ([docs](https://opentui.com)) |
| [SolidJS](https://www.solidjs.com/) | Reactive UI primitives |
| [@f0rbit/corpus](https://github.com/f0rbit/corpus) | `Result<T, E>` error handling -- no thrown exceptions |
| [@devpad/api](https://github.com/f0rbit/devpad) | Devpad project/task management client |

### System (optional)

| Tool | Purpose |
|------|---------|
| `git` | Core data source (required) |
| `gh` | GitHub CLI for PR, issue, CI, and release widgets |
| [`fzf`](https://github.com/junegunn/fzf) | Interactive filtering for ggi integration |
| [`delta`](https://github.com/dandavison/delta) | Diff rendering for ggi integration |

### Dev

| Dependency | Purpose |
|------------|---------|
| TypeScript | Type checking |
| [Biome](https://biomejs.dev/) | Linting and formatting |

## License

MIT
