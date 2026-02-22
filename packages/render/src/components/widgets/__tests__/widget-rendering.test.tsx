import { describe, test, expect } from "bun:test";
import { testRender } from "@opentui/solid";
import { buildBorderLine, resolveSpan, type GridRow } from "../../../lib/widget-grid";

// ── helpers ────────────────────────────────────────────────────────────────

const twoColRow: GridRow = { widgets: [{} as any, {} as any], columns: 2 };
const oneColRow: GridRow = { widgets: [{} as any], columns: 1 };

// ── grid layout rendering ──────────────────────────────────────────────────

describe("grid layout rendering", () => {
	test("two half-width widgets render side-by-side with shared border", async () => {
		const width = 60;
		const junction_col = Math.floor(width / 2);
		const { renderOnce, captureCharFrame } = await testRender(
			() => (
				<box flexDirection="column" width={width}>
					<text content={buildBorderLine("top", width, null, twoColRow)} />
					<box flexDirection="row" alignItems="stretch" width={width}>
						<box width={junction_col} border={["left"]} borderStyle="rounded" flexDirection="column">
							<text content="Widget A" />
							<text content="content a" />
						</box>
						<box width={width - junction_col} border={["left", "right"]} borderStyle="rounded" flexDirection="column">
							<text content="Widget B" />
							<text content="content b" />
						</box>
					</box>
					<text content={buildBorderLine("bottom", width, twoColRow, null)} />
				</box>
			),
			{ width: 80, height: 20 },
		);

		await renderOnce();
		const frame = captureCharFrame();

		expect(frame).toContain("Widget A");
		expect(frame).toContain("Widget B");
		expect(frame).toContain("content a");
		expect(frame).toContain("content b");

		// top border has junction
		expect(frame).toContain("┬");
		// bottom border has junction
		expect(frame).toContain("┴");

		// no doubled borders — shared divider means no ╮╭ or ╯╰ adjacency
		expect(frame).not.toContain("╮╭");
		expect(frame).not.toContain("╯╰");
	});

	test("full-width widget renders with full border", async () => {
		const width = 40;
		const { renderOnce, captureCharFrame } = await testRender(
			() => (
				<box flexDirection="column" width={width}>
					<text content={buildBorderLine("top", width, null, oneColRow)} />
					<box flexDirection="row" width={width}>
						<box width={width} border={["left", "right"]} borderStyle="rounded" flexDirection="column">
							<text content="Full Widget" />
							<text content="full content" />
						</box>
					</box>
					<text content={buildBorderLine("bottom", width, oneColRow, null)} />
				</box>
			),
			{ width: 60, height: 20 },
		);

		await renderOnce();
		const frame = captureCharFrame();

		expect(frame).toContain("Full Widget");
		expect(frame).toContain("full content");

		const lines = frame.split("\n").filter((l: string) => l.trim().length > 0);
		const top_line = lines[0]!;
		const bottom_line = lines[lines.length - 1]!;

		// top border corners
		expect(top_line.trimStart()).toMatch(/^╭/);
		expect(top_line.trimEnd()).toMatch(/╮$/);

		// bottom border corners
		expect(bottom_line.trimStart()).toMatch(/^╰/);
		expect(bottom_line.trimEnd()).toMatch(/╯$/);

		// no junction characters in single-column layout
		expect(frame).not.toContain("┬");
		expect(frame).not.toContain("┴");
		expect(frame).not.toContain("┼");
	});

	test("mixed layout — half-width row followed by full-width row", async () => {
		const width = 60;
		const junction_col = Math.floor(width / 2);
		const { renderOnce, captureCharFrame } = await testRender(
			() => (
				<box flexDirection="column" width={width}>
					<text content={buildBorderLine("top", width, null, twoColRow)} />
					<box flexDirection="row" alignItems="stretch" width={width}>
						<box width={junction_col} border={["left"]} borderStyle="rounded" flexDirection="column">
							<text content="Half A" />
						</box>
						<box width={width - junction_col} border={["left", "right"]} borderStyle="rounded" flexDirection="column">
							<text content="Half B" />
						</box>
					</box>
					<text content={buildBorderLine("mid", width, twoColRow, oneColRow)} />
					<box flexDirection="row" width={width}>
						<box width={width} border={["left", "right"]} borderStyle="rounded" flexDirection="column">
							<text content="Full C" />
						</box>
					</box>
					<text content={buildBorderLine("bottom", width, oneColRow, null)} />
				</box>
			),
			{ width: 80, height: 20 },
		);

		await renderOnce();
		const frame = captureCharFrame();

		expect(frame).toContain("Half A");
		expect(frame).toContain("Half B");
		expect(frame).toContain("Full C");

		// verify border line characters directly from buildBorderLine output
		const top_border = buildBorderLine("top", width, null, twoColRow);
		const mid_border = buildBorderLine("mid", width, twoColRow, oneColRow);
		const bottom_border = buildBorderLine("bottom", width, oneColRow, null);

		// top border has ┬ at midpoint (2-col below)
		expect(top_border).toContain("┬");

		// mid border: 2-col above merges into 1-col below → ┴ at junction
		expect(mid_border).toContain("┴");
		// mid border starts with ├ and ends with ┤
		expect(mid_border[0]).toBe("├");
		expect(mid_border[mid_border.length - 1]).toBe("┤");

		// bottom border has no junction chars
		expect(bottom_border).not.toContain("┬");
		expect(bottom_border).not.toContain("┴");
		expect(bottom_border).not.toContain("┼");

		// all border lines appear in the rendered frame
		expect(frame).toContain(top_border);
		expect(frame).toContain(mid_border);
		expect(frame).toContain(bottom_border);
	});

	test("narrow panel falls back to single column", () => {
		// pure function — no rendering needed
		expect(resolveSpan("half", 39)).toBe("full");
		expect(resolveSpan("half", 40)).toBe("half");
		expect(resolveSpan("half", 50)).toBe("half");
		expect(resolveSpan("half", 100)).toBe("half");
		expect(resolveSpan("full", 100)).toBe("full");
	});

	test("collapsed widget shows label text", async () => {
		const width = 40;
		const { renderOnce, captureCharFrame } = await testRender(
			() => (
				<box flexDirection="row" width={width}>
					<box width={width} border={["left", "right"]} borderStyle="rounded" flexDirection="column" minHeight={1}>
						<text content="[>] Widget Name (collapsed)" />
					</box>
				</box>
			),
			{ width: 60, height: 20 },
		);

		await renderOnce();
		const frame = captureCharFrame();

		expect(frame).toContain("[>]");
		expect(frame).toContain("collapsed");
	});
});
