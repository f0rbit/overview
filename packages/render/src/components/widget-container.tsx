import { For, Show, createMemo, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import type { RepoStatus, WidgetConfig, WidgetId } from "@overview/core";
import { getWidget } from "./widgets/registry";
import "./widgets/index";
import { theme } from "../theme";
import {
	computeGridLayout,
	buildBorderLine,
	buildBorderLineWithTitle,
	getWidgetBorderSides,
	contentWidth,
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

	const flat_widget_ids = createMemo(() => enabled_widgets().map((gw) => gw.id));

	const grid_layout = createMemo(() =>
		computeGridLayout(enabled_widgets(), props.availableWidth),
	);

	useKeyboard((key) => {
		if (!props.focused) return;

		const ids = flat_widget_ids();
		if (ids.length === 0) return;

		switch (key.name) {
			case "j":
				setFocusedIdx(Math.min(focused_idx() + 1, ids.length - 1));
				return;
			case "k":
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
		<box flexDirection="column" flexGrow={1} height={props.height}>
			<Show
				when={!props.loading}
				fallback={<text fg={theme.fg_dim} content="loading..." />}
			>
				<Show
					when={props.status}
					fallback={<text fg={theme.fg_dim} content="(select a repo)" />}
				>
					<scrollbox flexGrow={1}>
						<box flexDirection="column">
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

											<box flexDirection="row" alignItems="stretch">
												<For each={row.widgets}>
													{(gw, widget_idx) => {
														const def = getWidget(gw.id);
														if (!def) return null;

														const focused = () => isFocused(gw.id);
														const width_pct = row.columns === 2 ? "50%" : "100%";
														const widget_content_width = () =>
															contentWidth(gw.size_hint.span, props.availableWidth);

														return (
															<box
																width={width_pct}
																border={getWidgetBorderSides(row, widget_idx())}
																borderStyle="rounded"
																borderColor={focused() ? theme.border_highlight : theme.border}
																flexDirection="column"
																minHeight={gw.size_hint.min_height}
															>
																<Show
																	when={!gw.config.collapsed}
																	fallback={
																		<text
																			fg={focused() ? theme.yellow : theme.fg_dim}
																			content={`[>] ${def.label} (collapsed)`}
																		/>
																	}
																>
																	<text
																		fg={focused() ? theme.yellow : theme.fg_dim}
																		content={focused() ? `▸ ${def.label}` : def.label}
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
