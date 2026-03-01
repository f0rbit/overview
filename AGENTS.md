# AGENTS.md — overview

## Project Overview

Multi-repo git health dashboard TUI built with Bun + @opentui/solid + SolidJS.

### Package Structure

```
packages/
├── core/           # @overview/core — git operations, scanning, data collection
│   └── src/
│       ├── index.ts          # barrel + orchestrator (scanAndCollect)
│       ├── types.ts          # WidgetId, WidgetSpan, WidgetSizeHint, WidgetConfig, RepoStatus
│       ├── scanner.ts        # directory tree walker, repo discovery
│       ├── worktree.ts       # git worktree detection & grouping
│       ├── git-status.ts     # per-repo status collection (Bun.spawn)
│       ├── git-graph.ts      # git log --graph capture
│       ├── git-stats.ts      # heavyweight stats (contributors, size, tags)
│       ├── concurrency.ts    # createPool(n) semaphore for subprocess limiting
│       └── watcher.ts        # fs.watch on .git dirs for live updates
└── render/         # @overview/render — TUI components, screens, theming
    └── src/
        ├── overview.tsx              # entry point
        ├── screens/main-screen.tsx   # primary split-pane screen
        ├── components/
        │   ├── widget-container.tsx   # grid layout + scroll-to-focused
        │   ├── repo-list.tsx          # left panel hierarchical repo list
        │   ├── git-graph.tsx          # right-top git graph viewer
        │   ├── status-bar.tsx         # bottom status bar
        │   ├── help-overlay.tsx       # keybinding reference overlay
        │   └── widgets/               # 12 widget components + registry
        ├── lib/
        │   ├── widget-grid.ts         # pure grid layout + border computation
        │   ├── widget-state.ts        # widget config persistence (~/.config/overview/widgets.json)
        │   ├── filter.ts              # repo filtering/sorting
        │   ├── fetch-context.ts    # createFetchContext + InFlightDedup for request dedup
        │   ├── format.ts              # text formatting utilities
        │   └── actions.ts             # subprocess launchers (ggi, editor, sessionizer)
        ├── theme/index.ts             # Tokyo Night color palette
        └── config/index.ts            # JSON config loader + CLI args
```

### Entry Points

- **Dev:** `bun run packages/render/src/overview.tsx`
- **Build:** `bun run build` (from repo root) → produces `./overview` binary
- **Tests:** `bun test` from `packages/render/`

### Config Files

- `~/.config/overview/config.json` — main app config (scan dirs, depth, sort, filter)
- `~/.config/overview/widgets.json` — widget enable/disable, priority, collapsed state

## Key Conventions

### opentui/solid

- **`<text>` only accepts `content` prop** — `<text content={str} />`, NOT `<text>{str}</text>`
- **`<scrollbox>` must NOT have `flexDirection` prop** — known opentui bug. Wrap children in `<box flexDirection="column">` inside the scrollbox.
- **`overflow` defaults to `"visible"`** — use `overflow="hidden"` to clip children
- **`border` prop** accepts `boolean | BorderSides[]` where `BorderSides = "top" | "right" | "bottom" | "left"`
- **`border={["left", "right"]}` works correctly** for multi-line content
- **Manual `<text content="│" />` in flex row does NOT work** for multi-line borders — only renders on the first line
- **`BorderChars`** from `@opentui/core` — `BorderChars.rounded` has: `╭╮╰╯─│┬┴├┤┼`
- **`el.y` is screen-absolute**, not relative to parent/scrollbox. To get content-relative position inside a scrollbox: `content_y = el.y - scrollbox_ref.content.y`
- **ScrollBox internals:** `scrollHeight` = `content.height` (yoga computed). Clamped to `[0, scrollHeight - viewport.height]` via `Math.round`.
- **Default flexShrink:** elements without explicit width/height get `flexShrink: 1`. Elements with numeric width/height get `flexShrink: 0`.

### Widget System

- **12 widgets** registered in `src/components/widgets/` with side-effect imports in `index.ts`
- Widget registration: `registerWidget({ id, label, size_hint, component })`
- **`WidgetSizeHint`** has `span: "full" | "half" | "auto"` and `min_height: number`
- **No `allocated_rows`** — widgets self-size, scrollbox handles overflow
- **Grid layout** computed by pure functions in `widget-grid.ts` (`computeRows`, `buildBorderLine`, etc.)
- **Shared borders** — widgets only draw left/right borders; horizontal borders are `<text>` elements with junction characters

### Error Handling

- **@f0rbit/corpus** Result types: `ok()`, `err()`, `Result<T,E>`, `pipe()`, `try_catch_async()`
- Never throw — always return Result types from core functions

### Subprocesses

- **`Bun.spawn`** for all git operations — NOT `child_process`
- Subprocess actions (ggi, editor, sessionizer) use `renderer.suspend()` / `renderer.resume()` pattern

### Performance Patterns

- **Debounce + cancellation:** Repo selection in `main-screen.tsx` uses 250ms debounce with request ID cancellation. Never fire async work directly from `createEffect` without cancellation — stale results will overwrite fresh ones.
- **Request ID pattern:** Since `Bun.spawn` doesn't support `AbortSignal`, use an incrementing request ID counter. After `await`, check if the ID still matches before applying results. Manual refresh (`r` key) bypasses debounce by calling `fetchDetails` directly.
- **Fetch deduplication:** Hooks instantiated by multiple widgets (`useGithub`, `useDevpad`) use `InFlightDedup` from `fetch-context.ts` to prevent duplicate concurrent fetches for the same key.
- **Concurrency limiting:** Use `createPool(n)` from `@overview/core/concurrency` when spawning subprocesses in bulk. Default: `pool(8)` for `populateNode` during scan.
- **Version counter for mutations:** When mutating objects in-place (e.g., `updateRepoStatus`), bump a version signal instead of cloning arrays. This triggers `createMemo` recomputation without creating new references.

### Testing

- **Test runner:** `bun test` from `packages/render/`
- **Preload:** `@opentui/solid/preload` in `bunfig.toml`
- **Unit tests:** Pure function tests in `src/lib/__tests__/` — no `testRender` needed
- **Integration tests:** Use `testRender` from `@opentui/solid` with `renderOnce()`, `captureCharFrame()`, `mockInput`
- **Mock keyboard:** `mockInput.pressKey("j")` — must call `renderOnce()` after for state updates
- Devpad widgets will show error/loading in tests (no API available) — expected behavior

## Gotchas

1. **Scrollbox content height with nested layouts:** The scrollbox's `content.y` includes ancestor offsets. Always use `el.y - scrollbox_ref.content.y` for content-relative coordinates, never `el.y + scrollTop`.

2. **`flexShrink={0}` on scrollbox content wrapper:** The `<box>` inside `<scrollbox>` needs `flexShrink={0}` so yoga doesn't collapse its height. Without this, `scrollHeight` will be wrong.

3. **Widget config persistence:** Widget configs are stored separately from main config in `~/.config/overview/widgets.json`. The `widget-state.ts` module handles load/save with defaults for missing widgets.

4. **GitHub widgets:** Show placeholder text when `gh` CLI is unavailable — NOT silently disabled.

5. **Devpad integration:** Uses `@devpad/api` TypeScript client as a link dependency. The `useDevpad` hook fetches data via `createEffect` + async — data arrives after initial render, causing widget height changes.

6. **Widget data consolidation:** `commit-activity` data is fetched centrally in `fetchDetails` (main-screen.tsx) and stored on `RepoStatus.commit_activity`, NOT fetched independently by the widget. All heavyweight per-repo fetches should go through `fetchDetails` to benefit from debounce + cancellation.
