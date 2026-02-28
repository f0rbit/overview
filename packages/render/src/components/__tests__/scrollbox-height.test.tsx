import { describe, test, expect } from "bun:test";
import { testRender } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import type { ScrollBoxRenderable, Renderable } from "@opentui/core";

describe("scrollbox content height", () => {
	// Test 1: Simple case — many text lines in a scrollbox
	// Render a scrollbox with height=20 containing 50 lines of text
	// Verify scrollHeight >= 50
	test("simple text content reports correct scrollHeight", async () => {
		let sb_ref: ScrollBoxRenderable | undefined;
		const lines = Array.from({ length: 50 }, (_, i) => `Line ${i}`);

		const { renderOnce } = await testRender(
			() => (
				<box width={60} height={20}>
					<scrollbox ref={sb_ref} flexGrow={1}>
						<box flexDirection="column">
							{lines.map((l) => (
								<text content={l} />
							))}
						</box>
					</scrollbox>
				</box>
			),
			{ width: 60, height: 20 },
		);

		await renderOnce();

		console.log("Test 1 - Simple text:");
		console.log(`  scrollHeight=${sb_ref!.scrollHeight}`);
		console.log(`  viewport.height=${sb_ref!.viewport?.height}`);
		console.log(`  content.height=${sb_ref!.content?.height}`);
		console.log(`  sb_ref.height=${sb_ref!.height}`);

		expect(sb_ref!.scrollHeight).toBeGreaterThanOrEqual(50);
	});

	// Test 2: Box with flexDirection column wrapping text — mirrors our widget-container structure
	// Render a scrollbox with height=20 containing a column box with children that are
	// alternating <text> and <box> elements (simulating border lines + widget row boxes)
	test("nested boxes report correct scrollHeight", async () => {
		let sb_ref: ScrollBoxRenderable | undefined;
		const rows = Array.from({ length: 10 }, (_, i) => i);

		const { renderOnce } = await testRender(
			() => (
				<box width={60} height={20}>
					<scrollbox ref={sb_ref} flexGrow={1}>
						<box flexDirection="column" width={60} flexShrink={0}>
							{rows.map((i) => (
								<>
									<text content={`═══ Border ${i} ═══`} />
									<box flexDirection="row" width={60}>
										<box
											flexDirection="column"
											width={30}
											minHeight={5}
											border={["left", "right"]}
											borderStyle="rounded"
										>
											<text content={`Widget ${i}a`} />
											<text content="line 2" />
											<text content="line 3" />
										</box>
										<box
											flexDirection="column"
											width={30}
											minHeight={5}
											border={["left", "right"]}
											borderStyle="rounded"
										>
											<text content={`Widget ${i}b`} />
											<text content="line 2" />
											<text content="line 3" />
										</box>
									</box>
								</>
							))}
							<text content="═══ Bottom Border ═══" />
						</box>
					</scrollbox>
				</box>
			),
			{ width: 60, height: 20 },
		);

		await renderOnce();

		// Expected: 10 border lines + 10 row boxes (each minHeight=5) + 1 bottom border = 10 + 50 + 1 = 61
		console.log("Test 2 - Nested boxes (mirrors widget-container):");
		console.log(`  scrollHeight=${sb_ref!.scrollHeight}`);
		console.log(`  viewport.height=${sb_ref!.viewport?.height}`);
		console.log(`  content.height=${sb_ref!.content?.height}`);
		console.log(`  sb_ref.height=${sb_ref!.height}`);

		// The total content should be at least 61 lines (10 borders + 10*5 rows + 1 bottom)
		expect(sb_ref!.scrollHeight).toBeGreaterThanOrEqual(60);
	});

	// Test 3: Verify scrollTo can actually reach the bottom
	test("scrollTo can reach the last row", async () => {
		let sb_ref: ScrollBoxRenderable | undefined;
		const rows = Array.from({ length: 10 }, (_, i) => i);

		const { renderOnce } = await testRender(
			() => (
				<box width={60} height={20}>
					<scrollbox ref={sb_ref} flexGrow={1}>
						<box flexDirection="column" width={60} flexShrink={0}>
							{rows.map((i) => (
								<>
									<text content={`═══ Border ${i} ═══`} />
									<box flexDirection="row" width={60}>
										<box
											flexDirection="column"
											width={30}
											minHeight={5}
											border={["left", "right"]}
											borderStyle="rounded"
										>
											<text content={`Widget ${i}a`} />
										</box>
										<box
											flexDirection="column"
											width={30}
											minHeight={5}
											border={["left", "right"]}
											borderStyle="rounded"
										>
											<text content={`Widget ${i}b`} />
										</box>
									</box>
								</>
							))}
							<text content="═══ Bottom Border ═══" />
						</box>
					</scrollbox>
				</box>
			),
			{ width: 60, height: 20 },
		);

		await renderOnce();

		const max_scroll = sb_ref!.scrollHeight - (sb_ref!.viewport?.height ?? sb_ref!.height);
		const content_bottom = sb_ref!.scrollHeight;

		console.log("Test 3 - scrollTo reach:");
		console.log(`  scrollHeight=${sb_ref!.scrollHeight}`);
		console.log(`  viewport.height=${sb_ref!.viewport?.height}`);
		console.log(`  max_scroll=${max_scroll}`);
		console.log(`  content_bottom=${content_bottom}`);

		// Try to scroll to the bottom
		sb_ref!.scrollTo({ x: 0, y: max_scroll });
		console.log(`  after scrollTo(${max_scroll}): scrollTop=${sb_ref!.scrollTop}`);

		// The scrollTop should actually reach max_scroll
		expect(sb_ref!.scrollTop).toBe(max_scroll);

		// The last content should be visible (scrollTop + viewport >= content bottom)
		expect(sb_ref!.scrollTop + (sb_ref!.viewport?.height ?? sb_ref!.height)).toBeGreaterThanOrEqual(
			content_bottom,
		);
	});

	// Test 4: Fragment children (JSX <> </>) — this is what the widget-container uses
	// This tests if Fragment children cause yoga to miscalculate heights
	test("fragment children in scrollbox column", async () => {
		let sb_ref: ScrollBoxRenderable | undefined;
		const items = Array.from({ length: 15 }, (_, i) => i);

		const { renderOnce } = await testRender(
			() => (
				<box width={60} height={20}>
					<scrollbox ref={sb_ref} flexGrow={1}>
						<box flexDirection="column" width={60} flexShrink={0}>
							{items.map((i) => (
								<>
									<text content={`Header ${i}`} />
									<box flexDirection="column" minHeight={3}>
										<text content={`Content ${i} line 1`} />
										<text content={`Content ${i} line 2`} />
									</box>
								</>
							))}
						</box>
					</scrollbox>
				</box>
			),
			{ width: 60, height: 20 },
		);

		await renderOnce();

		// Expected: 15 headers + 15 boxes (each minHeight=3) = 15 + 45 = 60
		console.log("Test 4 - Fragment children:");
		console.log(`  scrollHeight=${sb_ref!.scrollHeight}`);
		console.log(`  viewport.height=${sb_ref!.viewport?.height}`);
		console.log(`  content.height=${sb_ref!.content?.height}`);

		expect(sb_ref!.scrollHeight).toBeGreaterThanOrEqual(60);
	});

	// Test 5: Without intermediate box — children directly in scrollbox
	test("children directly in scrollbox (no intermediate box)", async () => {
		let sb_ref: ScrollBoxRenderable | undefined;
		const lines = Array.from({ length: 50 }, (_, i) => `Line ${i}`);

		const { renderOnce } = await testRender(
			() => (
				<box width={60} height={20}>
					<scrollbox ref={sb_ref} flexGrow={1}>
						{lines.map((l) => (
							<text content={l} />
						))}
					</scrollbox>
				</box>
			),
			{ width: 60, height: 20 },
		);

		await renderOnce();

		console.log("Test 5 - Direct children (no intermediate box):");
		console.log(`  scrollHeight=${sb_ref!.scrollHeight}`);
		console.log(`  viewport.height=${sb_ref!.viewport?.height}`);
		console.log(`  content.height=${sb_ref!.content?.height}`);

		expect(sb_ref!.scrollHeight).toBeGreaterThanOrEqual(50);
	});

	// Test 6: With the outer box having explicit height (like widget-container does with height prop)
	test("scrollbox inside box with explicit height", async () => {
		let sb_ref: ScrollBoxRenderable | undefined;
		const lines = Array.from({ length: 50 }, (_, i) => `Line ${i}`);

		const { renderOnce } = await testRender(
			() => (
				<box flexDirection="column" width={60} height={30}>
					<scrollbox ref={sb_ref} flexGrow={1}>
						<box flexDirection="column" width={60} flexShrink={0}>
							{lines.map((l) => (
								<text content={l} />
							))}
						</box>
					</scrollbox>
				</box>
			),
			{ width: 60, height: 30 },
		);

		await renderOnce();

		console.log("Test 6 - Explicit outer height:");
		console.log(`  scrollHeight=${sb_ref!.scrollHeight}`);
		console.log(`  viewport.height=${sb_ref!.viewport?.height}`);
		console.log(`  content.height=${sb_ref!.content?.height}`);
		console.log(`  sb_ref.height=${sb_ref!.height}`);

		expect(sb_ref!.scrollHeight).toBeGreaterThanOrEqual(50);
	});

	// Test 7: Mimic the EXACT widget-container structure as closely as possible
	test("exact widget-container structure mimicry", async () => {
		let sb_ref: ScrollBoxRenderable | undefined;
		const row_refs: Renderable[] = [];

		// Simulate 9 rows of widgets (matching the real app's ~9 rows)
		const row_configs = [
			{ cols: 2, h: 10 }, // row 0: two half-width widgets
			{ cols: 1, h: 7 }, // row 1: full width
			{ cols: 2, h: 3 }, // row 2: two half-width
			{ cols: 1, h: 13 }, // row 3: full width tall
			{ cols: 2, h: 3 }, // row 4: two half-width
			{ cols: 2, h: 7 }, // row 5: two half-width
			{ cols: 1, h: 10 }, // row 6: full width
			{ cols: 2, h: 4 }, // row 7: two half-width
			{ cols: 1, h: 3 }, // row 8: full width
		];

		const total_width = 80;

		const { renderOnce } = await testRender(
			() => (
				<box flexDirection="column" width={total_width} height={26}>
					<scrollbox ref={sb_ref} flexGrow={1}>
						<box flexDirection="column" width={total_width} flexShrink={0}>
							{row_configs.map((rc, row_idx) => {
								const border_line = "─".repeat(total_width);
								const half = Math.floor(total_width / 2);

								return (
									<>
										<text content={border_line} />
										<box
											ref={(el: Renderable) => {
												row_refs[row_idx] = el;
											}}
											flexDirection="row"
											alignItems="stretch"
											width={total_width}
										>
											{rc.cols === 1 ? (
												<box
													width={total_width}
													border={["left", "right"]}
													borderStyle="rounded"
													flexDirection="column"
													minHeight={rc.h}
													overflow="hidden"
												>
													<text content={`Widget row ${row_idx}`} />
													{Array.from({ length: rc.h - 1 }, (_, j) => (
														<text content={`  content line ${j}`} />
													))}
												</box>
											) : (
												<>
													<box
														width={half}
														border={["left", "right"]}
														borderStyle="rounded"
														flexDirection="column"
														minHeight={rc.h}
														overflow="hidden"
													>
														<text content={`Widget row ${row_idx}a`} />
													</box>
													<box
														width={total_width - half}
														border={["left", "right"]}
														borderStyle="rounded"
														flexDirection="column"
														minHeight={rc.h}
														overflow="hidden"
													>
														<text content={`Widget row ${row_idx}b`} />
													</box>
												</>
											)}
										</box>
									</>
								);
							})}
							<text content={"─".repeat(total_width)} />
						</box>
					</scrollbox>
				</box>
			),
			{ width: 80, height: 26 },
		);

		await renderOnce();

		// Expected content height:
		// 9 border lines + sum of row heights (10+7+3+13+3+7+10+4+3 = 60) + 1 bottom border = 70
		// BUT with border on boxes, each box adds 0 height (left/right borders don't add height)
		// So total = 9 + 60 + 1 = 70
		console.log("Test 7 - Exact widget-container mimicry:");
		console.log(`  scrollHeight=${sb_ref!.scrollHeight}`);
		console.log(`  viewport.height=${sb_ref!.viewport?.height}`);
		console.log(`  content.height=${sb_ref!.content?.height}`);
		console.log(`  sb_ref.height=${sb_ref!.height}`);

		let cumulative = 0;
		for (let i = 0; i < row_configs.length; i++) {
			const ref = row_refs[i];
			if (ref) {
				const content_y = ref.y + sb_ref!.scrollTop;
				console.log(
					`  row ${i}: y=${ref.y} content_y=${content_y} height=${ref.height} (expected minHeight=${row_configs[i]!.h})`,
				);
				cumulative = content_y + ref.height;
			}
		}
		console.log(`  cumulative content bottom: ${cumulative}`);
		console.log(`  + border lines: ~${cumulative + 1} (bottom border)`);

		// Check if we can scroll to make the last row visible
		const vp_h = sb_ref!.viewport?.height ?? sb_ref!.height;
		const needed_scroll = cumulative + 1 - vp_h; // to see bottom border
		console.log(`  needed scroll to see bottom: ${needed_scroll}`);
		console.log(`  max allowed scroll: ${sb_ref!.scrollHeight - vp_h}`);

		sb_ref!.scrollTo({ x: 0, y: needed_scroll });
		console.log(`  after scrollTo(${needed_scroll}): scrollTop=${sb_ref!.scrollTop}`);

		// This should NOT be clamped
		expect(sb_ref!.scrollTop).toBe(needed_scroll);
	});

	// Test 8: scrollbox inside height="50%" container (real app layout)
	test("scrollbox inside height=50% container (real app layout)", async () => {
		let sb_ref: ScrollBoxRenderable | undefined;
		const row_refs: Renderable[] = [];

		const row_configs = [
			{ cols: 2, h: 10 },
			{ cols: 1, h: 7 },
			{ cols: 2, h: 3 },
			{ cols: 1, h: 13 },
			{ cols: 2, h: 3 },
			{ cols: 2, h: 7 },
			{ cols: 1, h: 10 },
			{ cols: 2, h: 4 },
			{ cols: 1, h: 3 },
		];

		const right_panel_width = 80;

		const { renderOnce } = await testRender(
			() => (
				<box flexDirection="column" width="100%" height="100%">
					<box height={1}>
						<text content="header" />
					</box>
					<box flexDirection="row" flexGrow={1}>
						<box width={40}>
							<text content="left panel" />
						</box>
						<box flexDirection="column" flexGrow={1}>
							<box height="50%">
								<text content="git graph placeholder" />
							</box>
							<box flexDirection="column" width={right_panel_width} height="50%">
								<scrollbox ref={sb_ref} flexGrow={1}>
									<box flexDirection="column" width={right_panel_width} flexShrink={0}>
										{row_configs.map((rc, row_idx) => {
											const border_line = "─".repeat(right_panel_width);
											const half = Math.floor(right_panel_width / 2);
											return (
												<>
													<text content={border_line} />
													<box
														ref={(el: Renderable) => {
															row_refs[row_idx] = el;
														}}
														flexDirection="row"
														alignItems="stretch"
														width={right_panel_width}
													>
														{rc.cols === 1 ? (
															<box
																width={right_panel_width}
																border={["left", "right"]}
																borderStyle="rounded"
																flexDirection="column"
																minHeight={rc.h}
																overflow="hidden"
															>
																<text content={`Widget row ${row_idx}`} />
																{Array.from({ length: rc.h - 1 }, (_, j) => (
																	<text content={`  content line ${j}`} />
																))}
															</box>
														) : (
															<>
																<box
																	width={half}
																	border={["left", "right"]}
																	borderStyle="rounded"
																	flexDirection="column"
																	minHeight={rc.h}
																	overflow="hidden"
																>
																	<text content={`Widget row ${row_idx}a`} />
																</box>
																<box
																	width={right_panel_width - half}
																	border={["left", "right"]}
																	borderStyle="rounded"
																	flexDirection="column"
																	minHeight={rc.h}
																	overflow="hidden"
																>
																	<text content={`Widget row ${row_idx}b`} />
																</box>
															</>
														)}
													</box>
												</>
											);
										})}
										<text content={"─".repeat(right_panel_width)} />
									</box>
								</scrollbox>
							</box>
						</box>
					</box>
					<box height={1}>
						<text content="status bar" />
					</box>
				</box>
			),
			{ width: 120, height: 40 },
		);

		await renderOnce();

		console.log("Test 8 - scrollbox inside height=50% container:");
		console.log(`  scrollHeight=${sb_ref!.scrollHeight}`);
		console.log(`  viewport.height=${sb_ref!.viewport?.height}`);
		console.log(`  content.height=${sb_ref!.content?.height}`);
		console.log(`  sb_ref.height=${sb_ref!.height}`);

		let cumulative = 0;
		for (let i = 0; i < row_configs.length; i++) {
			const ref = row_refs[i];
			if (ref) {
				const content_y = ref.y + sb_ref!.scrollTop;
				console.log(
					`  row ${i}: y=${ref.y} content_y=${content_y} height=${ref.height} (expected minHeight=${row_configs[i]!.h})`,
				);
				cumulative = content_y + ref.height;
			}
		}
		console.log(`  cumulative content bottom: ${cumulative}`);
		console.log(`  + border lines: ~${cumulative + 1} (bottom border)`);

		const vp_h = sb_ref!.viewport?.height ?? sb_ref!.height;
		const needed_scroll = cumulative + 1 - vp_h;
		console.log(`  needed scroll to see bottom: ${needed_scroll}`);
		console.log(`  max allowed scroll: ${sb_ref!.scrollHeight - vp_h}`);

		// scrollHeight should be 70 (same as test 7 — 9 borders + 60 row heights + 1 bottom)
		expect(sb_ref!.scrollHeight).toBeGreaterThanOrEqual(70);
	});

	// Test 9: scrollbox with flexGrow=1 inside percentage container (simplified)
	test("scrollbox with flexGrow=1 inside percentage container", async () => {
		let sb_ref: ScrollBoxRenderable | undefined;
		const lines = Array.from({ length: 50 }, (_, i) => `Line ${i}`);

		const { renderOnce } = await testRender(
			() => (
				<box flexDirection="column" width="100%" height="100%">
					<box height="50%">
						<text content="top half" />
					</box>
					<box height="50%" flexDirection="column">
						<scrollbox ref={sb_ref} flexGrow={1}>
							<box flexDirection="column" flexShrink={0}>
								{lines.map((l) => (
									<text content={l} />
								))}
							</box>
						</scrollbox>
					</box>
				</box>
			),
			{ width: 60, height: 40 },
		);

		await renderOnce();

		console.log("Test 9 - flexGrow=1 inside percentage container:");
		console.log(`  scrollHeight=${sb_ref!.scrollHeight}`);
		console.log(`  viewport.height=${sb_ref!.viewport?.height}`);
		console.log(`  content.height=${sb_ref!.content?.height}`);
		console.log(`  sb_ref.height=${sb_ref!.height}`);

		expect(sb_ref!.scrollHeight).toBeGreaterThanOrEqual(50);
	});

	// Test 10: Dynamic content — simulate Show/fallback height changes
	test("dynamic content with Show/createSignal updates scrollHeight", async () => {
		let sb_ref: ScrollBoxRenderable | undefined;
		const [data, setData] = createSignal<{ loaded: true } | null>(null);

		const widgets = Array.from({ length: 8 }, (_, i) => i);

		const { renderOnce } = await testRender(
			() => (
				<box flexDirection="column" width={60} height={20}>
					<scrollbox ref={sb_ref} flexGrow={1}>
						<box flexDirection="column" width={60} flexShrink={0}>
							{widgets.map((i) => (
								<>
									<text content={`── Widget ${i} ──`} />
									<box flexDirection="column" minHeight={1}>
										<Show
											when={data()}
											fallback={<text content="loading..." />}
										>
											<text content={`Widget ${i} line 1`} />
											<text content={`Widget ${i} line 2`} />
											<text content={`Widget ${i} line 3`} />
											<text content={`Widget ${i} line 4`} />
											<text content={`Widget ${i} line 5`} />
										</Show>
									</box>
								</>
							))}
						</box>
					</scrollbox>
				</box>
			),
			{ width: 60, height: 20 },
		);

		await renderOnce();

		const scroll_height_before = sb_ref!.scrollHeight;
		console.log("Test 10 - Dynamic content (before setData):");
		console.log(`  scrollHeight=${scroll_height_before}`);
		console.log(`  viewport.height=${sb_ref!.viewport?.height}`);
		console.log(`  content.height=${sb_ref!.content?.height}`);

		// Before: 8 headers + 8 boxes (each 1 line fallback) = 8 + 8 = 16
		// (minHeight=1 so each box is at least 1)
		expect(scroll_height_before).toBeGreaterThanOrEqual(16);

		// Now trigger the reactive update
		setData({ loaded: true });
		await renderOnce();

		const scroll_height_after = sb_ref!.scrollHeight;
		console.log("Test 10 - Dynamic content (after setData):");
		console.log(`  scrollHeight=${scroll_height_after}`);
		console.log(`  viewport.height=${sb_ref!.viewport?.height}`);
		console.log(`  content.height=${sb_ref!.content?.height}`);

		// After: 8 headers + 8 boxes (each 5 lines) = 8 + 40 = 48
		expect(scroll_height_after).toBeGreaterThanOrEqual(48);
		expect(scroll_height_after).toBeGreaterThan(scroll_height_before);
	});

	// Test 11: Verify scroll-to-focused logic works in nested layout
	// This is the actual bug reproduction — el.y is screen-absolute
	test("scroll-to-focused uses content-relative coordinates in nested layout", async () => {
		let sb_ref: ScrollBoxRenderable | undefined;
		const row_refs: Renderable[] = [];

		const row_configs = [
			{ cols: 2, h: 10 },
			{ cols: 1, h: 7 },
			{ cols: 2, h: 3 },
			{ cols: 1, h: 13 },
			{ cols: 2, h: 3 },
			{ cols: 2, h: 7 },
			{ cols: 1, h: 10 },
			{ cols: 2, h: 4 },
			{ cols: 1, h: 3 },
		];

		const right_panel_width = 80;

		const { renderOnce } = await testRender(
			() => (
				<box flexDirection="column" width="100%" height="100%">
					<box height={1}>
						<text content="header" />
					</box>
					<box flexDirection="row" flexGrow={1}>
						<box width={40}>
							<text content="left panel" />
						</box>
						<box flexDirection="column" flexGrow={1}>
							<box height="50%">
								<text content="git graph placeholder" />
							</box>
							<box flexDirection="column" width={right_panel_width} height="50%">
								<scrollbox ref={sb_ref} flexGrow={1}>
									<box flexDirection="column" width={right_panel_width} flexShrink={0}>
										{row_configs.map((rc, row_idx) => {
											const border_line = "─".repeat(right_panel_width);
											const half = Math.floor(right_panel_width / 2);
											return (
												<>
													<text content={border_line} />
													<box
														ref={(el: Renderable) => {
															row_refs[row_idx] = el;
														}}
														flexDirection="row"
														alignItems="stretch"
														width={right_panel_width}
													>
														{rc.cols === 1 ? (
															<box
																width={right_panel_width}
																border={["left", "right"]}
																borderStyle="rounded"
																flexDirection="column"
																minHeight={rc.h}
																overflow="hidden"
															>
																<text content={`Widget row ${row_idx}`} />
																{Array.from({ length: rc.h - 1 }, (_, j) => (
																	<text content={`  content line ${j}`} />
																))}
															</box>
														) : (
															<>
																<box
																	width={half}
																	border={["left", "right"]}
																	borderStyle="rounded"
																	flexDirection="column"
																	minHeight={rc.h}
																	overflow="hidden"
																>
																	<text content={`Widget row ${row_idx}a`} />
																</box>
																<box
																	width={right_panel_width - half}
																	border={["left", "right"]}
																	borderStyle="rounded"
																	flexDirection="column"
																	minHeight={rc.h}
																	overflow="hidden"
																>
																	<text content={`Widget row ${row_idx}b`} />
																</box>
															</>
														)}
													</box>
												</>
											);
										})}
										<text content={"─".repeat(right_panel_width)} />
									</box>
								</scrollbox>
							</box>
						</box>
					</box>
					<box height={1}>
						<text content="status bar" />
					</box>
				</box>
			),
			{ width: 120, height: 40 },
		);

		await renderOnce();

		const scroll_height = sb_ref!.scrollHeight;
		const vp_height = sb_ref!.viewport?.height ?? sb_ref!.height;
		const content_origin_y = sb_ref!.content.y;

		console.log("Test 11 - Content-relative coordinate check:");
		console.log(`  scrollHeight=${scroll_height}, viewport.height=${vp_height}`);
		console.log(`  content.y (screen)=${content_origin_y}`);

		// For each row, compute content-relative y using the CORRECT formula
		for (let i = 0; i < row_configs.length; i++) {
			const ref = row_refs[i];
			if (ref) {
				// CORRECT: content-relative position
				const content_y = ref.y - content_origin_y;
				console.log(`  row ${i}: screen_y=${ref.y} content_y=${content_y} height=${ref.height}`);
			}
		}

		// Now simulate scrollToFocused for the LAST row (row 8)
		const last_ref = row_refs[8]!;
		const content_y = last_ref.y - content_origin_y;
		const content_h = last_ref.height;
		const region_top = content_y - 1; // 1 line above for border
		const region_bottom = content_y + content_h + 1; // 1 line below for bottom border (last row)
		const region_height = region_bottom - region_top;

		console.log(`  last row region: [${region_top}, ${region_bottom}] h=${region_height}`);

		// To see the bottom, scroll so region_bottom aligns with viewport bottom
		const needed_scroll = region_bottom - vp_height;
		console.log(`  needed_scroll=${needed_scroll}`);
		console.log(`  max_scroll=${scroll_height - vp_height}`);

		// The needed scroll should be within the allowed range
		expect(needed_scroll).toBeLessThanOrEqual(scroll_height - vp_height);

		// Actually scroll there
		sb_ref!.scrollTo({ x: 0, y: needed_scroll });
		expect(sb_ref!.scrollTop).toBe(needed_scroll);
	});
});
