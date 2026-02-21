import { For, Show, createMemo } from "solid-js";
import type { WidgetRenderProps, RepoStatus, DevpadTask } from "@overview/core";
import { registerWidget } from "./registry";
import { theme } from "../../theme";
import { truncate } from "../../lib/format";
import { useDevpad } from "../../lib/use-devpad";

const size_request = { min_rows: 3, preferred_rows: 6, max_rows: 10 };

const priority_indicator: Record<DevpadTask["priority"], { char: string; color: string }> = {
	HIGH: { char: "!", color: theme.red },
	MEDIUM: { char: "·", color: theme.yellow },
	LOW: { char: "·", color: theme.fg_dim },
};

const progress_indicator: Record<DevpadTask["progress"], { char: string; color: string }> = {
	UNSTARTED: { char: "○", color: theme.fg_dim },
	IN_PROGRESS: { char: "◑", color: theme.blue },
	COMPLETED: { char: "●", color: theme.green },
};

function DevpadTasksWidget(props: WidgetRenderProps & { status: RepoStatus | null }) {
	const remote_url = createMemo(() => props.status?.remote_url ?? null);
	const repo_name = createMemo(() => props.status?.name ?? "");
	const devpad = useDevpad(remote_url, repo_name);

	const tasks = createMemo(() => devpad.data()?.tasks ?? []);
	const visible_count = () => Math.max(0, props.allocated_rows - 1);
	const visible = () => tasks().slice(0, visible_count());
	const overflow = () => Math.max(0, tasks().length - visible_count());

	return (
		<box flexDirection="column">
			<Show when={devpad.error() === "devpad not configured"}>
				<text fg={theme.fg_dim} content="devpad not configured" />
			</Show>

			<Show when={devpad.loading() && !devpad.data()}>
				<text fg={theme.fg_dim} content="loading…" />
			</Show>

			<Show when={!devpad.error() && !devpad.loading() && !devpad.data()?.project}>
				<text fg={theme.fg_dim} content="no devpad project" />
			</Show>

			<Show when={!devpad.error() && devpad.data()?.project}>
				<text fg={theme.fg_dark} content={`Tasks (${tasks().length})`} />
				<Show
					when={tasks().length > 0}
					fallback={<text fg={theme.fg_dim} content="(no open tasks)" />}
				>
					<For each={visible()}>
						{(task) => {
							const pi = () => priority_indicator[task.priority];
							const si = () => progress_indicator[task.progress];
							const available = () => Math.max(1, props.width - 4);
							return (
								<box flexDirection="row" height={1}>
									<text fg={si().color} content={`${si().char} `} />
									<text fg={pi().color} content={`${pi().char} `} />
									<text content={truncate(task.title, available())} />
								</box>
							);
						}}
					</For>
					<Show when={overflow() > 0}>
						<text fg={theme.fg_dim} content={`+${overflow()} more`} />
					</Show>
				</Show>
			</Show>
		</box>
	);
}

registerWidget({
	id: "devpad-tasks",
	label: "Devpad Tasks",
	size_request,
	component: DevpadTasksWidget,
});

export { DevpadTasksWidget };
