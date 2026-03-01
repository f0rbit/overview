import { For, Show } from "solid-js";
import type { WidgetRenderProps, RepoStatus } from "@overview/core";
import { registerWidget } from "./registry";
import { theme } from "../../theme";
import { truncate, formatRelativeTime } from "../../lib/format";

const size_hint = { span: "half" as const, min_height: 2 };
const MAX_VISIBLE = 8;

function RecentCommitsWidget(props: WidgetRenderProps & { status: RepoStatus | null }) {
	const all_commits = () => props.status?.recent_commits ?? [];
	const visible_commits = () => all_commits().slice(0, MAX_VISIBLE);
	const overflow = () => Math.max(0, all_commits().length - MAX_VISIBLE);

	const format_line = (commit: { hash: string; message: string; time: number }) => {
		const hash_short = commit.hash.slice(0, 7);
		const time_str = " " + formatRelativeTime(commit.time);
		const available = props.width - hash_short.length - 1 - time_str.length;
		const msg = truncate(commit.message, Math.max(1, available));
		return { hash_short, msg, time_str };
	};

	return (
		<box flexDirection="column">
			<box height={1}>
				<text fg={theme.fg_dark} content="Recent Commits" />
			</box>
			<Show
				when={(props.status?.recent_commits?.length ?? 0) > 0}
				fallback={
					<box height={1}>
						<text fg={theme.fg_dim} content="(no commits)" />
					</box>
				}
			>
				<For each={visible_commits()}>
					{(commit) => {
						const line = () => format_line(commit);
						return (
							<box flexDirection="row" height={1}>
								<text fg={theme.yellow} content={line().hash_short} />
								<text content={" "} />
								<text content={line().msg} />
								<text fg={theme.fg_dim} content={line().time_str} />
							</box>
						);
					}}
				</For>
			<Show when={overflow() > 0}>
				<text fg={theme.fg_dim} content={`+${overflow()} more`} />
			</Show>
			</Show>
		</box>
	);
}

registerWidget({
	id: "recent-commits",
	label: "Recent Commits",
	size_hint,
	component: RecentCommitsWidget,
});

export { RecentCommitsWidget };
