# Performance Improvements Plan

## Executive Summary

The overview TUI spawns up to **27 subprocesses per repo selection** with zero debounce, zero cancellation, and redundant fetch deduplication. Scrolling through repos with j/k creates hundreds of concurrent processes, causing UI lag, data flicker from stale results, and unnecessary GitHub API consumption.

This plan addresses all 12 identified bottlenecks across 4 phases, from the critical user-facing fix (debounce + cancellation) through startup performance optimizations.

**Expected impact:** Repo selection goes from ~27 subprocesses to ~8 (first visit) or ~1 (cached), with 250ms debounce eliminating rapid-fire spawning entirely.

---

## Phase 1: Debounce + Cancellation (Critical User-Facing Fix)

The single highest-impact change. After this phase, scrolling through repos will feel snappy.

### Task 1.1: Add debounced selection with request cancellation to `main-screen.tsx`

**File:** `packages/render/src/screens/main-screen.tsx`
**LOC:** ~35 changed
**Dependencies:** None
**Risk:** LOW — isolated to one effect, doesn't change any public API

**Current behavior (lines 130-133):**
```tsx
createEffect(() => {
    const node = selectedNode();
    fetchDetails(node);
});
```

Every signal change immediately calls `fetchDetails`, which spawns 7 subprocesses. No cancellation — stale results overwrite fresh ones.

**Implementation:**

1. Add a `request_id` counter (incrementing number) at component scope:
   ```tsx
   let request_id = 0;
   ```

2. Replace the direct `createEffect` with a debounced pattern using `setTimeout`:
   ```tsx
   let debounce_timer: ReturnType<typeof setTimeout> | undefined;

   createEffect(() => {
       const node = selectedNode();
       // Clear any pending debounce
       clearTimeout(debounce_timer);
       // Immediately clear stale data for visual feedback
       if (!node || node.type === "directory") {
           request_id++;
           setGraph(null);
           setGraphLoading(false);
           setStatsLoading(false);
           return;
       }
       setGraphLoading(true);
       setStatsLoading(true);
       debounce_timer = setTimeout(() => {
           fetchDetails(node);
       }, 250);
   });
   ```

3. Add cancellation to `fetchDetails` via request ID:
   ```tsx
   async function fetchDetails(node: RepoNode | null) {
       if (!node || node.type === "directory") {
           setGraph(null);
           return;
       }

       const current_request = ++request_id;

       setGraphLoading(true);
       setStatsLoading(true);

       const [graphResult, statsResult] = await Promise.all([
           captureGraph(node.path),
           collectStats(node.path),
       ]);

       // Stale check — a newer request has been issued
       if (current_request !== request_id) return;

       if (graphResult.ok) setGraph(graphResult.value);
       else setGraph(null);

       if (statsResult.ok && node.status) {
           node.status.tags = statsResult.value.tags;
           node.status.total_commits = statsResult.value.total_commits;
           node.status.repo_size_bytes = statsResult.value.repo_size_bytes;
           node.status.contributor_count = statsResult.value.contributor_count;
           node.status.recent_commits = statsResult.value.recent_commits;
       }

       setGraphLoading(false);
       setStatsLoading(false);
   }
   ```

4. The manual `r` key refresh (lines 209, 292) should bypass debounce and call `fetchDetails` directly (incrementing `request_id` to cancel any pending).

5. Clean up timer in `onCleanup`:
   ```tsx
   onCleanup(() => {
       clearTimeout(debounce_timer);
       watcher.close();
   });
   ```

**Why request ID instead of AbortController:** `Bun.spawn` doesn't support `AbortSignal`. The request ID pattern is simpler and works correctly — stale results are silently discarded after the `await`.

**Test plan:** Unit-testable by extracting the debounce + cancellation logic into a pure helper (see Task 1.2).

---

### Task 1.2: Extract `createDebouncedEffect` utility + unit tests

**File:** `packages/render/src/lib/debounce.ts` (new)
**Test file:** `packages/render/src/lib/__tests__/debounce.test.ts` (new)
**LOC:** ~60 (utility) + ~80 (tests)
**Dependencies:** None (Task 1.1 will use this, but can be developed in parallel)
**Risk:** LOW — pure utility

Extract a reusable debounce + cancellation utility that encapsulates the pattern:

```tsx
// packages/render/src/lib/debounce.ts

export interface DebouncedFetch<T> {
    /** The current request ID for external cancellation checks */
    request_id: () => number;
    /** Trigger a debounced fetch. Returns the incremented request ID. */
    trigger: (fn: () => Promise<T>) => number;
    /** Trigger an immediate fetch (bypass debounce). Returns the incremented request ID. */
    immediate: (fn: () => Promise<T>) => number;
    /** Cancel any pending debounce timer and increment request ID */
    cancel: () => void;
    /** Clean up timers */
    dispose: () => void;
}

export function createDebouncedFetch<T>(
    delay_ms: number,
    on_result: (value: T, request_id: number) => void,
): DebouncedFetch<T> {
    let current_id = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function cancel() {
        clearTimeout(timer);
        current_id++;
    }

    function run(fn: () => Promise<T>): number {
        const my_id = current_id;
        fn().then((value) => {
            if (my_id === current_id) {
                on_result(value, my_id);
            }
        });
        return my_id;
    }

    return {
        request_id: () => current_id,
        trigger(fn) {
            clearTimeout(timer);
            current_id++;
            const id = current_id;
            timer = setTimeout(() => run(fn), delay_ms);
            return id;
        },
        immediate(fn) {
            clearTimeout(timer);
            current_id++;
            return run(fn);
        },
        cancel,
        dispose() {
            clearTimeout(timer);
        },
    };
}
```

**Tests:** Test the cancellation semantics, debounce timing (using `Bun.sleep`), and stale result discarding. Pure function tests — no SolidJS needed.

---

## Phase 2: Fetch Deduplication (Eliminate Redundant Work)

### Task 2.1: Deduplicate GitHub fetches — singleton fetch per repo path

**File:** `packages/render/src/lib/use-github.ts`
**LOC:** ~25 changed
**Dependencies:** Phase 1 complete
**Risk:** LOW — internal to the hook, no public API changes
**Parallel:** Can run in parallel with Task 2.2, 2.3, 2.4

**Problem (lines 52-56):** 4 widget instances each call `useGithub()` independently. They each check the cache, find it empty (first visit), and all 4 fire `collectGithubData`. The cache eventually gets set, but by then all 4 are already in-flight. Worst case: 16 `gh` CLI subprocesses.

**Implementation:** Add an in-flight deduplication map. If a fetch for a given key is already in progress, return the existing promise instead of starting a new one:

```tsx
const in_flight = new Map<string, Promise<void>>();

async function fetchData() {
    const path = repo_path();
    const url = remote_url();
    if (!path) { ... return; }

    const cached = cache.get(path);
    if (cached) { ... return; }

    // Dedup: if another widget instance is already fetching this path, wait for it
    const existing = in_flight.get(path);
    if (existing) {
        await existing;
        // After the other fetch completes, our cache should be populated
        const now_cached = cache.get(path);
        if (now_cached) {
            setData(now_cached);
            setError(null);
        }
        return;
    }

    setLoading(true);
    const promise = (async () => {
        const result = await collectGithubData(path, url);
        if (result.ok) {
            cache.set(path, result.value, GITHUB_CACHE_TTL);
        }
        // Store result for the instance that triggered it
        if (result.ok) { setData(result.value); setError(null); }
        else { setData(null); setError(result.error); }
        setLoading(false);
    })();

    in_flight.set(path, promise);
    try { await promise; } finally { in_flight.delete(path); }
}
```

**Result:** 4 widgets selecting the same repo = 1 fetch (4 `gh` CLI calls), not 4 fetches (16 `gh` CLI calls).

---

### Task 2.2: Deduplicate Devpad fetches — same pattern

**File:** `packages/render/src/lib/use-devpad.ts`
**LOC:** ~20 changed
**Dependencies:** Phase 1 complete
**Risk:** LOW
**Parallel:** Can run in parallel with Task 2.1, 2.3, 2.4

Apply the exact same in-flight deduplication pattern as Task 2.1. The `use-devpad.ts` hook has the same architecture: 2 widget instances (`devpad-tasks`, `devpad-milestones`) independently calling `fetchData` and racing the cache.

Add `in_flight` map keyed on `cache_key` (the `url ?? name` value at line 75). When a second widget instance tries to fetch the same key, await the existing promise and read from cache.

---

### Task 2.3: Consolidate `commit-activity` into `fetchDetails`

**File:** `packages/render/src/screens/main-screen.tsx` (modify `fetchDetails`)
**File:** `packages/render/src/components/widgets/commit-activity.tsx` (remove internal fetch)
**File:** `packages/core/src/types.ts` (add `commit_activity` to `RepoStatus`)
**LOC:** ~40 changed across 3 files
**Dependencies:** Phase 1 complete (needs the request ID pattern from Task 1.1)
**Risk:** MEDIUM — touches 3 files, changes the widget's data flow from self-fetching to prop-driven
**Parallel:** Can run in parallel with Task 2.1, 2.2, 2.4

**Problem:** The `commit-activity` widget (lines 24-31) has its own `createEffect` that spawns `collectCommitActivity` every time `props.status?.path` changes. This is a 7th independent subprocess per repo selection, on top of the 6 from `fetchDetails`.

**Implementation:**

1. Add `commit_activity` field to `RepoStatus` in `types.ts`:
   ```tsx
   // In RepoStatus interface, add:
   commit_activity: CommitActivity | null;
   ```

2. Import and call `collectCommitActivity` inside `fetchDetails` in `main-screen.tsx`, alongside `captureGraph` and `collectStats`:
   ```tsx
   const [graphResult, statsResult, activityResult] = await Promise.all([
       captureGraph(node.path),
       collectStats(node.path),
       collectCommitActivity(node.path),
   ]);
   // ... after stale check ...
   if (activityResult.ok && node.status) {
       node.status.commit_activity = activityResult.value;
   }
   ```

3. Remove the internal `createEffect` and `collectCommitActivity` call from `commit-activity.tsx`. Read data from `props.status.commit_activity` instead:
   ```tsx
   function CommitActivityWidget(props: WidgetRenderProps & { status: RepoStatus | null }) {
       const activity = () => props.status?.commit_activity ?? null;
       // ... rest unchanged, just use activity() directly
   }
   ```

4. Initialize `commit_activity: null` in `collectStatus` return value in `git-status.ts`.

---

### Task 2.4: Remove redundant `isGitRepo` check from `captureGraph`

**File:** `packages/core/src/git-graph.ts`
**LOC:** ~10 changed (delete lines 20-28, remove call at line 34)
**Dependencies:** Phase 1 complete
**Risk:** LOW — the repo was already confirmed during scanning. The `git log` command itself will fail with a clear error if it's not a repo.
**Parallel:** Can run in parallel with Task 2.1, 2.2, 2.3

**Problem (lines 20-28, 34):** `captureGraph` spawns `git rev-parse --git-dir` to check if the path is a git repo before running `git log --graph`. This is redundant because:
- The repo was confirmed as a git repo during `scanDirectory` (which already calls `isGitRepo`)
- `captureGraph` is only called from `fetchDetails` on nodes with `type !== "directory"`
- If somehow it's not a repo, `git log` will fail and the error handler at line 55-61 will catch it

**Implementation:**
1. Delete the `isGitRepo` function (lines 20-28)
2. Remove the `isGitRepo` guard at line 34-36
3. The existing error handling at lines 55-60 already covers the `not a repo` case via stderr parsing. Map `git log` failure to the existing `not_a_repo` error kind.

**Result:** Saves 1 subprocess per repo selection.

---

## Phase 3: Startup Performance

### Task 3.1: Add concurrency limiter to `scanAndCollect`

**File:** `packages/core/src/index.ts`
**File:** `packages/core/src/concurrency.ts` (new)
**Test file:** `packages/core/src/__tests__/concurrency.test.ts` (new)
**LOC:** ~50 (limiter) + ~60 (tests) + ~15 (integration)
**Dependencies:** Phase 2 complete
**Risk:** MEDIUM — changes startup behavior, but the limiter is a pure utility
**Parallel:** Can run in parallel with Task 3.2

**Problem (line 41):** `Promise.all(nodes.map(populateNode))` fires all repo status collections concurrently. 50 repos = ~300 concurrent `Bun.spawn` calls (6 per repo: 5 status + 1 worktree).

**Implementation:**

Create a simple semaphore-based concurrency pool:

```tsx
// packages/core/src/concurrency.ts
export function createPool(concurrency: number) {
    let active = 0;
    const queue: Array<() => void> = [];

    function release() {
        active--;
        const next = queue.shift();
        if (next) {
            active++;
            next();
        }
    }

    return {
        async run<T>(fn: () => Promise<T>): Promise<T> {
            if (active < concurrency) {
                active++;
                try { return await fn(); }
                finally { release(); }
            }
            return new Promise<T>((resolve, reject) => {
                queue.push(() => {
                    fn().then(resolve, reject).finally(release);
                });
            });
        },
    };
}
```

Then in `index.ts`:
```tsx
import { createPool } from "./concurrency";

const pool = createPool(8); // 8 concurrent repo status collections

async function populateNode(node: RepoNode, scanRoot: string): Promise<void> {
    if (node.type === "repo" || node.type === "worktree") {
        await pool.run(async () => {
            const [status_result, worktree_result] = await Promise.all([
                collectStatus(node.path, scanRoot),
                detectWorktrees(node.path),
            ]);
            node.status = status_result.ok ? status_result.value : null;
            node.worktrees = worktree_result.ok ? worktree_result.value : [];
        });
    }
    await Promise.all(node.children.map((child) => populateNode(child, scanRoot)));
}
```

**Why 8?** Each repo does 6 `Bun.spawn` calls internally (via `Promise.all`), so 8 concurrent repos = ~48 concurrent subprocesses. This keeps system load reasonable while still being much faster than sequential.

**Tests:** Pure function tests for the pool — verify correct concurrency limit, ordering, and error propagation.

---

### Task 3.2: Parallelize scanner's `walkDirectory`

**File:** `packages/core/src/scanner.ts`
**LOC:** ~25 changed
**Dependencies:** Phase 2 complete
**Risk:** MEDIUM — changes the scanning order (may affect sort if names are expected sorted). Currently sorted by name at line 57, which is preserved.
**Parallel:** Can run in parallel with Task 3.1

**Problem (lines 61-66):** `walkDirectory` processes directories sequentially in a `for...of` loop. Each iteration potentially spawns `isGitRepo` (1 subprocess) + recursion. For a tree with 50 directories, this is 50 sequential `Bun.spawn` calls.

**Implementation:** Replace the sequential loop with batched parallel processing:

```tsx
const nodes: RepoNode[] = [];

const results = await Promise.all(
    dirs.map(async (entry) => {
        const full_path = join(dirPath, entry.name);
        const repo_type = await detectType(full_path);
        const is_repo = repo_type !== null && (await isGitRepo(full_path));
        const children_result = await walkDirectory(full_path, current_depth + 1, max_depth, ignore);
        if (!children_result.ok) return null;
        const children = children_result.value;

        if (is_repo) {
            return {
                name: entry.name, path: full_path, type: repo_type,
                status: null, worktrees: [], children,
                depth: current_depth, expanded: current_depth <= 1,
            } as RepoNode;
        } else if (children.length > 0) {
            return {
                name: entry.name, path: full_path, type: "directory" as const,
                status: null, worktrees: [], children,
                depth: current_depth, expanded: current_depth <= 1,
            } as RepoNode;
        }
        return null;
    }),
);

return ok(results.filter((n): n is RepoNode => n !== null));
```

Sort order is preserved because `dirs` is already sorted (line 57) and `Promise.all` preserves order.

**Note:** This also benefits from Task 3.1's concurrency pool if `isGitRepo` is wrapped in it, but the main win here is parallelizing the tree walk itself. The `isGitRepo` calls during scanning are lightweight (just `git rev-parse --git-dir`), so unbounded parallelism at scan time is acceptable.

---

## Phase 4: Minor Optimizations

### Task 4.1: Memoize branch sorting in `branch-list.tsx`

**File:** `packages/render/src/components/widgets/branch-list.tsx`
**LOC:** ~5 changed
**Dependencies:** Phase 3 complete
**Risk:** VERY LOW
**Parallel:** Can run in parallel with Task 4.2

**Problem (line 24):** `sortBranches` is called as a plain function inside a `() =>` getter, meaning it re-sorts on every access. With SolidJS fine-grained reactivity, this getter runs on every render.

**Implementation:** Wrap in `createMemo`:
```tsx
const branches = createMemo(() =>
    props.status ? sortBranches(props.status.branches) : []
);
```

Note: This requires importing `createMemo` (already imported via `For, Show` at line 1 — but `createMemo` needs to be added to the import).

---

### Task 4.2: Targeted watcher re-renders

**File:** `packages/render/src/screens/main-screen.tsx`
**LOC:** ~15 changed
**Dependencies:** Phase 3 complete
**Risk:** LOW — changes how repo list updates are triggered
**Parallel:** Can run in parallel with Task 4.1

**Problem (lines 136-144):** When the watcher fires for a single repo change, `setRepos([...repos()])` creates a new array reference, forcing the entire `RepoList` and all its children to re-render. For a list of 50 repos, this is wasteful when only 1 repo changed.

**Implementation:** Instead of cloning the entire array, use a separate change counter signal that the `RepoList` can observe:

```tsx
const [repoVersion, setRepoVersion] = createSignal(0);

const watcher = createRepoWatcher({
    debounce_ms: 500,
    on_change: (repoPath) => {
        collectStatus(repoPath, props.config.scan_dirs[0]!).then((result) => {
            if (result.ok) {
                updateRepoStatus(repos(), repoPath, result.value);
                setRepoVersion(v => v + 1); // bump version to trigger re-read
            }
        });
    },
});
```

Then in `processedRepos`:
```tsx
const processedRepos = createMemo(() => {
    repoVersion(); // track version for reactivity
    let result = repos();
    result = filterTree(result, filterMode());
    result = sortTree(result, sortMode());
    return result;
});
```

**Caveat:** This is a minor optimization. SolidJS's `<For>` already does keyed diffing, so the visual re-render cost is small. The main benefit is avoiding the array clone + reference change for `repos()`.

---

## Summary Table

| Phase | Task | Files | Est. LOC | Risk | Subprocess Reduction |
|-------|------|-------|----------|------|---------------------|
| 1 | 1.1: Debounce + cancellation | `main-screen.tsx` | 35 | LOW | Eliminates rapid-fire spawning |
| 1 | 1.2: Debounce utility + tests | `debounce.ts` (new), test (new) | 140 | LOW | (supports 1.1) |
| 2 | 2.1: GitHub fetch dedup | `use-github.ts` | 25 | LOW | 16 → 4 `gh` calls |
| 2 | 2.2: Devpad fetch dedup | `use-devpad.ts` | 20 | LOW | 2+ → 1 API calls |
| 2 | 2.3: Consolidate commit-activity | `main-screen.tsx`, `commit-activity.tsx`, `types.ts`, `git-status.ts` | 40 | MED | -1 subprocess |
| 2 | 2.4: Remove redundant isGitRepo | `git-graph.ts` | 10 | LOW | -1 subprocess |
| 3 | 3.1: Concurrency limiter | `concurrency.ts` (new), `index.ts`, test (new) | 125 | MED | 300 → ~48 concurrent |
| 3 | 3.2: Parallelize scanner | `scanner.ts` | 25 | MED | Faster tree walk |
| 4 | 4.1: Memoize branch sort | `branch-list.tsx` | 5 | VERY LOW | N/A (render perf) |
| 4 | 4.2: Targeted watcher re-renders | `main-screen.tsx` | 15 | LOW | N/A (render perf) |
| | **TOTAL** | | **~440** | | |

## Execution Plan

```
Phase 1: Debounce + Cancellation (sequential)
├── Task 1.1: Debounce + cancellation in main-screen.tsx
├── Task 1.2: Extract debounce utility + tests (parallel with 1.1)
→ Verification: typecheck, test, COMMIT

Phase 2: Fetch Deduplication (parallel)
├── Agent A: Task 2.1 — GitHub fetch dedup (use-github.ts)
├── Agent B: Task 2.2 — Devpad fetch dedup (use-devpad.ts)
├── Agent C: Task 2.3 — Consolidate commit-activity (main-screen.tsx, commit-activity.tsx, types.ts, git-status.ts)
├── Agent D: Task 2.4 — Remove redundant isGitRepo (git-graph.ts)
→ Verification: typecheck, test, COMMIT

Phase 3: Startup Performance (parallel)
├── Agent A: Task 3.1 — Concurrency limiter (concurrency.ts, index.ts, test)
├── Agent B: Task 3.2 — Parallelize scanner (scanner.ts)
→ Verification: typecheck, test, COMMIT

Phase 4: Minor Optimizations (parallel)
├── Agent A: Task 4.1 — Memoize branch sort (branch-list.tsx)
├── Agent B: Task 4.2 — Targeted watcher re-renders (main-screen.tsx)
→ Verification: typecheck, test, COMMIT
```

### Parallelization constraints

- **Phase 2, Agent C** touches `main-screen.tsx` — no other Phase 2 agent should touch this file. Task 2.4 only touches `git-graph.ts`, so it's safe.
- **Phase 4, Agent B** touches `main-screen.tsx` — no other Phase 4 agent should touch this file.
- Phase 1's two tasks can run in parallel since they touch different files, but Task 1.1 should integrate Task 1.2's utility. Alternative: have Task 1.1 implement the debounce inline first, then Task 1.2 extracts it in the verification step.

### DECISION NEEDED

**Task 2.3 (commit-activity consolidation):** This adds `commit_activity: CommitActivity | null` to the `RepoStatus` type. This is a type-level change that affects every file importing `RepoStatus`. Since `commit_activity` is nullable and initialized to `null`, existing code won't break — but it's a structural change to a core type. Confirm this is acceptable, or we can leave the commit-activity widget self-fetching and just add cancellation to it instead.

---

## Test Plan

### New tests (created in this plan)

1. **`packages/render/src/lib/__tests__/debounce.test.ts`** — Tests for the debounce utility:
   - Debounce timer fires after delay
   - Rapid triggers only fire the last one
   - `immediate()` bypasses debounce
   - Stale results are discarded (request ID check)
   - `cancel()` prevents pending execution
   - `dispose()` cleans up timers

2. **`packages/core/src/__tests__/concurrency.test.ts`** — Tests for the concurrency pool:
   - Respects concurrency limit (N active, rest queued)
   - Queued tasks run as active tasks complete
   - Errors propagate correctly
   - All tasks eventually complete

### Existing tests to verify

- `packages/render/src/lib/__tests__/widget-grid.test.ts` — Should pass unchanged (no widget grid changes)
- Full `bun test` from `packages/render/` after each phase

### Manual verification

After Phase 1: Open the TUI, rapidly press j/k through the repo list. Verify:
- No data flicker (stale results discarded)
- 250ms delay before content loads
- `r` key still refreshes immediately

After Phase 2: Select a GitHub repo. Check that only 4 `gh` CLI calls are made (not 16).

After Phase 3: Start the app with 50+ repos. Verify scan completes faster and doesn't spike CPU to 100%.

---

## Subprocess Count After All Optimizations

| Source | Before | After |
|--------|--------|-------|
| `captureGraph` (rev-parse) | 1 | **0** (removed) |
| `captureGraph` (git log) | 1 | 1 |
| `collectStats` | 5 | 5 |
| `collectCommitActivity` | 1 (separate) | **0** (merged into fetchDetails) |
| `useGithub` x4 (race) | 16 | **4** (deduped) |
| `collectRelease` → `countCommitsSince` | 1 | 1 |
| `useDevpad` x2 (race) | 2+ | **1** (deduped) |
| **Total per selection** | **~27** | **~12** |
| **With debounce (rapid scroll)** | 27 × N repos | **12** (only last) |

---

## Suggested AGENTS.md Updates

After implementation, add:

```markdown
### Performance Patterns

- **Debounce + cancellation:** Use `createDebouncedFetch` from `src/lib/debounce.ts` for any async operation triggered by signal changes. Never fire async work directly from `createEffect` without cancellation.
- **Fetch deduplication:** Hooks that may be instantiated multiple times (like `useGithub`, `useDevpad`) must use an `in_flight` Map to prevent duplicate concurrent fetches for the same key.
- **Concurrency limiting:** Use `createPool` from `@overview/core/concurrency` when spawning subprocesses in bulk. Default concurrency: 8 repos.
- **Request ID pattern:** Since `Bun.spawn` doesn't support `AbortSignal`, use an incrementing request ID to detect and discard stale async results.
```
