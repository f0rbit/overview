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

function makeWidget(id: WidgetId, span: "full" | "half" | "third" | "auto", enabled = true, collapsed = false, priority = 0): GridWidget {
	return {
		id,
		size_hint: { span, min_height: 2 },
		config: { id, enabled, priority, collapsed },
	};
}

function row(columns: 1 | 2 | 3, ...widgets: GridWidget[]): GridRow {
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

	test("third at 60 cols → third", () => {
		expect(resolveSpan("third", 60)).toBe("third");
	});

	test("third at 59 cols → half (cascading fallback)", () => {
		expect(resolveSpan("third", 59)).toBe("half");
	});

	test("third at 40 cols → half", () => {
		expect(resolveSpan("third", 40)).toBe("half");
	});

	test("third at 39 cols → full (double fallback)", () => {
		expect(resolveSpan("third", 39)).toBe("full");
	});

	test("third at 100 cols → third", () => {
		expect(resolveSpan("third", 100)).toBe("third");
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

	test("three third-width widgets → 1 three-column row", () => {
		const widgets = [
			makeWidget("git-status", "third", true, false, 0),
			makeWidget("repo-meta", "third", true, false, 1),
			makeWidget("github-ci", "third", true, false, 2),
		];
		const rows = computeRows(widgets, 80);

		expect(rows).toHaveLength(1);
		expect(rows[0].columns).toBe(3);
		expect(rows[0].widgets).toHaveLength(3);
		expect(rows[0].widgets[0].id).toBe("git-status");
		expect(rows[0].widgets[1].id).toBe("repo-meta");
		expect(rows[0].widgets[2].id).toBe("github-ci");
	});

	test("four thirds → 3-col row + 1-col row (auto-expand)", () => {
		const widgets = [
			makeWidget("git-status", "third", true, false, 0),
			makeWidget("repo-meta", "third", true, false, 1),
			makeWidget("github-ci", "third", true, false, 2),
			makeWidget("commit-activity", "third", true, false, 3),
		];
		const rows = computeRows(widgets, 80);

		expect(rows).toHaveLength(2);
		expect(rows[0].columns).toBe(3);
		expect(rows[0].widgets).toHaveLength(3);
		expect(rows[1].columns).toBe(1);
		expect(rows[1].widgets).toHaveLength(1);
		expect(rows[1].widgets[0].id).toBe("commit-activity");
	});

	test("five thirds → 3-col row + 2-col row (auto-expand)", () => {
		const widgets = [
			makeWidget("git-status", "third", true, false, 0),
			makeWidget("repo-meta", "third", true, false, 1),
			makeWidget("github-ci", "third", true, false, 2),
			makeWidget("commit-activity", "third", true, false, 3),
			makeWidget("github-release", "third", true, false, 4),
		];
		const rows = computeRows(widgets, 80);

		expect(rows).toHaveLength(2);
		expect(rows[0].columns).toBe(3);
		expect(rows[0].widgets).toHaveLength(3);
		expect(rows[1].columns).toBe(2);
		expect(rows[1].widgets).toHaveLength(2);
		expect(rows[1].widgets[0].id).toBe("commit-activity");
		expect(rows[1].widgets[1].id).toBe("github-release");
	});

	test("mixed thirds + halfs + fulls", () => {
		const widgets = [
			makeWidget("recent-commits", "full", true, false, 0),
			makeWidget("git-status", "third", true, false, 1),
			makeWidget("repo-meta", "third", true, false, 2),
			makeWidget("github-ci", "third", true, false, 3),
			makeWidget("branch-list", "half", true, false, 4),
			makeWidget("github-prs", "half", true, false, 5),
		];
		const rows = computeRows(widgets, 80);

		expect(rows).toHaveLength(3);
		// Sort by min priority: full(0), thirds(1), halfs(4)
		expect(rows[0].columns).toBe(1);
		expect(rows[0].widgets[0].id).toBe("recent-commits");
		expect(rows[1].columns).toBe(3);
		expect(rows[1].widgets[0].id).toBe("git-status");
		expect(rows[2].columns).toBe(2);
		expect(rows[2].widgets[0].id).toBe("branch-list");
	});

	test("thirds at narrow panel (<60) fall back to half pairing", () => {
		const widgets = [
			makeWidget("git-status", "third", true, false, 0),
			makeWidget("repo-meta", "third", true, false, 1),
			makeWidget("github-ci", "third", true, false, 2),
		];
		const rows = computeRows(widgets, 50);

		// thirds resolve to half at 50 cols → paired as halfs
		expect(rows).toHaveLength(2);
		expect(rows[0].columns).toBe(2);
		expect(rows[0].widgets).toHaveLength(2);
		expect(rows[1].columns).toBe(1);
		expect(rows[1].widgets).toHaveLength(1);
	});

	test("thirds at very narrow panel (<40) fall back to full", () => {
		const widgets = [
			makeWidget("git-status", "third", true, false, 0),
			makeWidget("repo-meta", "third", true, false, 1),
			makeWidget("github-ci", "third", true, false, 2),
		];
		const rows = computeRows(widgets, 35);

		// thirds resolve to full at <40 cols → each gets own row
		expect(rows).toHaveLength(3);
		rows.forEach((r) => {
			expect(r.columns).toBe(1);
			expect(r.widgets).toHaveLength(1);
		});
	});
});

// ── buildBorderLine ────────────────────────────────────────────────────────

describe("buildBorderLine", () => {
	const W = 20;

	const oneCol = row(1, makeWidget("git-status", "full"));
	const twoCol = row(2, makeWidget("git-status", "half"), makeWidget("repo-meta", "half"));
	const threeCol = row(3, makeWidget("git-status", "third"), makeWidget("repo-meta", "third"), makeWidget("github-ci", "third"));

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

	test("top border, 3-col next row → has two junctions", () => {
		const W = 30;
		const line = buildBorderLine("top", W, null, threeCol);
		expect(line.length).toBe(W);
		expect(line[0]).toBe("╭");
		expect(line[W - 1]).toBe("╮");
		expect(line[10]).toBe("┬"); // Math.floor(30/3) = 10
		expect(line[20]).toBe("┬"); // Math.floor(60/3) = 20
	});

	test("bottom border, 3-col prev row → has two ┴ junctions", () => {
		const W = 30;
		const line = buildBorderLine("bottom", W, threeCol, null);
		expect(line.length).toBe(W);
		expect(line[0]).toBe("╰");
		expect(line[W - 1]).toBe("╯");
		expect(line[10]).toBe("┴");
		expect(line[20]).toBe("┴");
	});

	test("mid border, 3-col → 3-col → has two ┼ junctions", () => {
		const W = 30;
		const line = buildBorderLine("mid", W, threeCol, threeCol);
		expect(line.length).toBe(W);
		expect(line[0]).toBe("├");
		expect(line[W - 1]).toBe("┤");
		expect(line[10]).toBe("┼");
		expect(line[20]).toBe("┼");
	});

	test("mid border, 3-col → 1-col → two ┴ junctions", () => {
		const W = 30;
		const line = buildBorderLine("mid", W, threeCol, oneCol);
		expect(line.length).toBe(W);
		expect(line[0]).toBe("├");
		expect(line[W - 1]).toBe("┤");
		expect(line[10]).toBe("┴");
		expect(line[20]).toBe("┴");
	});

	test("mid border, 1-col → 3-col → two ┬ junctions", () => {
		const W = 30;
		const line = buildBorderLine("mid", W, oneCol, threeCol);
		expect(line.length).toBe(W);
		expect(line[0]).toBe("├");
		expect(line[W - 1]).toBe("┤");
		expect(line[10]).toBe("┬");
		expect(line[20]).toBe("┬");
	});

	test("mid border, 3-col → 2-col → mixed junctions", () => {
		// 3-col junctions at 10, 20 (for W=30)
		// 2-col junction at 15 (for W=30)
		// At 10: in prev only → ┴
		// At 15: in next only → ┬
		// At 20: in prev only → ┴
		const W = 30;
		const line = buildBorderLine("mid", W, threeCol, twoCol);
		expect(line.length).toBe(W);
		expect(line[0]).toBe("├");
		expect(line[W - 1]).toBe("┤");
		expect(line[10]).toBe("┴");  // from 3-col above only
		expect(line[15]).toBe("┬");  // from 2-col below only
		expect(line[20]).toBe("┴");  // from 3-col above only
	});

	test("mid border, 2-col → 3-col → mixed junctions", () => {
		const W = 30;
		const line = buildBorderLine("mid", W, twoCol, threeCol);
		expect(line.length).toBe(W);
		expect(line[0]).toBe("├");
		expect(line[W - 1]).toBe("┤");
		expect(line[10]).toBe("┬");  // from 3-col below only
		expect(line[15]).toBe("┴");  // from 2-col above only
		expect(line[20]).toBe("┬");  // from 3-col below only
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

	test("three-column row: left widget gets left only", () => {
		const r: GridRow = { widgets: [makeWidget("git-status", "third"), makeWidget("repo-meta", "third"), makeWidget("github-ci", "third")], columns: 3 };
		expect(getWidgetBorderSides(r, 0)).toEqual(["left"]);
	});

	test("three-column row: middle widget gets left only", () => {
		const r: GridRow = { widgets: [makeWidget("git-status", "third"), makeWidget("repo-meta", "third"), makeWidget("github-ci", "third")], columns: 3 };
		expect(getWidgetBorderSides(r, 1)).toEqual(["left"]);
	});

	test("three-column row: right widget gets left and right", () => {
		const r: GridRow = { widgets: [makeWidget("git-status", "third"), makeWidget("repo-meta", "third"), makeWidget("github-ci", "third")], columns: 3 };
		expect(getWidgetBorderSides(r, 2)).toEqual(["left", "right"]);
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

	test("third span at 90 → 29", () => {
		// Math.floor(90/3) = 30, minus 1 border = 29
		expect(contentWidth("third", 90)).toBe(29);
	});

	test("third span at 60 → 19", () => {
		// Math.floor(60/3) = 20, minus 1 border = 19
		expect(contentWidth("third", 60)).toBe(19);
	});

	test("third span at 50 → falls back to half → 23", () => {
		// At 50 cols, third resolves to half
		// junction = Math.floor(50/2) = 25, content = 50 - 25 - 2 = 23
		expect(contentWidth("third", 50)).toBe(23);
	});

	test("third span at 39 → falls back to full → 37", () => {
		// At 39 cols, third resolves to full
		expect(contentWidth("third", 39)).toBe(37);
	});
});
