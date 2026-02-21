import { Show, For } from "solid-js";
import type { GitGraphOutput } from "@overview/core";
import { theme } from "../theme";

interface GitGraphProps {
	graph: GitGraphOutput | null;
	repoName: string;
	loading: boolean;
	focused: boolean;
	height: number | `${number}%` | "auto";
}

export function GitGraph(props: GitGraphProps) {
	return (
		<box
			borderStyle="rounded"
			borderColor={props.focused ? theme.border_highlight : theme.border}
			title={`git graph: ${props.repoName}`}
			titleAlignment="left"
			flexDirection="column"
			flexGrow={1}
			height={props.height}
		>
			<Show
				when={!props.loading && props.graph && props.graph.lines.length > 0}
				fallback={
					<text fg={theme.fg_dim}>
						{props.loading ? "loading..." : "(no commits)"}
					</text>
				}
			>
				<scrollbox
					focused={props.focused}
					viewportCulling={true}
					flexGrow={1}
				>
					<For each={props.graph!.lines}>
						{(line) => <text fg={theme.fg}>{line}</text>}
					</For>
				</scrollbox>
				<text fg={theme.fg_dim}>
					({props.graph!.total_lines} commits)
				</text>
			</Show>
		</box>
	);
}
