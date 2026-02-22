import { describe, test, expect } from "bun:test";
import type { WidgetId } from "@overview/core";
import {
	resolveSpan,
	computeRows,
	buildBorderLine,
	buildBorderLineWithTitle,
	contentWidth,
	getWidgetBorderSides,
	type GridWidget,
	type GridRow,
} from "../widget-grid";

// ── helpers ────────────────────────────────────────────────────────────────

function makeWidget(id: WidgetId, span: "full" | "half" | "auto", enabled = true, collapsed = false, priority = 0): GridWidget {
	return {
		id,
		size_hint: { span, min_height: 2 },
		config: { id, enabled, priority, collapsed },
	};
}

function row(columns: 1 | 2, ...widgets: GridWidget[]): GridRow {
	return { widgets, columns };
}

// ── resolveSpan ────────────────────────────────────────────────────────────

describe("resolveSpan", () => {
	test("half at 60 cols → half", () => {
		expect(resolveSpan("half", 60)).toBe("half");
	});

	test("half at 50 cols → half", () => {
		expect(resolveSpan("half", 50)).toBe("half");
	});

	test("half at 40 cols → half (boundary)", () => {
		expect(resolveSpan("half", 40)).toBe("half");
	});

	test("half at 39 cols → full", () => {
		expect(resolveSpan("half", 39)).toBe("full");
	});

	test("full at any width → full", () => {
		expect(resolveSpan("full", 120)).toBe("full");
		expect(resolveSpan("full", 30)).toBe("full");
		expect(resolveSpan("full", 1)).toBe("full");
	});

	test("auto at any width → full", () => {
		expect(resolveSpan("auto", 120)).toBe("full");
		expect(resolveSpan("auto", 30)).toBe("full");
		expect(resolveSpan("auto", 1)).toBe("full");
	});
});

// ── computeRows ────────────────────────────────────────────────────────────

describe("computeRows", () => {
	test("two half-width widgets at wide panel → 1 two-column row", () => {
		const widgets = [
			makeWidget("git-status", "half", true, false, 0),
			makeWidget("repo-meta", "half", true, false, 1),
		];
		const rows = computeRows(widgets, 80);

		expect(rows).toHaveLength(1);
		expect(rows[0].columns).toBe(2);
		expect(rows[0].widgets).toHaveLength(2);
		expect(rows[0].widgets[0].id).toBe("git-status");
		expect(rows[0].widgets[1].id).toBe("repo-meta");
	});

	test("half + full → sorted by priority: half(p0) before full(p1)", () => {
		const widgets = [
			makeWidget("git-status", "half", true, false, 0),
			makeWidget("recent-commits", "full", true, false, 1),
		];
		const rows = computeRows(widgets, 80);

		expect(rows).toHaveLength(2);
		expect(rows[0].columns).toBe(1);
		expect(rows[0].widgets[0].id).toBe("git-status");
		expect(rows[1].columns).toBe(1);
		expect(rows[1].widgets[0].id).toBe("recent-commits");
	});

	test("full + half + half → full(p0) first, half pair(p1) second", () => {
		const widgets = [
			makeWidget("recent-commits", "full", true, false, 0),
			makeWidget("git-status", "half", true, false, 1),
			makeWidget("repo-meta", "half", true, false, 2),
		];
		const rows = computeRows(widgets, 80);

		expect(rows).toHaveLength(2);
		expect(rows[0].columns).toBe(1);
		expect(rows[0].widgets[0].id).toBe("recent-commits");
		expect(rows[1].columns).toBe(2);
		expect(rows[1].widgets[0].id).toBe("git-status");
		expect(rows[1].widgets[1].id).toBe("repo-meta");
	});

	test("three half-width → 2-column row + 1-column row", () => {
		const widgets = [
			makeWidget("git-status", "half", true, false, 0),
			makeWidget("repo-meta", "half", true, false, 1),
			makeWidget("branch-list", "half", true, false, 2),
		];
		const rows = computeRows(widgets, 80);

		expect(rows).toHaveLength(2);
		expect(rows[0].columns).toBe(2);
		expect(rows[0].widgets).toHaveLength(2);
		expect(rows[1].columns).toBe(1);
		expect(rows[1].widgets).toHaveLength(1);
		expect(rows[1].widgets[0].id).toBe("branch-list");
	});

	test("single full-width → 1 one-column row", () => {
		const widgets = [makeWidget("recent-commits", "full")];
		const rows = computeRows(widgets, 80);

		expect(rows).toHaveLength(1);
		expect(rows[0].columns).toBe(1);
		expect(rows[0].widgets[0].id).toBe("recent-commits");
	});

	test("narrow panel (< 40) → all half become full, each own row", () => {
		const widgets = [
			makeWidget("git-status", "half", true, false, 0),
			makeWidget("repo-meta", "half", true, false, 1),
			makeWidget("branch-list", "half", true, false, 2),
		];
		const rows = computeRows(widgets, 39);

		expect(rows).toHaveLength(3);
		rows.forEach((r) => {
			expect(r.columns).toBe(1);
			expect(r.widgets).toHaveLength(1);
		});
	});

	test("empty widgets → empty rows array", () => {
		expect(computeRows([], 80)).toEqual([]);
	});

	test("disabled widgets are excluded from rows", () => {
		const widgets = [
			makeWidget("git-status", "half", true, false, 0),
			makeWidget("repo-meta", "half", false, false, 1),
			makeWidget("branch-list", "half", true, false, 2),
		];
		const rows = computeRows(widgets, 80);

		expect(rows).toHaveLength(1);
		expect(rows[0].columns).toBe(2);
		expect(rows[0].widgets[0].id).toBe("git-status");
		expect(rows[0].widgets[1].id).toBe("branch-list");
	});

	test("order is preserved for same-type widgets", () => {
		const widgets = [
			makeWidget("github-prs", "half", true, false, 0),
			makeWidget("github-issues", "half", true, false, 1),
			makeWidget("github-ci", "half", true, false, 2),
			makeWidget("devpad-tasks", "half", true, false, 3),
		];
		const rows = computeRows(widgets, 80);

		expect(rows).toHaveLength(2);
		expect(rows[0].widgets[0].id).toBe("github-prs");
		expect(rows[0].widgets[1].id).toBe("github-issues");
		expect(rows[1].widgets[0].id).toBe("github-ci");
		expect(rows[1].widgets[1].id).toBe("devpad-tasks");
	});

	test("non-contiguous halfs pair together", () => {
		const widgets = [
			makeWidget("git-status", "half", true, false, 0),
			makeWidget("recent-commits", "full", true, false, 1),
			makeWidget("repo-meta", "half", true, false, 2),
		];
		const rows = computeRows(widgets, 80);

		expect(rows).toHaveLength(2);
		// half pair has min priority 0, full has priority 1 → pair first
		expect(rows[0].columns).toBe(2);
		expect(rows[0].widgets[0].id).toBe("git-status");
		expect(rows[0].widgets[1].id).toBe("repo-meta");
		expect(rows[1].columns).toBe(1);
		expect(rows[1].widgets[0].id).toBe("recent-commits");
	});

	test("full-width at priority 0 comes before halfs at priority 3+4", () => {
		const widgets = [
			makeWidget("recent-commits", "full", true, false, 0),
			makeWidget("git-status", "half", true, false, 3),
			makeWidget("repo-meta", "half", true, false, 4),
		];
		const rows = computeRows(widgets, 80);

		expect(rows).toHaveLength(2);
		expect(rows[0].columns).toBe(1);
		expect(rows[0].widgets[0].id).toBe("recent-commits");
		expect(rows[1].columns).toBe(2);
		expect(rows[1].widgets[0].id).toBe("git-status");
		expect(rows[1].widgets[1].id).toBe("repo-meta");
	});

	test("odd number of halfs → trailing half gets 1-column row", () => {
		const widgets = [
			makeWidget("git-status", "half", true, false, 0),
			makeWidget("repo-meta", "half", true, false, 1),
			makeWidget("branch-list", "half", true, false, 2),
			makeWidget("recent-commits", "half", true, false, 3),
			makeWidget("github-prs", "half", true, false, 4),
		];
		const rows = computeRows(widgets, 80);

		expect(rows).toHaveLength(3);
		expect(rows[0].columns).toBe(2);
		expect(rows[0].widgets[0].id).toBe("git-status");
		expect(rows[0].widgets[1].id).toBe("repo-meta");
		expect(rows[1].columns).toBe(2);
		expect(rows[1].widgets[0].id).toBe("branch-list");
		expect(rows[1].widgets[1].id).toBe("recent-commits");
		expect(rows[2].columns).toBe(1);
		expect(rows[2].widgets[0].id).toBe("github-prs");
	});
});

// ── buildBorderLine ────────────────────────────────────────────────────────

describe("buildBorderLine", () => {
	const W = 20;

	const oneCol = row(1, makeWidget("git-status", "full"));
	const twoCol = row(2, makeWidget("git-status", "half"), makeWidget("repo-meta", "half"));

	test("top border, 1-col next row → corners + horizontal fill", () => {
		const line = buildBorderLine("top", W, null, oneCol);
		expect(line.length).toBe(W);
		expect(line[0]).toBe("╭");
		expect(line[W - 1]).toBe("╮");
		// No junction — all interior chars are horizontal
		for (let i = 1; i < W - 1; i++) {
			expect(line[i]).toBe("─");
		}
	});

	test("top border, 2-col next row → has ┬ at midpoint", () => {
		const line = buildBorderLine("top", W, null, twoCol);
		expect(line.length).toBe(W);
		expect(line[0]).toBe("╭");
		expect(line[W - 1]).toBe("╮");
		expect(line[10]).toBe("┬");
	});

	test("bottom border, 1-col prev row → corners only", () => {
		const line = buildBorderLine("bottom", W, oneCol, null);
		expect(line.length).toBe(W);
		expect(line[0]).toBe("╰");
		expect(line[W - 1]).toBe("╯");
		for (let i = 1; i < W - 1; i++) {
			expect(line[i]).toBe("─");
		}
	});

	test("bottom border, 2-col prev row → has ┴ at midpoint", () => {
		const line = buildBorderLine("bottom", W, twoCol, null);
		expect(line.length).toBe(W);
		expect(line[0]).toBe("╰");
		expect(line[W - 1]).toBe("╯");
		expect(line[10]).toBe("┴");
	});

	test("mid border, 2-col prev → 1-col next → ┴ at midpoint", () => {
		const line = buildBorderLine("mid", W, twoCol, oneCol);
		expect(line.length).toBe(W);
		expect(line[0]).toBe("├");
		expect(line[W - 1]).toBe("┤");
		expect(line[10]).toBe("┴");
	});

	test("mid border, 1-col prev → 2-col next → ┬ at midpoint", () => {
		const line = buildBorderLine("mid", W, oneCol, twoCol);
		expect(line.length).toBe(W);
		expect(line[0]).toBe("├");
		expect(line[W - 1]).toBe("┤");
		expect(line[10]).toBe("┬");
	});

	test("mid border, 2-col prev → 2-col next → ┼ at midpoint", () => {
		const line = buildBorderLine("mid", W, twoCol, twoCol);
		expect(line.length).toBe(W);
		expect(line[0]).toBe("├");
		expect(line[W - 1]).toBe("┤");
		expect(line[10]).toBe("┼");
	});

	test("mid border, 1-col prev → 1-col next → no junction", () => {
		const line = buildBorderLine("mid", W, oneCol, oneCol);
		expect(line.length).toBe(W);
		expect(line[0]).toBe("├");
		expect(line[W - 1]).toBe("┤");
		for (let i = 1; i < W - 1; i++) {
			expect(line[i]).toBe("─");
		}
	});

	test("line length always equals total_width", () => {
		const widths = [1, 2, 5, 20, 80, 120];
		for (const w of widths) {
			expect(buildBorderLine("top", w, null, oneCol).length).toBe(w);
			expect(buildBorderLine("mid", w, oneCol, twoCol).length).toBe(w);
			expect(buildBorderLine("bottom", w, twoCol, null).length).toBe(w);
		}
	});

	test("first char is always left corner/T, last is always right corner/T", () => {
		const cases: ["top" | "mid" | "bottom", string, string][] = [
			["top", "╭", "╮"],
			["mid", "├", "┤"],
			["bottom", "╰", "╯"],
		];
		for (const [type, left, right] of cases) {
			const line = buildBorderLine(type, W, oneCol, oneCol);
			expect(line[0]).toBe(left);
			expect(line[W - 1]).toBe(right);
		}
	});

	test("odd total_width: junction at floor(width/2)", () => {
		const odd_w = 21;
		const line = buildBorderLine("top", odd_w, null, twoCol);
		expect(line.length).toBe(odd_w);
		expect(line[Math.floor(odd_w / 2)]).toBe("┬");
		expect(line[0]).toBe("╭");
		expect(line[odd_w - 1]).toBe("╮");
	});
});

// ── buildBorderLineWithTitle ───────────────────────────────────────────────

describe("buildBorderLineWithTitle", () => {
	const base = buildBorderLine("top", 20, null, row(1, makeWidget("git-status", "full")));

	test("inserts title into border line after first char", () => {
		const result = buildBorderLineWithTitle(base, "Hello");
		expect(result.length).toBe(20);
		expect(result[0]).toBe("╭");
		expect(result.slice(1, 8)).toBe(" Hello ");
		expect(result[19]).toBe("╮");
	});

	test("empty title returns unchanged line", () => {
		expect(buildBorderLineWithTitle(base, "")).toBe(base);
	});

	test("very long title gets truncated with …", () => {
		const long_title = "A".repeat(50);
		const result = buildBorderLineWithTitle(base, long_title);
		expect(result.length).toBe(20);
		expect(result).toContain("…");
		expect(result[0]).toBe("╭");
		expect(result[19]).toBe("╮");
	});

	test("title fits exactly (boundary)", () => {
		// line length 20, corners take 2 chars → 18 interior
		// title_str = ` ${title} ` must be < line.length - 2 (18) to avoid truncation
		// max non-truncated title_str length = 17 → title length = 15
		const exact_title = "A".repeat(15);
		const result = buildBorderLineWithTitle(base, exact_title);
		expect(result.length).toBe(20);
		expect(result[0]).toBe("╭");
		expect(result[19]).toBe("╮");
		expect(result).toContain(exact_title);
		expect(result).not.toContain("…");
	});
});

// ── getWidgetBorderSides ───────────────────────────────────────────────────

describe("getWidgetBorderSides", () => {
	test("single-column row gets both sides", () => {
		const r: GridRow = { widgets: [makeWidget("git-status", "full")], columns: 1 };
		expect(getWidgetBorderSides(r, 0)).toEqual(["left", "right"]);
	});

	test("two-column row: left widget gets left only", () => {
		const r: GridRow = { widgets: [makeWidget("git-status", "half"), makeWidget("repo-meta", "half")], columns: 2 };
		expect(getWidgetBorderSides(r, 0)).toEqual(["left"]);
	});

	test("two-column row: right widget gets left and right", () => {
		const r: GridRow = { widgets: [makeWidget("git-status", "half"), makeWidget("repo-meta", "half")], columns: 2 };
		expect(getWidgetBorderSides(r, 1)).toEqual(["left", "right"]);
	});
});

// ── contentWidth ───────────────────────────────────────────────────────────

describe("contentWidth", () => {
	test("full span at 60 → 58", () => {
		expect(contentWidth("full", 60)).toBe(58);
	});

	test("half span at 60 → 28", () => {
		expect(contentWidth("half", 60)).toBe(28);
	});

	test("half span at 39 → 37 (falls back to full)", () => {
		expect(contentWidth("half", 39)).toBe(37);
	});

	test("returns at least 1 for very small widths", () => {
		expect(contentWidth("full", 1)).toBe(1);
		expect(contentWidth("full", 2)).toBe(1);
		expect(contentWidth("half", 2)).toBe(1);
	});
});
