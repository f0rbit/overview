import { describe, test, expect } from "bun:test";
import { testRender } from "@opentui/solid";

// ── helpers ────────────────────────────────────────────────────────────────

function nonEmptyLines(frame: string): string[] {
	return frame.split("\n").filter((l) => l.trim().length > 0);
}

// ── Test A: overflow="hidden" clips content beyond allocated rows ──────────

function OverflowWidget(props: { allocated_rows: number; width: number; focused: boolean; status: any }) {
	return (
		<box flexDirection="column">
			<box height={1}><text content="line 1" /></box>
			<box height={1}><text content="line 2" /></box>
			<box height={1}><text content="line 3" /></box>
			<box height={1}><text content="line 4" /></box>
			<box height={1}><text content="line 5" /></box>
		</box>
	);
}

describe("widget overflow clipping", () => {
	test("box with overflow=hidden clips content beyond allocated rows", async () => {
		const allocated = 3;
		const { renderOnce, captureCharFrame } = await testRender(
			() => (
				<box height={allocated} overflow="hidden">
					<OverflowWidget allocated_rows={allocated} width={60} focused={false} status={null} />
				</box>
			),
			{ width: 60, height: 20 },
		);

		await renderOnce();
		const frame = captureCharFrame();
		const lines = nonEmptyLines(frame);

		// overflow="hidden" must clip to exactly the allocated row count
		expect(lines.length).toBeLessThanOrEqual(allocated);

		// first lines should be visible, later ones clipped
		expect(frame).toContain("line 1");
		expect(frame).toContain("line 2");
		expect(frame).toContain("line 3");
		expect(frame).not.toContain("line 4");
		expect(frame).not.toContain("line 5");
	});
});

// ── Test B: focus label reduces widget content area by 1 row ───────────────

function LabelledWidget(props: { allocated_rows: number; width: number; focused: boolean; status: any }) {
	const rows = [
		"content row 1",
		"content row 2",
		"content row 3",
		"content row 4",
	];
	const visible = rows.slice(0, props.allocated_rows);

	return (
		<box flexDirection="column">
			{visible.map((r) => (
				<box height={1}><text content={r} /></box>
			))}
		</box>
	);
}

describe("widget focus label accounting", () => {
	test("focus label takes 1 row, reducing visible widget content", async () => {
		const total_rows = 4;
		const widget_rows = total_rows - 1; // 1 row reserved for label

		const { renderOnce, captureCharFrame } = await testRender(
			() => (
				<box height={total_rows} flexDirection="column" overflow="hidden">
					<box height={1}><text content="▸ Widget Label" /></box>
					<LabelledWidget
						allocated_rows={widget_rows}
						width={60}
						focused={true}
						status={null}
					/>
				</box>
			),
			{ width: 60, height: 20 },
		);

		await renderOnce();
		const frame = captureCharFrame();
		const lines = nonEmptyLines(frame);

		// total visible rows must not exceed container height
		expect(lines.length).toBeLessThanOrEqual(total_rows);

		// label is present
		expect(frame).toContain("▸ Widget Label");

		// widget sliced to 3 rows — rows 1-3 visible, row 4 absent
		expect(frame).toContain("content row 1");
		expect(frame).toContain("content row 2");
		expect(frame).toContain("content row 3");
		expect(frame).not.toContain("content row 4");
	});
});

// ── Test C: milestones visible_count slicing logic ─────────────────────────

function MilestonesSliceWidget(props: { allocated_rows: number }) {
	const milestones = [
		{ name: "milestone-A" },
		{ name: "milestone-B" },
		{ name: "milestone-C" },
		{ name: "milestone-D" },
	];

	const visible_count = Math.max(0, Math.floor(props.allocated_rows / 2));
	const visible = milestones.slice(0, visible_count);
	const overflow = Math.max(0, milestones.length - visible_count);

	return (
		<box flexDirection="column">
			{visible.map((ms) => (
				<box flexDirection="column" height={2}>
					<text content={ms.name} />
					<text content="████░░░░" />
				</box>
			))}
			{overflow > 0 && <text content={`+${overflow} more`} />}
		</box>
	);
}

describe("milestones visible_count logic", () => {
	test("allocated_rows=4 shows exactly 2 milestones (each takes 2 rows)", async () => {
		const { renderOnce, captureCharFrame } = await testRender(
			() => <MilestonesSliceWidget allocated_rows={4} />,
			{ width: 60, height: 20 },
		);

		await renderOnce();
		const frame = captureCharFrame();

		expect(frame).toContain("milestone-A");
		expect(frame).toContain("milestone-B");
		expect(frame).not.toContain("milestone-C");
		expect(frame).not.toContain("milestone-D");
		expect(frame).toContain("+2 more");
	});

	test("allocated_rows=6 shows 3 milestones", async () => {
		const { renderOnce, captureCharFrame } = await testRender(
			() => <MilestonesSliceWidget allocated_rows={6} />,
			{ width: 60, height: 20 },
		);

		await renderOnce();
		const frame = captureCharFrame();

		expect(frame).toContain("milestone-A");
		expect(frame).toContain("milestone-B");
		expect(frame).toContain("milestone-C");
		expect(frame).not.toContain("milestone-D");
		expect(frame).toContain("+1 more");
	});

	test("allocated_rows=3 shows only 1 milestone (floor(3/2)=1)", async () => {
		const { renderOnce, captureCharFrame } = await testRender(
			() => <MilestonesSliceWidget allocated_rows={3} />,
			{ width: 60, height: 20 },
		);

		await renderOnce();
		const frame = captureCharFrame();

		expect(frame).toContain("milestone-A");
		expect(frame).not.toContain("milestone-B");
		expect(frame).toContain("+3 more");
	});
});
