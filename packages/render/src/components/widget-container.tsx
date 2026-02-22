import { For, Show, createMemo, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import type { RepoStatus, WidgetConfig, WidgetId } from "@overview/core";
// TODO: Phase 3 — replace with grid layout
import { getWidget, getAllWidgets } from "./widgets/registry";
import "./widgets/index"; // registers all widgets
import { theme } from "../theme";

interface WidgetContainerProps {
	status: RepoStatus | null;
	repoName: string;
	loading: boolean;
	focused: boolean;
	height: number | `${number}%` | "auto";
	availableRows: number;
	availableWidth: number;
	widgetConfigs: WidgetConfig[];
	onWidgetConfigChange?: (configs: WidgetConfig[]) => void;
}

export function WidgetContainer(props: WidgetContainerProps) {
	const [focused_idx, setFocusedIdx] = createSignal(0);

	// Content width: use width="100%" on children and let opentui handle it.
	// Only pass numeric width to widgets for their internal text truncation.
	// Scrollbox reserves 1 col for scrollbar, border takes 2 — but we don't
	// try to compute exact char widths for rendering; only for truncation hints.
	const contentWidth = () => Math.max(1, props.availableWidth);

	useKeyboard((key) => {
		if (!props.focused) return;

		const entries = widgetEntries();
		if (entries.length === 0) return;

		switch (key.name) {
			case "j":
				setFocusedIdx(Math.min(focused_idx() + 1, entries.length - 1));
				return;
			case "k":
				setFocusedIdx(Math.max(focused_idx() - 1, 0));
				return;
		}

		if (key.raw === "c") {
			const entry = entries[focused_idx()];
			if (entry) {
				const updated = props.widgetConfigs.map((c) =>
					c.id === entry.def.id ? { ...c, collapsed: !c.collapsed } : c,
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

	const allocations = createMemo(() => {
		const size_requests = new Map<WidgetId, WidgetSizeRequest>();
		for (const def of getAllWidgets()) {
			const config = props.widgetConfigs.find((c) => c.id === def.id);
			if (config) {
				size_requests.set(def.id, getEffectiveSizeRequest(config, def.size_request));
			} else {
				size_requests.set(def.id, def.size_request);
			}
		}

		return allocateWidgets(props.availableRows, props.widgetConfigs, size_requests);
	});

	const widgetEntries = createMemo(() =>
		allocations()
			.map((alloc) => {
				const def = getWidget(alloc.id);
				const config = props.widgetConfigs.find((c) => c.id === alloc.id);
				if (!def || !config) return null;
				return { alloc, def, config };
			})
			.filter((e): e is NonNullable<typeof e> => e !== null),
	);

	return (
		<box
			borderStyle="rounded"
			borderColor={props.focused ? theme.border_highlight : theme.border}
			title={`widgets: ${props.repoName}`}
			titleAlignment="left"
			flexDirection="column"
			flexGrow={1}
			height={props.height}
		>
			<Show
				when={!props.loading}
				fallback={<text fg={theme.fg_dim} content="loading..." />}
			>
				<Show
					when={props.status}
					fallback={<text fg={theme.fg_dim} content="(select a repo)" />}
				>
					<scrollbox flexGrow={1}>
					<For each={widgetEntries()}>
						{(entry, index) => {
							const is_focused = () => props.focused && index() === focused_idx();
							const marker = () => is_focused() ? "▸ " : "  ";
							return (
								<>
								<Show when={index() > 0}>
									<text fg={theme.border} content="───" />
								</Show>
									<Show
										when={!entry.config.collapsed}
										fallback={
											<box height={1}>
												<text
													fg={is_focused() ? theme.yellow : theme.fg_dim}
													content={`${marker()}[>] ${entry.def.label} (collapsed)`}
												/>
											</box>
										}
									>
										<box height={entry.alloc.rows} flexDirection="column" overflow="hidden">
											<Show when={is_focused()}>
												<text fg={theme.yellow} content={`▸ ${entry.def.label}`} />
											</Show>
										<entry.def.component
											allocated_rows={is_focused() ? entry.alloc.rows - 1 : entry.alloc.rows}
											width={contentWidth()}
											focused={props.focused}
											status={props.status}
										/>
										</box>
									</Show>
								</>
							);
						}}
					</For>
					</scrollbox>
				</Show>
			</Show>
		</box>
	);
}
