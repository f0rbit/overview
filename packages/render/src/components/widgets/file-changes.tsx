import { For, Show } from "solid-js";
import type { WidgetRenderProps, RepoStatus, GitFileChange } from "@overview/core";
import { registerWidget } from "./registry";
import { theme } from "../../theme";
import { truncate } from "../../lib/format";

const size_request = { min_rows: 3, preferred_rows: 8, max_rows: 15 };

function statusIcon(change: GitFileChange): { icon: string; color: string } {
	const icons: Record<string, { icon: string; color: string }> = {
		modified:   { icon: "M", color: theme.status.modified },
		added:      { icon: "A", color: theme.green },
		deleted:    { icon: "D", color: theme.red },
		renamed:    { icon: "R", color: theme.cyan },
		copied:     { icon: "C", color: theme.magenta },
		untracked:  { icon: "?", color: theme.status.untracked },
		ignored:    { icon: "!", color: theme.fg_dim },
		conflicted: { icon: "!", color: theme.status.conflict },
	};
	return icons[change.status] ?? { icon: " ", color: theme.fg };
}

function basename(path: string): string {
	const parts = path.split("/");
	return parts[parts.length - 1] ?? path;
}

function FileChangesWidget(props: WidgetRenderProps & { status: RepoStatus | null }) {
	const changes = () => props.status?.changes ?? [];
	const visible_count = () => Math.max(0, props.allocated_rows - 1);
	const visible = () => changes().slice(0, visible_count());
	const overflow = () => Math.max(0, changes().length - visible_count());
	const header = () => `File Changes (${changes().length})`;

	return (
		<box flexDirection="column">
			<Show
				when={props.status}
				fallback={
					<text fg={theme.fg_dim} content="no repo selected" />
				}
			>
				<box flexDirection="row" height={1}>
					<text fg={theme.fg} content={header()} />
				</box>

				<Show
					when={changes().length > 0}
					fallback={
						<text fg={theme.fg_dim} content="(no changes)" />
					}
				>
					<For each={visible()}>
						{(change) => {
							const si = () => statusIcon(change);
							const staged_prefix = () => change.staged ? "+" : " ";
							const label = () => truncate(basename(change.path), props.width - 5);

							return (
								<box flexDirection="row" height={1}>
									<text fg={change.staged ? theme.green : si().color} content={staged_prefix()} />
									<text fg={si().color} content={si().icon + " "} />
									<text fg={theme.fg} content={label()} />
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
	id: "file-changes",
	label: "File Changes",
	size_request,
	component: FileChangesWidget,
});

export { FileChangesWidget };
