import { For, Show, createMemo, createSignal, createEffect, on } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { RepoStatus, WidgetConfig, WidgetId } from "@overview/core";
import { getWidget } from "./widgets/registry";
import "./widgets/index";
import { theme } from "../theme";
import {
	computeGridLayout,
	buildBorderLine,
	buildBorderLineWithTitle,
	contentWidth,
	getWidgetBorderSides,
	type GridWidget,
	type GridRow,
} from "../lib/widget-grid";

interface WidgetContainerProps {
	status: RepoStatus | null;
	repoName: string;
	loading: boolean;
	focused: boolean;
	height: number | `${number}%` | "auto";
	availableWidth: number;
	widgetConfigs: WidgetConfig[];
	onWidgetConfigChange?: (configs: WidgetConfig[]) => void;
}

export function WidgetContainer(props: WidgetContainerProps) {
	const [focused_idx, setFocusedIdx] = createSignal(0);
	let scrollbox_ref: ScrollBoxRenderable | undefined;

	const enabled_widgets = createMemo(() => {
		const configs = props.widgetConfigs
			.filter((c) => c.enabled)
			.sort((a, b) => a.priority - b.priority);
		return configs
			.map((c): GridWidget | null => {
				const def = getWidget(c.id);
				if (!def) return null;
				return { id: c.id, size_hint: def.size_hint, config: c };
			})
			.filter((gw): gw is GridWidget => gw !== null);
	});

	const grid_layout = createMemo(() =>
		computeGridLayout(enabled_widgets(), props.availableWidth),
	);

	const flat_widget_ids = createMemo(() => {
		const rows = grid_layout().rows;
		const ids: WidgetId[] = [];
		for (const row of rows) {
			for (const w of row.widgets) {
				ids.push(w.id);
			}
		}
		return ids;
	});

	function scrollToFocused() {
		if (!scrollbox_ref) return;
		const focused_id = flat_widget_ids()[focused_idx()];
		if (!focused_id) return;

		const rows = grid_layout().rows;
		let row_offset = 0;
		for (const row of rows) {
			const is_in_row = row.widgets.some((w) => w.id === focused_id);
			if (is_in_row) {
				scrollbox_ref.scrollTo({ x: 0, y: row_offset });
				return;
			}
			const content_height = Math.max(...row.widgets.map((w) => w.size_hint.min_height));
			row_offset += 1 + content_height;
		}
	}

	createEffect(on(focused_idx, () => scrollToFocused()));

	useKeyboard((key) => {
		if (!props.focused) return;

		const ids = flat_widget_ids();
		if (ids.length === 0) return;

		switch (key.name) {
			case "j":
			case "l":
				setFocusedIdx(Math.min(focused_idx() + 1, ids.length - 1));
				return;
			case "k":
			case "h":
				setFocusedIdx(Math.max(focused_idx() - 1, 0));
				return;
		}

		if (key.raw === "c") {
			const widget_id = ids[focused_idx()];
			if (widget_id) {
				const updated = props.widgetConfigs.map((c) =>
					c.id === widget_id ? { ...c, collapsed: !c.collapsed } : c,
				);
				props.onWidgetConfigChange?.(updated);
			}
			return;
		}

		if (key.raw === "C") {
			const all_collapsed = props.widgetConfigs.every((c) => !c.enabled || c.collapsed);
			const updated = props.widgetConfigs.map((c) => ({ ...c, collapsed: !all_collapsed }));
			props.onWidgetConfigChange?.(updated);
			return;
		}
	});

	function flatIndexOf(widget_id: WidgetId): number {
		return flat_widget_ids().indexOf(widget_id);
	}

	function isFocused(widget_id: WidgetId): boolean {
		return props.focused && flatIndexOf(widget_id) === focused_idx();
	}

	function borderLine(type: "top" | "mid" | "bottom", prev: GridRow | null, next: GridRow | null): string {
		return buildBorderLine(type, props.availableWidth, prev, next);
	}

	return (
		<box flexDirection="column" width={props.availableWidth} height={props.height}>
			<Show
				when={!props.loading}
				fallback={<text fg={theme.fg_dim} content="loading..." />}
			>
				<Show
					when={props.status}
					fallback={<text fg={theme.fg_dim} content="(select a repo)" />}
				>
					<scrollbox ref={scrollbox_ref} flexGrow={1}>
						<box flexDirection="column" width={props.availableWidth}>
							<For each={grid_layout().rows}>
								{(row, row_index) => {
									const rows = grid_layout().rows;
									const prev_row = () => row_index() > 0 ? rows[row_index() - 1]! : null;
									const is_first = () => row_index() === 0;
									const is_last = () => row_index() === rows.length - 1;

									const top_line = () => {
										const type = is_first() ? "top" : "mid";
										const line = borderLine(type, prev_row(), row);
										if (is_first()) {
											return buildBorderLineWithTitle(line, `widgets: ${props.repoName}`);
										}
										return line;
									};

									return (
										<>
											<text fg={theme.border} content={top_line()} />

											<box flexDirection="row" alignItems="stretch" width={props.availableWidth}>
												<For each={row.widgets}>
													{(gw, widget_idx) => {
														const def = getWidget(gw.id);
														if (!def) return null;

														const focused = () => isFocused(gw.id);
														const box_width = () => {
															if (row.columns === 1) return props.availableWidth;
															const junction = Math.floor(props.availableWidth / 2);
															if (widget_idx() === 0) return junction;
															return props.availableWidth - junction;
														};
														const widget_content_width = () =>
															contentWidth(gw.size_hint.span, props.availableWidth);

														return (
															<box
																width={box_width()}
																border={getWidgetBorderSides(row, widget_idx())}
																borderStyle="rounded"
																borderColor={focused() ? theme.border_highlight : theme.border}
																backgroundColor={focused() ? theme.bg_highlight : undefined}
																flexDirection="column"
																minHeight={gw.size_hint.min_height}
																overflow="hidden"
															>
																<Show
																	when={!gw.config.collapsed}
																	fallback={
																		<text
																			fg={focused() ? theme.yellow : theme.fg_dim}
																			content={focused() ? `▸ [>] ${def.label} (collapsed)` : `[>] ${def.label} (collapsed)`}
																		/>
																	}
																>
																	<text
																		fg={focused() ? theme.yellow : theme.fg_dim}
																		content={focused() ? `▸ ${def.label}` : `  ${def.label}`}
																	/>
																	<def.component
																		width={widget_content_width()}
																		focused={focused()}
																		status={props.status}
																	/>
																</Show>
															</box>
														);
													}}
												</For>
											</box>

											<Show when={is_last()}>
												<text fg={theme.border} content={borderLine("bottom", row, null)} />
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
