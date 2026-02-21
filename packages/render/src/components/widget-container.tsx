import { For, Show, createMemo } from "solid-js";
import type { RepoStatus, WidgetConfig, WidgetSizeRequest, WidgetId } from "@overview/core";
import { allocateWidgets, getEffectiveSizeRequest } from "../lib/widget-layout";
import { getWidget, getAllWidgets } from "./widgets/registry";
import "./widgets/index"; // registers all widgets
import { theme } from "../theme";

interface WidgetContainerProps {
	status: RepoStatus | null;
	repoName: string;
	loading: boolean;
	focused: boolean;
	height: number | `${number}%` | "auto";
	widgetConfigs: WidgetConfig[];
}

const DEFAULT_AVAILABLE_ROWS = 20;

function estimateRows(height: number | `${number}%` | "auto"): number {
	if (typeof height === "number") return height;
	return DEFAULT_AVAILABLE_ROWS;
}

export function WidgetContainer(props: WidgetContainerProps) {
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

		const available = estimateRows(props.height);
		return allocateWidgets(available, props.widgetConfigs, size_requests);
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
					<scrollbox flexDirection="column" flexGrow={1}>
						<For each={widgetEntries()}>
							{(entry, index) => (
								<>
									<Show when={index() > 0}>
										<text fg={theme.border} content={"─".repeat(40)} />
									</Show>
									<Show
										when={!entry.config.collapsed}
										fallback={
											<box height={1}>
												<text
													fg={theme.fg_dim}
													content={`[>] ${entry.def.label} (collapsed)`}
												/>
											</box>
										}
									>
										<box height={entry.alloc.rows} flexDirection="column">
											<entry.def.component
												allocated_rows={entry.alloc.rows}
												width={40}
												focused={props.focused}
												status={props.status}
											/>
										</box>
									</Show>
								</>
							)}
						</For>
					</scrollbox>
				</Show>
			</Show>
		</box>
	);
}
