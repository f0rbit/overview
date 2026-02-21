# overview

A terminal UI that scans a directory tree for git repositories, displays them in a hierarchical list with per-repo health indicators, and provides a split-pane detail view with an embedded git graph and stats panel.

## Why use this

If you work across many git repositories, it is hard to know which ones have uncommitted changes, unpushed commits, or are behind their remote. `overview` gives you a single dashboard that answers "what is the state of all my repos?" at a glance, with the ability to drill into any repo for its full commit graph and metadata -- or launch directly into your editor, ggi, or a tmux session.

## Interface

Three-panel split layout: a hierarchical repo list on the left, a git graph (top-right), and a stats panel (bottom-right). The repo list shows inline health badges -- selecting a repo loads its graph and stats on demand.

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

### Status badges

| Badge | Meaning |
|-------|---------|
| `✓` | Clean -- nothing to commit, up to date with remote |
| `↑3` | 3 commits ahead (unpushed) |
| `↓2` | 2 commits behind remote |
| `↑3↓2` | Diverged -- ahead and behind |
| `~3` | 3 uncommitted changes |
| `!` | Merge conflicts present |
| `?` | Untracked files only |
| `✂` | Has stashed changes |

## Install and run

Requires [Bun](https://bun.sh) >= 1.0 and `git`. Optional: `fzf` + `delta` for [ggi](https://github.com/f0rbit/ggi) integration.

```sh
# clone and install
git clone https://github.com/f0rbit/overview.git
cd overview
bun install

# run in dev mode
bun run dev

# or compile a standalone binary
bun run build
./overview
```

### Configuration

Config lives at `~/.config/overview/config.toml`. A default is created on first run. Key options:

```toml
scan_dirs = ["~/dev"]
depth = 3
refresh_interval = 30
sort = "name"           # name | status | last-commit
filter = "all"          # all | dirty | clean | ahead | behind

[layout]
left_width_pct = 35
graph_height_pct = 45

[actions]
ggi = "ggi"
editor = "$EDITOR"
sessionizer = ""        # path to tmux-sessionizer script
```

CLI flags override config values:

```sh
overview --dir ~/workplace --depth 2 --sort status --filter dirty
```

## Keybindings

### Normal mode

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate repo list |
| `Enter` | Enter detail mode (focus right panels) |
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
| `j` / `k` | Scroll focused panel |
| `h` / `l` | Switch between graph and stats panels |
| `g` | Launch ggi |
| `o` | Open in `$EDITOR` |
| `t` | Open tmux session |
| `r` | Refresh details |
| `q` / `Esc` | Back to normal mode |

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
│   │       ├── watcher.ts       # fs.watch on .git dirs for live updates
│   │       └── types.ts         # core data model
│   └── render/         # TUI components, screens, theming
│       └── src/
│           ├── overview.tsx      # entry point
│           ├── screens/
│           ├── components/
│           ├── lib/
│           ├── config/
│           └── theme/            # Tokyo Night color scheme
├── package.json
└── tsconfig.json
```

Data flows one direction: `core` scans and collects git data, `render` subscribes to it via SolidJS signals. The git graph panel renders `git log --graph --color=always` output directly -- no DAG parsing. Press `g` to launch ggi for interactive graph exploration (suspends the TUI, resumes on exit).

## Dependencies

### Runtime

| Dependency | Purpose |
|------------|---------|
| [Bun](https://bun.sh) | Runtime, bundler, test runner |
| [@opentui/solid](https://github.com/anomalyco/opentui) | TUI rendering framework ([docs](https://opentui.com)) |
| [SolidJS](https://www.solidjs.com/) | Reactive UI primitives |
| [@f0rbit/corpus](https://github.com/f0rbit/corpus) | `Result<T, E>` error handling -- no thrown exceptions |

### System (optional)

| Tool | Purpose |
|------|---------|
| `git` | Core data source (required) |
| [`fzf`](https://github.com/junegunn/fzf) | Interactive filtering for ggi integration |
| [`delta`](https://github.com/dandavison/delta) | Diff rendering for ggi integration |

### Dev

| Dependency | Purpose |
|------------|---------|
| TypeScript | Type checking |
| [Biome](https://biomejs.dev/) | Linting and formatting |

## License

MIT
