# Plan: Per-Repo OpenCode (ocn) Status Badge

## Executive Summary

Add per-repo OpenCode session status indicators to the repo list. The `ocn` system writes JSON state files to `~/.local/state/ocn/<pid>.json` — we read those files, match them to repos by directory path, and display a single-character badge in the `StatusBadge` component.

Three files in `@overview/core`, two files in `@overview/render`. ~150 LOC total. No new dependencies.

## Integration Point Analysis

### Files Modified

| File | Change | Impact |
|------|--------|--------|
| `packages/core/src/types.ts` | Add `OcnStatus` type + `ocn_status` field to `RepoStatus` | Cascades to all RepoStatus consumers — safe, additive field (nullable) |
| `packages/core/src/ocn.ts` | **New file.** Read ocn state dir, parse JSON, PID liveness check | No downstream impact — new module |
| `packages/core/src/index.ts` | Re-export `ocn.ts`, call `readOcnStates()` in `populateNode()` | Minimal change to orchestrator |
| `packages/render/src/components/status-badge.tsx` | Add ocn indicator to `buildBadgeParts()` | Additive — new badge part when ocn session active |
| `packages/render/src/theme/index.ts` | Add `ocn` colors to `status` block | Additive |

### What does NOT change

- `git-status.ts` — ocn is not git data; keeping it separate follows the pattern of `github.ts` and `devpad.ts` as standalone data sources
- `main-screen.tsx` — ocn status is collected during scan, not during `fetchDetails` (it's cheap enough to do upfront)
- `repo-list.tsx` — already renders `<StatusBadge status={node.status} />`, no changes needed

### Breaking Changes

None. `ocn_status` is added as `OcnStatus | null` defaulting to `null`. Existing code that reads `RepoStatus` is unaffected.

## Design Decisions

### 1. Collect during scan, not fetchDetails

The ocn state directory contains a handful of tiny JSON files (one per running OpenCode instance). Reading them all takes <1ms. Rather than fetching per-repo on selection, we read all state files once during `scanAndCollect`, build a `Map<directory, OcnStatus>`, and assign matches during `populateNode`. This avoids complexity and keeps the data available for all repos immediately.

### 2. Separate module, not inside git-status.ts

`git-status.ts` is purely git operations via `Bun.spawn`. ocn is file I/O. Following the pattern of `github.ts` and `devpad.ts` as separate data source modules.

### 3. Badge position and characters

The ocn indicator prepends to the badge parts list (appears leftmost, before git status). Single character, only shown for non-idle states:

| Status | Char | Color | Rationale |
|--------|------|-------|-----------|
| `busy` | `*` | `theme.yellow` | Conventional "activity" indicator |
| `prompting` | `>` | `theme.magenta` | "Needs input" — attention-grabbing |
| `error` | `!` | `theme.red` | Reuses conflict convention |
| `idle` | (none) | — | No visual noise for idle sessions |

### 4. PID liveness check

Use `process.kill(pid, 0)` — signal 0 doesn't kill the process, just checks existence. Wrapped in try/catch (throws if PID doesn't exist). Stale files are filtered out during read.

### 5. State directory

Default: `~/.local/state/ocn/`. Override with `OCN_STATE_DIR` env var. No config file option needed (env var is sufficient for this niche case).

### 6. Live updates via fs.watch (optional, deferred)

Watching the ocn state directory for changes would enable live badge updates without re-scanning. This is straightforward but NOT included in this plan — the badges update on every scan/refresh (`R` key), which is sufficient for v1. Can be added later by watching the state dir in `main-screen.tsx` alongside the existing `createRepoWatcher`.

## Detailed Design

### OcnStatus type (`types.ts`)

```typescript
export type OcnSessionStatus = "idle" | "busy" | "prompting" | "error";

export interface OcnStatus {
    pid: number;
    status: OcnSessionStatus;
    session_id: string;
}
```

### ocn.ts module

```typescript
// Error type
export type OcnError =
    | { kind: "state_dir_not_found" }
    | { kind: "read_failed"; path: string; cause: string };

// State file shape (what ocn writes)
interface OcnStateFile {
    pid: number;
    directory: string;
    project: string;
    status: OcnSessionStatus;
    last_transition: string;
    session_id: string;
}

// Read all state files, filter stale PIDs, return Map<directory, OcnStatus>
export async function readOcnStates(): Promise<Result<Map<string, OcnStatus>, OcnError>>
```

### Integration in `index.ts`

In `scanAndCollect`, call `readOcnStates()` once before populating nodes. Pass the resulting map into `populateNode`. During population, look up each repo's path in the map.

### Badge rendering (`status-badge.tsx`)

In `buildBadgeParts()`, check `status.ocn_status`. If present and not idle, prepend a badge part with the appropriate character and color.

## Task Breakdown

### Phase 1: Core types + ocn reader (sequential — foundation)

#### Task 1.1: Add OcnStatus type to types.ts
- **Files:** `packages/core/src/types.ts`
- **LOC:** ~10
- **Work:** Add `OcnSessionStatus` type alias, `OcnStatus` interface, add `ocn_status: OcnStatus | null` field to `RepoStatus`

#### Task 1.2: Create ocn.ts module
- **Files:** `packages/core/src/ocn.ts`
- **LOC:** ~70
- **Work:** `readOcnStates()` function — read state dir, parse each JSON file, PID liveness check, build directory-to-status map
- **Dependencies:** Task 1.1 (uses OcnStatus type)

#### Task 1.3: Wire ocn into scan orchestrator
- **Files:** `packages/core/src/index.ts`, `packages/core/src/git-status.ts`
- **LOC:** ~15
- **Work:**
  - Add `export * from "./ocn"` to index.ts
  - Call `readOcnStates()` in `scanAndCollect()`, pass map to `populateNode()`
  - In `populateNode()`, look up `ocn_map.get(node.path)` and assign to `node.status.ocn_status`
  - Add `ocn_status: null` default in `collectStatus()` return value
- **Dependencies:** Task 1.1, Task 1.2

**All three tasks are sequential** (1.1 → 1.2 → 1.3) since each depends on the prior.

→ **Verification:** typecheck, commit

### Phase 2: Render integration (parallel-safe — single task)

#### Task 2.1: Add ocn badge rendering
- **Files:** `packages/render/src/components/status-badge.tsx`, `packages/render/src/theme/index.ts`
- **LOC:** ~20
- **Work:**
  - Add `ocn_busy`, `ocn_prompting`, `ocn_error` colors to theme (can reuse existing colors: yellow, magenta, red)
  - In `buildBadgeParts()`, check `status.ocn_status` at the top, prepend badge part for busy/prompting/error
- **Dependencies:** Phase 1 complete (needs `ocn_status` field on RepoStatus)

→ **Verification:** typecheck, test (existing tests should still pass), commit

### Phase 3: Tests

#### Task 3.1: Unit tests for ocn.ts
- **Files:** `packages/core/src/__tests__/ocn.test.ts` (new)
- **LOC:** ~50
- **Work:**
  - Test `readOcnStates()` with a temp directory containing mock state files
  - Test PID liveness filtering (use current PID as "alive", fake PID as "stale")
  - Test missing/malformed JSON files are skipped gracefully
  - Test empty directory returns empty map
  - Test `OCN_STATE_DIR` env var override
- **Dependencies:** Phase 1 complete

#### Task 3.2: Unit test for badge rendering with ocn status
- **Files:** `packages/render/src/lib/__tests__/status-badge.test.ts` (new)
- **LOC:** ~30
- **Work:**
  - Test `buildBadgeParts()` with various `ocn_status` values
  - Verify busy → `*` yellow, prompting → `>` magenta, error → `!` red, idle → no ocn part
  - Test that ocn part prepends (appears before git status parts)
- **Dependencies:** Phase 2 complete
- Note: `buildBadgeParts` needs to be exported for testing

→ **Verification:** typecheck, test, commit

## Effort Summary

| Phase | Tasks | LOC | Parallel |
|-------|-------|-----|----------|
| 1 | 3 (sequential) | ~95 | No |
| 2 | 1 | ~20 | N/A |
| 3 | 2 (parallel) | ~80 | Yes |
| **Total** | **6** | **~195** | |

## File Inventory

### New Files
- `packages/core/src/ocn.ts`
- `packages/core/src/__tests__/ocn.test.ts`
- `packages/render/src/lib/__tests__/status-badge.test.ts`

### Modified Files
- `packages/core/src/types.ts`
- `packages/core/src/index.ts`
- `packages/core/src/git-status.ts`
- `packages/render/src/components/status-badge.tsx`
- `packages/render/src/theme/index.ts`

## Suggested AGENTS.md Updates

After implementation, add to the "Widget data consolidation" section or create an "External data sources" section:

```markdown
### External Data Sources Pattern

- **GitHub/Devpad data:** Fetched per-repo on selection via `fetchDetails` (expensive, network I/O)
- **ocn status:** Collected once during scan via `readOcnStates()` (cheap, local file I/O). Assigned during `populateNode`. Default state dir: `~/.local/state/ocn/`, override with `OCN_STATE_DIR` env var.
- Pattern: cheap local data sources collect during scan; expensive/network sources collect on selection.
```
