# Plan: Add "third" Widget Span + Auto-Expand

## Executive Summary

Add `"third"` as a new `WidgetSpan` value (~33% width, 3 widgets per row) to the widget grid system. Leftover widgets in incomplete rows auto-expand to fill remaining space (1 leftover → full width, 2 leftover → half each). The border line system is generalized from single-junction to multi-junction to handle mixed 1/2/3-column row transitions.

**Scope:** ~200 LOC across 5 files. No breaking changes — `"third"` is additive to `WidgetSpan`. No widgets are reassigned; this adds the capability only.

## Affected Files

| File | Changes | LOC est |
|------|---------|---------|
| `packages/core/src/types.ts:134` | Add `"third"` to `WidgetSpan` union | 2 |
| `packages/render/src/lib/widget-grid.ts` | All 6 exported functions + types | 80 |
| `packages/render/src/components/widget-container.tsx` | `box_width()` + `widget_content_width()` | 20 |
| `packages/render/src/lib/__tests__/widget-grid.test.ts` | New test cases for thirds | 70 |
| `packages/render/src/components/widgets/__tests__/widget-rendering.test.tsx` | Integration test for 3-col | 30 |

## Impact Analysis

### Type change: `WidgetSpan`
- `WidgetSpan = "full" | "half" | "auto"` → `"full" | "half" | "third" | "auto"`
- Used in: `WidgetSizeHint.span`, `resolveSpan()`, `contentWidth()`, widget definitions
- **Not breaking**: additive union member. All existing widget definitions use `"full"` or `"half"` and continue to work unchanged.

### GridRow.columns
- `columns: 1 | 2` → `columns: 1 | 2 | 3`
- Downstream consumers: `buildBorderLine()`, `getWidgetBorderSides()`, `widget-container.tsx` `box_width()`
- All need updates for the `3` case.

### Border system generalization
Current `buildBorderLine()` uses a single `junction_col` boolean + position. Needs to support a **set of junction positions** to handle:
- 3-col rows: junctions at `⌊W/3⌋` and `⌊2W/3⌋`
- 2-col rows: junction at `⌊W/2⌋`
- Mixed transitions (e.g., 3-col ↔ 2-col): union of both junction sets with correct characters

## Design Details

### `resolveSpan()` changes
```
"third" + panel_width >= 60 → "third"
"third" + panel_width >= 40 → "half"  (fallback: 2-col is better than 1-col)
"third" + panel_width < 40  → "full"
```
This cascading fallback ensures thirds degrade gracefully on narrow terminals.

Return type changes from `"full" | "half"` to `"full" | "half" | "third"`.

### `computeRows()` changes
Currently separates into `fulls[]` and `halfs[]`, pairs halfs by 2. New logic:
1. Separate into `fulls[]`, `halfs[]`, `thirds[]`
2. Group thirds by 3. Leftovers: 1 → `columns: 1`, 2 → `columns: 2`
3. Pair halfs by 2. Leftover 1 → `columns: 1`
4. Sort all rows by min priority

### `buildBorderLine()` — multi-junction approach
Replace the single `junction_col`/`has_junction` with a junction-set approach:

```typescript
function junctionColumns(row: GridRow | null, total_width: number): Set<number> {
    if (!row) return new Set();
    if (row.columns === 2) return new Set([Math.floor(total_width / 2)]);
    if (row.columns === 3) return new Set([Math.floor(total_width / 3), Math.floor(2 * total_width / 3)]);
    return new Set();
}
```

For each column position, check membership in prev_junctions and next_junctions:
- In both → `┼` (cross)
- In prev only → `┴` (merge from above)
- In next only → `┬` (split to below)
- In neither → `─` (horizontal)

For top/bottom types, mask out prev/next respectively (same as current behavior).

`junctionChar()` signature changes from taking `prev_row`/`next_row` to taking `in_prev: boolean`/`in_next: boolean`.

### `getWidgetBorderSides()` changes
- 3-column row: widget 0 → `["left"]`, widget 1 → `["left"]`, widget 2 → `["left", "right"]`
- Same pattern as 2-col but extended. Last widget always gets both sides; others get left only.

### `contentWidth()` changes
Add `"third"` case:
```typescript
if (resolved === "third") {
    const first_junction = Math.floor(panel_width / 3);
    return Math.max(1, first_junction - 1); // left border only, 1 char
}
```
Actually, needs careful thought. For 3-col:
- Widget 0: outer_width = `⌊W/3⌋`, border = `["left"]` → content = `⌊W/3⌋ - 1`
- Widget 1: outer_width = `⌊2W/3⌋ - ⌊W/3⌋`, border = `["left"]` → content = `outer - 1`
- Widget 2: outer_width = `W - ⌊2W/3⌋`, border = `["left", "right"]` → content = `outer - 2`

The widths differ slightly due to integer division. `contentWidth()` currently takes `span` + `panel_width` but not `widget_index`. For thirds, all three slots have similar but not identical widths. The simplest approach: use the **minimum** (first column width minus 1 border char) as the content width for all third-span widgets. This is conservative but consistent — widgets won't overflow.

### `widget-container.tsx` `box_width()` changes
Currently handles `columns: 1` (full width) and `columns: 2` (junction split). Add `columns: 3`:
```typescript
if (row.columns === 3) {
    const j1 = Math.floor(props.availableWidth / 3);
    const j2 = Math.floor(2 * props.availableWidth / 3);
    if (widget_idx() === 0) return j1;
    if (widget_idx() === 1) return j2 - j1;
    return props.availableWidth - j2;
}
```

### Auto-expand behavior
This is already handled by the `computeRows()` leftover logic:
- 1 leftover third → `columns: 1` → full width
- 2 leftover thirds → `columns: 2` → half width each
- 1 leftover half → `columns: 1` → full width (existing behavior)

No special auto-expand code needed. The downstream rendering already handles `columns: 1` and `columns: 2` rows regardless of the original span.

## Phased Task Breakdown

### Phase 1: Types + Pure Grid Functions (sequential)

Both files must be done sequentially (grid depends on types), and they share no files with Phase 2 tasks.

#### Task 1.1: Add "third" to WidgetSpan type
- **File:** `packages/core/src/types.ts`
- **Changes:** Line 134: `"full" | "half" | "auto"` → `"full" | "half" | "third" | "auto"`
- **LOC:** 2
- **Dependencies:** None

#### Task 1.2: Update widget-grid.ts pure functions
- **File:** `packages/render/src/lib/widget-grid.ts`
- **Changes:**
  1. `GridRow.columns`: `1 | 2` → `1 | 2 | 3`
  2. `resolveSpan()`: add `"third"` case with cascading fallback. Return type → `"full" | "half" | "third"`
  3. `computeRows()`: add `thirds[]` bucket, group by 3, handle 1/2 leftovers
  4. `junctionColumns()`: new helper function returning `Set<number>`
  5. `junctionChar()`: change signature to `(in_prev: boolean, in_next: boolean)` 
  6. `buildBorderLine()`: use junction sets, iterate all positions
  7. `getWidgetBorderSides()`: add `columns === 3` case
  8. `contentWidth()`: add `"third"` resolved case
- **LOC:** 80
- **Dependencies:** Task 1.1 (type must exist first)

**→ Verification: typecheck both packages**

### Phase 2: Container + Tests (parallel)

After Phase 1 is verified, these two tasks can run in parallel — they touch different files.

#### Task 2.1: Update widget-container.tsx
- **File:** `packages/render/src/components/widget-container.tsx`
- **Changes:**
  1. `box_width()`: add `row.columns === 3` branch with junction-based widths
  2. `widget_content_width()`: already delegates to `contentWidth()` which was updated in Phase 1. But the current implementation passes `gw.size_hint.span` directly — for auto-expanded widgets, the span is still `"third"` but the row has `columns: 1` or `2`. Need to compute content width based on `row.columns` and `widget_idx` rather than original span. **DECISION NEEDED**: should `contentWidth()` take the row context, or should `widget-container.tsx` compute it locally?

  **Recommendation**: Change `widget_content_width()` in the container to use `box_width() - border_count` directly instead of calling `contentWidth()`. This is simpler and inherently correct for all column counts including auto-expanded rows. The standalone `contentWidth()` function remains for external callers.

  ```typescript
  const widget_content_width = () => {
      const sides = getWidgetBorderSides(row, widget_idx());
      return Math.max(1, box_width() - sides.length);
  };
  ```
- **LOC:** 20
- **Dependencies:** Phase 1 complete
- **Parallel with:** Task 2.2

#### Task 2.2: Add unit tests for third-span grid logic
- **File:** `packages/render/src/lib/__tests__/widget-grid.test.ts`
- **New test cases:**
  - `resolveSpan`: `"third"` at 60/40/39 cols (cascading fallback)
  - `computeRows`: 3 thirds → 1 three-column row
  - `computeRows`: 4 thirds → 3-col row + 1-col row (auto-expand)
  - `computeRows`: 5 thirds → 3-col row + 2-col row (auto-expand to halfs)
  - `computeRows`: mixed thirds + halfs + fulls
  - `buildBorderLine`: 3-col top/mid/bottom borders
  - `buildBorderLine`: mixed 3-col ↔ 2-col transitions (junction union)
  - `buildBorderLine`: mixed 3-col ↔ 1-col transitions
  - `getWidgetBorderSides`: 3-col widget positions
  - `contentWidth`: `"third"` at various widths
- **LOC:** 70
- **Dependencies:** Phase 1 complete
- **Parallel with:** Task 2.1

**→ Verification: typecheck, `bun test` from `packages/render/`, commit**

### Phase 3: Integration Test (sequential)

#### Task 3.1: Add 3-column integration rendering test
- **File:** `packages/render/src/components/widgets/__tests__/widget-rendering.test.tsx`
- **New test cases:**
  - Three third-width widgets render side-by-side with correct borders
  - Mixed layout: 3-col row above 2-col row, verify junction characters (┴ at 2-col junction, ┬ at 3-col junctions, etc.)
  - Auto-expand: 1 leftover third renders as full-width
- **LOC:** 30
- **Dependencies:** Phase 2 complete
- **Parallel:** No (single task)

**→ Verification: full `bun test`, typecheck, commit**

## Decision Points

### DECISION NEEDED: contentWidth() API
**Question:** Should `contentWidth()` remain a standalone `(span, panel_width) → number` function, or should it take row context (columns, widget_index)?

**Recommendation:** Keep `contentWidth()` as-is for backwards compat with any external callers. Change `widget-container.tsx` to compute content width locally as `box_width() - border_char_count`. This is simpler, always correct, and avoids API churn.

**If you want `contentWidth()` to handle thirds correctly for external callers too:** add an optional 3rd parameter `columns?: 1 | 2 | 3` that overrides the span-based logic. But this can be deferred — no external callers exist today.

## Test Plan Summary

| Category | Test | File |
|----------|------|------|
| Unit | `resolveSpan("third", ...)` cascading fallback | widget-grid.test.ts |
| Unit | `computeRows` with 3/4/5 thirds | widget-grid.test.ts |
| Unit | `computeRows` mixed thirds + halfs + fulls | widget-grid.test.ts |
| Unit | `buildBorderLine` 3-col junctions | widget-grid.test.ts |
| Unit | `buildBorderLine` mixed 3↔2 and 3↔1 transitions | widget-grid.test.ts |
| Unit | `getWidgetBorderSides` 3-col positions | widget-grid.test.ts |
| Unit | `contentWidth("third", ...)` | widget-grid.test.ts |
| Integration | 3 thirds render side-by-side | widget-rendering.test.tsx |
| Integration | Mixed 3-col/2-col border transitions | widget-rendering.test.tsx |
| Integration | Auto-expand lone third | widget-rendering.test.tsx |

## Suggested AGENTS.md Updates

After implementation, add to the "Widget System" section:

```
- **`WidgetSpan`** has `"full" | "half" | "third" | "auto"` — thirds resolve to half at <60 cols, full at <40 cols
- **`GridRow.columns`** is `1 | 2 | 3` — incomplete rows auto-expand (1 leftover → columns:1, 2 leftover → columns:2)
- **Border junctions** use a set-based approach — `junctionColumns()` returns junction positions per row, `buildBorderLine()` unions prev/next sets for mixed transitions
- **`contentWidth()` caveat** — only handles full/half/third at their native column count. `widget-container.tsx` computes content width as `box_width() - border_sides.length` for auto-expanded widgets
```
