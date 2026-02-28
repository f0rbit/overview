# Widget Layout V2: Flow Grid with Self-Sizing Widgets

## Problem Statement

The current widget layout system has three fundamental limitations:

1. **Fixed row caps**: Each widget is constrained to `max_rows` by a priority-based allocator. The scrollbox already handles overflow, so these caps serve no purpose — they just truncate content (e.g., file-changes capped at 15 rows even when there are 30 changed files).

2. **Single-column waste**: Widgets stack vertically in a single column. Small widgets like `repo-meta` (3 rows), `github-release` (2 rows), and `commit-activity` (3 rows) waste horizontal space when the panel is 60+ columns wide.

3. **Static sizing**: Widgets receive a fixed `allocated_rows` computed once at layout time. They can't grow when data loads or shrink when collapsed — the container pre-allocates rows regardless of actual content.

## Design Overview

Replace the allocator-driven fixed layout with a **flexbox flow grid** inside the scrollbox. Widgets become self-sizing boxes that declare width preferences (not row counts). The scrollbox handles all overflow naturally.

### Key Insight

opentui's Yoga layout engine already supports `flexWrap: "wrap"` on `<box>`. A single `<box flexDirection="row" flexWrap="wrap">` inside the scrollbox gives us a flow grid for free — small widgets sit side-by-side, large widgets take full width, and everything wraps naturally.

## Design Decisions

### D1: Replace `WidgetSizeRequest` with `WidgetSizeHint`

**Current:**
```ts
interface WidgetSizeRequest {
  min_rows: number;
  preferred_rows: number;
  max_rows: number;
}
```

**New:**
```ts
type WidgetSpan = "full" | "half" | "auto";

interface WidgetSizeHint {
  /** Width preference: "full" = 100%, "half" = ~50%, "auto" = content-driven */
  span: WidgetSpan;
  /** Minimum height in rows. Widget always gets at least this. */
  min_height: number;
}
```

**Rationale:**
- `span` controls horizontal behavior — the only layout dimension the container needs from widgets.
- `min_height` prevents widgets from collapsing to 0 during loading states.
- No `max_height` — widgets grow naturally, scrollbox handles overflow.
- No `preferred_rows` — content determines actual height.

**BREAKING:** `WidgetSizeRequest` is removed from `@overview/core` types. All 12 widget components must be updated. `WidgetRenderProps.allocated_rows` is removed.

### D2: Widget Span Assignments

Based on current widget content density:

| Widget | Current size_request | New span | Rationale |
|--------|---------------------|----------|-----------|
| `git-status` | 3/5/7 | `half` | 2-5 rows of key-value pairs, compact |
| `repo-meta` | 2/3/4 | `half` | 2-3 rows of stats, compact |
| `github-release` | 1/2/3 | `half` | 1-2 rows, very compact |
| `commit-activity` | 2/3/4 | `half` | sparkline + 1-2 stat rows |
| `github-ci` | 2/4/6 | `half` | often collapses to "all green ✓" |
| `recent-commits` | 3/6/8 | `full` | needs width for hash + message + time |
| `file-changes` | 3/8/15 | `full` | needs width for file paths |
| `github-prs` | 3/6/10 | `full` | needs width for PR title + indicators |
| `github-issues` | 3/5/8 | `full` | needs width for issue title + labels |
| `branch-list` | 3/6/10 | `full` | needs width for branch names + sync indicators |
| `devpad-tasks` | 3/6/10 | `full` | needs width for task titles |
| `devpad-milestones` | 2/4/8 | `half` | progress bars are compact |

### D3: Flow Grid Layout

```
<scrollbox flexGrow={1}>
  <box flexDirection="row" flexWrap="wrap" gap={0}>
    {widgets.map(widget => (
      <box
        width={spanToWidth(widget.span, panelWidth)}
        minHeight={widget.min_height}
        flexDirection="column"
        borderStyle="rounded"  // each widget gets its own border
      >
        <WidgetHeader label={widget.label} focused={isFocused} collapsed={isCollapsed} />
        <Show when={!collapsed}>
          <widget.component ... />
        </Show>
      </box>
    ))}
  </box>
</scrollbox>
```

**Width calculation:**
```ts
function spanToWidth(span: WidgetSpan, panelWidth: number): number | `${number}%` {
  switch (span) {
    case "full": return "100%";
    case "half": return panelWidth >= 50 ? "50%" : "100%";
    case "auto": return "100%"; // auto falls back to full for now
  }
}
```

When the panel is narrower than 50 columns, `"half"` widgets fall back to full width — the flow grid degrades to a single column naturally.

### D4: Widget Borders Replace Separators

**Current:** Flat separator lines (`───`) between widgets in a column.
**New:** Each widget gets its own `borderStyle="rounded"` box with a title showing the widget label.

This is cleaner in a grid — separators don't make sense when widgets are side-by-side. The border also makes each widget visually distinct and provides a natural place for the widget label (replacing the `▸ Widget Label` focus indicator).

The focused widget gets `borderColor={theme.border_highlight}` (same pattern as the outer container border).

### D5: Self-Sizing Widgets — Remove `allocated_rows`

**Current:** Widgets receive `allocated_rows` and use it to control content visibility:
```ts
const visible_count = () => Math.max(0, props.allocated_rows - 1);
const visible = () => items().slice(0, visible_count());
```

**New:** Widgets render ALL their content. The scrollbox handles overflow. Widgets that want to limit visible items can use a reasonable default (e.g., show last 10 commits, show top 8 PRs) or make it configurable.

**New `WidgetRenderProps`:**
```ts
interface WidgetRenderProps {
  width: number;       // available width for text truncation (accounts for border)
  focused: boolean;    // this widget has keyboard focus
}
```

`allocated_rows` is removed. Widgets no longer need to know their height.

### D6: Keyboard Navigation in 2D Grid

**Current:** j/k moves up/down a 1D list. `focused_idx` is a single integer.

**New:** The widget list is still logically ordered by priority. Navigation stays 1D:
- `j` → next widget (by priority order)
- `k` → previous widget
- The visual position may jump (e.g., from left column to right column), but the ordering is predictable — it follows the same priority sort as the config.

This is the simplest approach and avoids the complexity of 2D spatial navigation. Users configure widget order via priority — j/k simply walks that order.

The scrollbox should auto-scroll to keep the focused widget visible. This means the container needs to track which widget is focused and ensure it's in the viewport.

### D7: Collapse Behavior

**Current:** Collapsed widgets get `height={1}` showing `[>] Widget Label (collapsed)`.
**New:** Collapsed widgets keep their border box but the content area collapses to a single empty line (the border title already shows the label). Effectively `minHeight={1}` with no content rendered.

`c` still toggles collapse on focused widget. `C` still toggles all.

### D8: Delete the Allocator

The entire `widget-layout.ts` file (the 3-phase allocator) is deleted. It's replaced by pure flexbox layout. The `getEffectiveSizeRequest` function is also removed.

## New Type Definitions

### `@overview/core` types.ts changes

```ts
// REMOVE:
export interface WidgetSizeRequest {
  min_rows: number;
  preferred_rows: number;
  max_rows: number;
}

// ADD:
export type WidgetSpan = "full" | "half" | "auto";

export interface WidgetSizeHint {
  span: WidgetSpan;
  min_height: number;
}

// MODIFY:
export interface WidgetRenderProps {
  width: number;       // was: allocated_rows, width, focused
  focused: boolean;
}
// (allocated_rows removed)
```

### `@overview/render` registry.ts changes

```ts
export interface WidgetDefinition {
  id: WidgetId;
  label: string;
  size_hint: WidgetSizeHint;  // was: size_request
  component: Component<WidgetRenderProps & { status: RepoStatus | null }>;
}
```

### `@overview/render` widget-layout.ts → deleted

Replace with a simple utility:

```ts
// widget-grid.ts (new, ~15 lines)
import type { WidgetSpan } from "@overview/core";

export function spanToWidth(span: WidgetSpan, panel_width: number): string {
  if (span === "full") return "100%";
  if (span === "half" && panel_width >= 50) return "50%";
  return "100%";
}

export function contentWidth(span: WidgetSpan, panel_width: number): number {
  // Account for border (2 cols)
  const box_width = span === "half" && panel_width >= 50
    ? Math.floor(panel_width / 2)
    : panel_width;
  return Math.max(1, box_width - 2);
}
```

## Layout Algorithm

No algorithm needed — flexbox does the work:

1. Container: `<box flexDirection="row" flexWrap="wrap">` inside `<scrollbox>`
2. Each widget: `<box width={spanToWidth(hint.span, panelWidth)} minHeight={hint.min_height}>`
3. Content determines actual height
4. `flexWrap="wrap"` flows widgets left-to-right, top-to-bottom
5. Two `"half"` widgets in sequence sit side-by-side (if panel wide enough)
6. A `"full"` widget always starts a new row
7. A `"half"` followed by a `"full"` → half takes left column, full wraps to next row

## Widget Content Migration

Each widget needs two changes:
1. Replace `size_request` with `size_hint` in registration
2. Remove `allocated_rows` usage from component logic

### Per-widget migration detail:

**git-status.tsx** (~5 LOC changed)
- `size_request` → `{ span: "half", min_height: 2 }`
- Remove `rows()` accessor and all `Show when={rows() >= N}` guards → show everything always
- The widget will naturally show 3-5 rows depending on repo state

**repo-meta.tsx** (~5 LOC changed)
- `size_request` → `{ span: "half", min_height: 2 }`
- Remove `rows()` accessor and `Show when={rows() >= 3}` → always show latest tag row

**github-release.tsx** (~4 LOC changed)
- `size_request` → `{ span: "half", min_height: 1 }`
- Remove `rows()` accessor and `Show when={rows() >= 2}` → always show commits-since row

**commit-activity.tsx** (~4 LOC changed)
- `size_request` → `{ span: "half", min_height: 2 }`
- Remove `Show when={props.allocated_rows >= 3}` → always show total

**github-ci.tsx** (~3 LOC changed)
- `size_request` → `{ span: "half", min_height: 1 }`
- Remove `allocated_rows` slicing on `visible_runs` → show all runs (or cap at 6 for sanity)

**recent-commits.tsx** (~5 LOC changed)
- `size_request` → `{ span: "full", min_height: 2 }`
- Remove `allocated_rows` slicing → show up to 8 commits (hardcode reasonable max)

**file-changes.tsx** (~5 LOC changed)
- `size_request` → `{ span: "full", min_height: 2 }`
- Remove `allocated_rows` slicing → show all changes (scrollbox handles overflow)

**github-prs.tsx** (~5 LOC changed)
- `size_request` → `{ span: "full", min_height: 2 }`
- Remove `allocated_rows` slicing → show up to 10 PRs

**github-issues.tsx** (~5 LOC changed)
- `size_request` → `{ span: "full", min_height: 2 }`
- Remove `allocated_rows` slicing → show up to 10 issues

**branch-list.tsx** (~5 LOC changed)
- `size_request` → `{ span: "full", min_height: 2 }`
- Remove `allocated_rows` slicing → show up to 10 branches

**devpad-tasks.tsx** (~5 LOC changed)
- `size_request` → `{ span: "full", min_height: 2 }`
- Remove `allocated_rows` slicing → show up to 10 tasks

**devpad-milestones.tsx** (~4 LOC changed)
- `size_request` → `{ span: "half", min_height: 2 }`
- Remove `allocated_rows` slicing → show up to 4 milestones

## Impact on Widget Container

The `widget-container.tsx` rewrite is the core of this change (~80 LOC net change):

### Remove:
- `allocations` memo (calls `allocateWidgets`)
- `widgetEntries` memo (maps allocations to defs)
- `getEffectiveSizeRequest` import
- `allocateWidgets` import
- `availableRows` prop
- Fixed `height={entry.alloc.rows}` on widget boxes
- `───` separator lines
- The `allocated_rows` prop passed to widget components

### Add:
- `spanToWidth` / `contentWidth` imports from new `widget-grid.ts`
- Flow grid wrapper: `<box flexDirection="row" flexWrap="wrap">`
- Per-widget border boxes with `width={spanToWidth(...)}`
- Widget title in border: `title={entry.def.label}`
- Focus border color logic per widget

### Preserved:
- j/k navigation (still walks priority-ordered list)
- c/C collapse/expand
- Config persistence (no changes to `widget-state.ts` or `WidgetConfig`)
- Widget enable/disable
- Priority ordering

## Impact on Main Screen

`main-screen.tsx` changes are minimal (~5 LOC):
- Remove `widgetPanelHeight` computation (no longer needed — widgets self-size)
- Remove `availableRows` prop from `<WidgetContainer>`
- Keep `availableWidth` prop (still needed for text truncation hints)

## Impact on Tests

`widget-rendering.test.tsx` needs updates:
- Test A (overflow clipping): Still valid but the container no longer sets fixed `height` — test the scrollbox behavior instead
- Test B (focus label): Focus is now shown via border color, not a label row — remove or rewrite
- Test C (milestones slicing): Milestones no longer slice by `allocated_rows` — remove

New tests to add:
- Half-width widgets render side-by-side when panel is wide enough
- Half-width widgets fall back to full width when panel is narrow
- Collapsed widget shows only border with title
- `spanToWidth` unit tests

## Risk Areas

1. **`flexWrap` + `<scrollbox>` interaction**: The known bug is that `flexDirection="column"` on scrollbox causes issues. We're NOT setting flexDirection on scrollbox — the flow grid `<box>` is a child of scrollbox. The scrollbox child is `flexDirection="row" flexWrap="wrap"`, which is a different codepath. **Risk: medium.** If this doesn't work, fallback is to keep single-column but remove row caps.

2. **Focus scroll-to behavior**: Currently the scrollbox probably doesn't auto-scroll to focused widgets. We may need to manage scroll position manually. **Risk: low** — the scrollbox should handle this naturally when the focused widget's border changes, but may need a `scrollTo` mechanism.

3. **Half-width height mismatch**: Two side-by-side widgets will have different heights. Yoga should handle this fine (each box is independently sized), but if one widget is much taller, the visual pairing may look odd. **Risk: low** — this is cosmetic, not functional.

4. **Width calculation for text truncation**: Half-width widgets need accurate width hints. If the panel is 60 cols wide, a half-width widget gets ~28 cols of content (30 - 2 for border). Off-by-one errors here cause text overflow or wasted space. **Risk: low** — same problem exists today, just with different numbers.

5. **Config migration**: `WidgetConfig` is unchanged (id, enabled, priority, collapsed). No migration needed. The `size_hint` is in code, not config. **Risk: none.**

## Shared Border Design

### Problem

The original plan (D4) gives each widget its own `borderStyle="rounded"` box. This produces **doubled borders** between adjacent widgets:

```
╭──────────────╮╭──────────────╮   ← doubled vertical border between widgets
│ git-status   ││ repo-meta    │
│ ...          ││ ...          │
╰──────────────╯╰──────────────╯   ← doubled horizontal border between rows
╭─────────────────────────────╮
│ recent-commits              │
╰─────────────────────────────╯
```

The desired output merges shared edges with proper junction characters:

```
╭──────────────┬──────────────╮
│ git-status   │ repo-meta    │
│ ...          │ ...          │
├──────────────┴──────────────┤
│ recent-commits              │
│ ...                         │
╰─────────────────────────────╯
```

### User Decisions Applied

1. **Half-width breakpoint**: Hardcoded at 50 cols. Not configurable.
2. **Content caps**: Hardcoded 10-item limits on list widgets.
3. **Widget borders**: YES, with shared/merged borders.

### Approach Evaluation

#### Option A: Custom border component (manual coordinate math)
Draw borders using `<text>` elements with absolute positioning. A `WidgetGrid` component computes every border character position after measuring widget heights.

**Verdict: Rejected.** Absolute positioning doesn't work well inside a scrollbox — the scroll offset shifts `<text>` positions, and we'd have to re-implement Yoga's layout in JS just to know where to put border characters. Extremely fragile.

#### Option B: Overlapping opentui borders (negative margins)
Use `borderStyle="rounded"` on each widget but overlap adjacent borders via `marginRight={-1}` or `marginBottom={-1}`.

**Verdict: Rejected.** Overlapping renders by z-order — `╮` from widget 1 gets overwritten by `╭` from widget 2, producing `╭` instead of the correct `┬` junction. opentui does not perform character-level merge on overlapping border draws. There is no way to make this produce correct junction characters.

#### Option C: Row-based layout with selective border sides ← CHOSEN
Pre-compute explicit "rows" of widgets. Each widget gets a `<box>` with selective `border={["top", "right", "bottom", "left"]}` sides — omitting sides that are shared with an adjacent widget. Between rows, a `<text>` element draws the shared horizontal border line with correct junction characters.

**Verdict: CHOSEN.** This approach works because:
- opentui's `border` prop accepts `BorderSides[]` to selectively enable sides — confirmed in source: `getBorderSides()` parses `["top", "right"]` etc.
- When a side is disabled, Yoga removes the 1-cell border padding for that side via `node.setBorder(Edge.X, 0)` — so content flows to the edge correctly.
- The junction characters (`┬`, `┴`, `├`, `┤`, `┼`) are already defined in opentui's `BorderChars.rounded`.
- Shared horizontal borders between rows are rendered as `<text>` elements (1 row high, full width) with the correct junction pattern.
- Height alignment within a row is natural — Yoga's `flexDirection="row"` stretches children to the tallest item by default (`alignItems: "stretch"`).

#### Option D: Table-like grid component
Build a table abstraction with colspan support.

**Verdict: Rejected.** Over-engineered for a 2-column grid. Option C achieves the same visual result with less abstraction and better integration with the existing widget component model.

### Chosen Approach: Row-Based Selective Borders

#### Architecture

```
<scrollbox>
  <box flexDirection="column">        ← vertical stack of rows + separators
    <RowBorder type="top" row={0} />  ← ╭──────────┬──────────╮
    <box flexDirection="row">          ← row 0: two half-width widgets
      <box border={["left"]}  ...>
        <git-status />
      </box>
      <box border={["left", "right"]} ...>
        <repo-meta />
      </box>
    </box>
    <RowBorder type="mid" prevRow={0} nextRow={1} />  ← ├──────────┴──────────┤
    <box flexDirection="row">          ← row 1: one full-width widget
      <box border={["left", "right"]} ...>
        <recent-commits />
      </box>
    </box>
    <RowBorder type="bottom" row={1} />  ← ╰─────────────────────╯
  </box>
</scrollbox>
```

Key insight: **widgets never draw their own top/bottom borders**. All horizontal borders (top, bottom, and inter-row separators) are drawn by dedicated `<text>` elements. Widgets only draw their left/right vertical borders.

This cleanly separates the two concerns:
1. **Vertical borders** = per-widget `<box>` with `border={sidesList}` — opentui handles the `│` characters
2. **Horizontal borders** = `<text content={borderLine}>` between rows — we compute the junction characters

#### Row Computation Algorithm

```ts
interface GridRow {
  widgets: WidgetEntry[];  // 1 full-width widget or 1-2 half-width widgets
  columns: number;         // 1 or 2 — how many columns this row occupies
}

function computeRows(widgets: WidgetEntry[], panelWidth: number): GridRow[] {
  const rows: GridRow[] = [];
  let pending_half: WidgetEntry | null = null;

  for (const widget of widgets) {
    const effective_span = resolveSpan(widget.size_hint.span, panelWidth);

    if (effective_span === "full") {
      // Flush any pending half-width widget as its own row
      if (pending_half) {
        rows.push({ widgets: [pending_half], columns: 1 });
        pending_half = null;
      }
      rows.push({ widgets: [widget], columns: 1 });
    } else {
      // half-width
      if (pending_half) {
        // Pair with pending → 2-column row
        rows.push({ widgets: [pending_half, widget], columns: 2 });
        pending_half = null;
      } else {
        pending_half = widget;
      }
    }
  }

  // Flush trailing half-width widget
  if (pending_half) {
    rows.push({ widgets: [pending_half], columns: 1 });
  }

  return rows;
}

function resolveSpan(span: WidgetSpan, panelWidth: number): "full" | "half" {
  if (span === "half" && panelWidth >= 50) return "half";
  return "full";
}
```

**Note:** `resolveSpan` collapses `"auto"` and narrow-panel `"half"` to `"full"`. The row computation only ever sees `"full"` or `"half"`.

#### Widget Border Sides

Each widget in a row gets specific border sides based on its position:

```ts
function getWidgetBorderSides(
  row: GridRow,
  widgetIndex: number,
): BorderSides[] {
  if (row.columns === 1) {
    // Full-width or lone half-width: left + right only
    return ["left", "right"];
  }

  // 2-column row
  if (widgetIndex === 0) {
    // Left widget: left border only (right border drawn by the right widget)
    return ["left"];
  } else {
    // Right widget: left + right (left = shared vertical divider, right = outer edge)
    return ["left", "right"];
  }
}
```

**Why this works:** In a 2-column row, the left widget has `border={["left"]}` and the right widget has `border={["left", "right"]}`. The right widget's left border becomes the shared vertical divider `│` between the two widgets. Since both widgets are in a `flexDirection="row"` container, they are adjacent — the left widget's right edge touches the right widget's left border.

Yoga allocates border padding only for enabled sides, so:
- Left widget: 1px left padding (border), 0px right padding → content extends to right edge
- Right widget: 1px left padding (border), 1px right padding (border) → shared `│` appears between them

#### Horizontal Border Lines

Horizontal borders are `<text>` elements with computed content strings. Three types:

**Top border** (first row):
```
╭──────────────┬──────────────╮   (2-column first row)
╭─────────────────────────────╮   (1-column first row)
```

**Inter-row separator** (between row N and row N+1):
```
├──────────────┼──────────────┤   (2-col → 2-col)
├──────────────┴──────────────┤   (2-col → 1-col)
├──────────────┬──────────────┤   (1-col → 2-col)
├─────────────────────────────┤   (1-col → 1-col)
```

**Bottom border** (last row):
```
╰──────────────┴──────────────╯   (2-column last row)
╰─────────────────────────────╯   (1-column last row)
```

#### Border Line Generation Algorithm

```ts
import { BorderChars } from "@opentui/core";

const B = BorderChars.rounded;

function buildBorderLine(
  type: "top" | "mid" | "bottom",
  totalWidth: number,
  prevRow: GridRow | null,  // null for top border
  nextRow: GridRow | null,  // null for bottom border
): string {
  // Determine junction column positions (0-indexed within the line)
  // A junction exists where a vertical border from the row above or below
  // meets this horizontal line.
  const junctions = new Set<number>();

  // For a 2-column row, the junction is at the midpoint (where left widget ends)
  if (prevRow?.columns === 2) {
    junctions.add(Math.floor(totalWidth / 2));
  }
  if (nextRow?.columns === 2) {
    junctions.add(Math.floor(totalWidth / 2));
  }

  // Build the line character by character
  const chars: string[] = [];
  for (let col = 0; col < totalWidth; col++) {
    if (col === 0) {
      chars.push(cornerChar(type, "left"));
    } else if (col === totalWidth - 1) {
      chars.push(cornerChar(type, "right"));
    } else if (junctions.has(col)) {
      chars.push(junctionChar(type, prevRow, nextRow, col));
    } else {
      chars.push(B.horizontal);
    }
  }

  return chars.join("");
}

function cornerChar(
  type: "top" | "mid" | "bottom",
  side: "left" | "right",
): string {
  if (type === "top")    return side === "left" ? B.topLeft    : B.topRight;
  if (type === "bottom") return side === "left" ? B.bottomLeft : B.bottomRight;
  /* mid */              return side === "left" ? B.leftT      : B.rightT;
}

function junctionChar(
  type: "top" | "mid" | "bottom",
  prevRow: GridRow | null,
  nextRow: GridRow | null,
  col: number,
): string {
  const hasAbove = prevRow?.columns === 2 && Math.floor(/* width */ 0 / 2) === col;
  const hasBelow = nextRow?.columns === 2 && Math.floor(/* width */ 0 / 2) === col;

  // More precisely: does a vertical border from above/below meet this line?
  // A 2-column row has a vertical divider at the midpoint.
  if (type === "top") {
    // No row above → this is the top edge. Junction only from below.
    return B.topT;       // ┬
  }
  if (type === "bottom") {
    // No row below → this is the bottom edge. Junction only from above.
    return B.bottomT;    // ┴
  }

  // Mid: junction from above AND/OR below
  const fromAbove = prevRow !== null && prevRow.columns === 2;
  const fromBelow = nextRow !== null && nextRow.columns === 2;

  if (fromAbove && fromBelow) return B.cross;    // ┼
  if (fromAbove)              return B.bottomT;   // ┴
  if (fromBelow)              return B.topT;      // ┬
  return B.horizontal;                            // ─ (shouldn't happen)
}
```

#### Full Junction Character Map

| Position | Above cols | Below cols | Character | Name |
|----------|-----------|-----------|-----------|------|
| Top-left corner | — | any | `╭` | topLeft |
| Top-right corner | — | any | `╮` | topRight |
| Bottom-left corner | any | — | `╰` | bottomLeft |
| Bottom-right corner | any | — | `╯` | bottomRight |
| Top edge, junction | — | 2 | `┬` | topT |
| Bottom edge, junction | 2 | — | `┴` | bottomT |
| Mid-left edge | any | any | `├` | leftT |
| Mid-right edge | any | any | `┤` | rightT |
| Mid junction, 2→2 | 2 | 2 | `┼` | cross |
| Mid junction, 2→1 | 2 | 1 | `┴` | bottomT |
| Mid junction, 1→2 | 1 | 2 | `┬` | topT |
| Horizontal fill | — | — | `─` | horizontal |
| Vertical divider | — | — | `│` | vertical |

#### Variable Height Handling

**Problem:** Two half-width widgets in a row may have different content heights. If git-status renders 4 rows and repo-meta renders 2 rows, the shared vertical `│` border between them must extend to 4 rows.

**Solution:** Yoga handles this automatically. When `flexDirection="row"` is set on the row container, the default `alignItems: "stretch"` causes both children to stretch to the tallest child's height. The shorter widget's box gets stretched, and its `border={["left", "right"]}` or `border={["left"]}` renders `│` characters for the full stretched height.

The widget content inside remains top-aligned (default `justifyContent: "flex-start"`). So the shorter widget's content sits at the top, with empty space below, and the border extends to match its sibling.

This is the key architectural win of Option C — Yoga does the height equalization for free.

#### Collapsed Widget Behavior

A collapsed widget in a 2-column row:
- Its box gets `minHeight={1}` (room for the "(collapsed)" text)
- The sibling widget's height still determines the row height
- The collapsed widget's box stretches to match, with `│` borders at the correct height
- The border title shows the widget name (e.g., `│ git-status (collapsed) │`)

A collapsed widget that is the ONLY widget in a row:
- Row collapses to 1 row of content + the horizontal border lines

When a widget is disabled (removed from grid entirely), it's excluded from `computeRows()` — this may change row groupings (e.g., a half-width widget that lost its pair becomes a lone widget in a 1-column row). This is correct behavior.

#### Focus Highlighting

The focused widget's vertical borders change color via `borderColor`. But since horizontal borders are `<text>` elements, we need to color them too.

**Approach:** The horizontal border lines use the default `theme.border` color. Only the vertical `│` borders of the focused widget change to `theme.border_highlight`. This provides a clear visual indicator of which widget is focused without the complexity of partially-colored horizontal lines.

The focused widget also gets its title shown in the relevant horizontal border line (via the `title` prop on the widget's box if opentui draws titles on side borders, or by inserting the title into the horizontal border text for the row above the focused widget).

**Simpler approach for titles:** Each widget box uses `title={widget.label}` and `titleAlignment="left"`. opentui renders the title in the top border of the box. But since we disabled the top border... the title won't render.

**Resolution:** Widget labels are rendered as the first line of content inside the widget box:

```tsx
<box border={sides} borderColor={focused ? theme.border_highlight : theme.border}>
  <text fg={focused ? theme.yellow : theme.fg_dim} content={widget.label} />
  <Show when={!collapsed}>
    <widget.component ... />
  </Show>
</box>
```

This avoids the title-in-border complexity entirely. The label takes 1 row of content space, same as the current `▸ Widget Label` approach.

#### Data Structures

```ts
// In widget-grid.ts

import type { BorderSides } from "@opentui/core";

/** A row in the computed grid layout */
export interface GridRow {
  widgets: GridWidget[];
  columns: 1 | 2;
}

/** A widget positioned within a grid row */
export interface GridWidget {
  id: WidgetId;
  def: WidgetDefinition;
  config: WidgetConfig;
  borderSides: BorderSides[];
  widthPercent: "100%" | "50%";
}

/** Complete grid layout — input to the rendering layer */
export interface GridLayout {
  rows: GridRow[];
  totalWidth: number;
}

/** Border line descriptor for rendering */
export interface BorderLine {
  type: "top" | "mid" | "bottom";
  content: string;  // pre-computed character string
}
```

#### Widget Grid Utility — Revised

The existing `widget-grid.ts` plan (Task 1.2) is expanded from ~15 lines to ~100 lines:

```ts
// widget-grid.ts (~100 LOC)

export function computeGridLayout(
  widgets: WidgetEntry[],
  panelWidth: number,
): GridLayout { ... }

export function computeRows(
  widgets: WidgetEntry[],
  panelWidth: number,
): GridRow[] { ... }

export function resolveSpan(
  span: WidgetSpan,
  panelWidth: number,
): "full" | "half" { ... }

export function getWidgetBorderSides(
  row: GridRow,
  widgetIndex: number,
): BorderSides[] { ... }

export function buildBorderLine(
  type: "top" | "mid" | "bottom",
  totalWidth: number,
  prevRow: GridRow | null,
  nextRow: GridRow | null,
): string { ... }

export function contentWidth(
  span: WidgetSpan,
  panelWidth: number,
): number { ... }
```

All functions are pure — they take data in, return data out. No side effects, no opentui dependency (just uses the `BorderChars` constant for character lookup). This makes them trivially testable without `testRender()`.

#### Widget Container — Revised

The `widget-container.tsx` rewrite from Phase 2 is updated to use the grid layout:

```tsx
export function WidgetContainer(props: WidgetContainerProps) {
  // ... keyboard nav (unchanged) ...

  const gridLayout = createMemo(() =>
    computeGridLayout(enabledWidgets(), props.availableWidth)
  );

  return (
    <box borderStyle="rounded" borderColor={...} title={...} flexDirection="column" flexGrow={1}>
      <Show when={!props.loading} fallback={...}>
        <Show when={props.status} fallback={...}>
          <scrollbox flexGrow={1}>
            <box flexDirection="column">
              <For each={gridLayout().rows}>
                {(row, rowIndex) => {
                  const isFirst = () => rowIndex() === 0;
                  const isLast = () => rowIndex() === gridLayout().rows.length - 1;
                  const prevRow = () => isFirst() ? null : gridLayout().rows[rowIndex() - 1];
                  const nextRow = () => isLast() ? null : gridLayout().rows[rowIndex() + 1];

                  return (
                    <>
                      {/* Top border for first row, or inter-row separator */}
                      <text
                        fg={theme.border}
                        content={buildBorderLine(
                          isFirst() ? "top" : "mid",
                          gridLayout().totalWidth,
                          prevRow(),
                          row,
                        )}
                      />

                      {/* Widget row */}
                      <box flexDirection="row">
                        <For each={row.widgets}>
                          {(widget) => (
                            <box
                              width={widget.widthPercent}
                              border={widget.borderSides}
                              borderStyle="rounded"
                              borderColor={isFocused(widget.id) ? theme.border_highlight : theme.border}
                              flexDirection="column"
                            >
                              <text
                                fg={isFocused(widget.id) ? theme.yellow : theme.fg_dim}
                                content={widget.def.label}
                              />
                              <Show when={!widget.config.collapsed}>
                                <widget.def.component
                                  width={contentWidth(widget.def.size_hint.span, props.availableWidth)}
                                  focused={isFocused(widget.id)}
                                  status={props.status}
                                />
                              </Show>
                            </box>
                          )}
                        </For>
                      </box>

                      {/* Bottom border for last row */}
                      <Show when={isLast()}>
                        <text
                          fg={theme.border}
                          content={buildBorderLine(
                            "bottom",
                            gridLayout().totalWidth,
                            row,
                            null,
                          )}
                        />
                      </Show>
                    </>
                  );
                }}
              </For>
            </box>
          </scrollbox>
        </Show>
      </Show>
    </box>
  );
}
```

**DECISION NEEDED:** The outer `<box borderStyle="rounded">` that wraps the entire widget container (with the `widgets: repoName` title) currently exists in the codebase. With the shared border design, the inner widgets now draw their own borders. Should the outer container border be **removed** (widgets fill edge-to-edge) or **kept** (double border on outer edges)? The plan assumes **removed** — the top/bottom border lines from the grid serve as the container border. The container title `widgets: repoName` moves to the top border line text.

**Revised approach for container border:** Remove the outer `borderStyle="rounded"` box. The grid's top border line serves as the container's top border. This avoids a doubled outer border. The container title is rendered by inserting it into the first `buildBorderLine` output:

```ts
function buildBorderLineWithTitle(
  line: string,
  title: string,
): string {
  // Insert title after first char: ╭─ Widget Title ─────╮
  if (title.length === 0 || line.length < 4) return line;
  const titleStr = ` ${title} `;
  const insertAt = 1; // after the corner char
  return line.slice(0, insertAt) + titleStr + line.slice(insertAt + titleStr.length);
}
```

### Test Plan for Shared Borders

The border algorithm has two testable layers:

#### Layer 1: Pure Function Tests (no testRender needed)

These test the grid computation and border line generation. Fast, deterministic, no UI framework.

**Test file:** `packages/render/src/lib/__tests__/widget-grid.test.ts`

```
describe("computeRows")
  ✓ two half-width widgets → 1 two-column row
  ✓ half + full → half in row 1, full in row 2
  ✓ full + half + half → full in row 1, half+half in row 2
  ✓ three half-width → row of 2 + row of 1
  ✓ single full-width → 1 one-column row
  ✓ narrow panel (< 50) → all half-width become full-width
  ✓ empty widgets → empty rows
  ✓ disabled widget excluded → pairing changes
  ✓ collapsed widget still pairs correctly

describe("resolveSpan")
  ✓ "half" at 60 cols → "half"
  ✓ "half" at 49 cols → "full"
  ✓ "half" at 50 cols → "half" (boundary)
  ✓ "full" at any width → "full"
  ✓ "auto" at any width → "full"

describe("getWidgetBorderSides")
  ✓ 1-column row → ["left", "right"]
  ✓ 2-column row, index 0 → ["left"]
  ✓ 2-column row, index 1 → ["left", "right"]

describe("buildBorderLine")
  ✓ top border, 1-col row → "╭───...───╮"
  ✓ top border, 2-col row → "╭───...──┬───...──╮"
  ✓ bottom border, 1-col row → "╰───...───╯"
  ✓ bottom border, 2-col row → "╰───...──┴───...──╯"
  ✓ mid border, 2-col→1-col → "├───...──┴───...──┤"
  ✓ mid border, 1-col→2-col → "├───...──┬───...──┤"
  ✓ mid border, 2-col→2-col → "├───...──┼───...──┤"
  ✓ mid border, 1-col→1-col → "├───...────────...┤"
  ✓ width=1 edge case → minimal border
  ✓ junction at exact midpoint for even widths
  ✓ junction at floor(width/2) for odd widths

describe("buildBorderLineWithTitle")
  ✓ inserts title into top border line
  ✓ truncates title if too long for border width
  ✓ empty title returns unchanged line
```

Estimated: ~150 LOC of tests.

#### Layer 2: Integration Tests (testRender + captureCharFrame)

These verify the rendered output contains correct border characters at the right positions.

**Test file:** `packages/render/src/components/widgets/__tests__/widget-grid-rendering.test.tsx`

```
describe("shared border rendering")
  ✓ two half-width widgets share vertical border (│ between them, not ││)
  ✓ half-width row above full-width row has ┴ junction
  ✓ full-width row above half-width row has ┬ junction
  ✓ two consecutive half-width rows have ┼ junction
  ✓ first row has ╭...╮ top border
  ✓ last row has ╰...╯ bottom border
  ✓ focused widget has highlighted vertical borders
  ✓ collapsed widget in 2-col row stretches to sibling height
  ✓ narrow panel (<50 cols) renders all widgets full-width (no ┬/┴)
  ✓ panel resize from wide to narrow recomputes grid
  ✓ single widget renders with full border box
```

Estimated: ~120 LOC of tests.

These tests use the existing `testRender()` + `captureCharFrame()` pattern. Example:

```ts
test("two half-width widgets share vertical border", async () => {
  const { renderOnce, captureCharFrame } = await testRender(
    () => (
      <WidgetGridTestHarness
        widgets={[halfWidget("a"), halfWidget("b")]}
        panelWidth={60}
      />
    ),
    { width: 60, height: 20 },
  );

  await renderOnce();
  const frame = captureCharFrame();

  // Top border should have ┬ junction at midpoint
  const lines = frame.split("\n");
  expect(lines[0]).toContain("┬");

  // Should NOT have doubled borders (╮╭ or ╯╰)
  expect(frame).not.toContain("╮╭");
  expect(frame).not.toContain("╯╰");

  // Should have shared vertical │ between widgets (not ││)
  for (const line of lines.slice(1, -1)) {
    expect(line).not.toMatch(/││/);
  }
});
```

## Completion Status

All phases complete:

- ✅ Phase 1: Foundation Types + Grid Algorithm (`widget-grid.ts`, updated `types.ts`)
- ✅ Phase 2: Grid Algorithm Tests (40 unit tests in `widget-grid.test.ts`)
- ✅ Phase 3: Widget Container Rewrite (`widget-container.tsx` with grid layout + scroll-to-focused)
- ✅ Phase 4: Widget Migrations (all 12 widgets updated to `size_hint`)
- ✅ Phase 5: Integration Tests (`widget-rendering.test.tsx`, `scrollbox-height.test.tsx`, `widget-container.integration.test.tsx`)

### Post-plan fixes
- **Scroll-to-focused bug:** `el.y` is screen-absolute, not content-relative. Fixed by using `el.y - scrollbox_ref.content.y`. Added `flexShrink={0}` on scrollbox content wrapper.
- **AGENTS.md:** Created with all accumulated project knowledge.
