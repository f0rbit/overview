import { Show } from "solid-js";
import type { WidgetRenderProps, RepoStatus, HealthStatus } from "@overview/core";
import { registerWidget } from "./registry";
import { theme } from "../../theme";
import { formatRelativeTime } from "../../lib/format";

const size_hint = { span: "half" as const, min_height: 2 };

const health_color: Record<HealthStatus, string> = {
	clean: theme.green,
	dirty: theme.yellow,
	ahead: theme.yellow,
	behind: theme.cyan,
	diverged: theme.orange,
	conflict: theme.red,
};

function healthIndicator(health: HealthStatus): string {
	const labels: Record<HealthStatus, string> = {
		clean: "●",
		dirty: "●",
		ahead: "↑",
		behind: "↓",
		diverged: "⇅",
		conflict: "✗",
	};
	return labels[health];
}

function GitStatusWidget(props: WidgetRenderProps & { status: RepoStatus | null }) {
	const s = () => props.status;

	return (
		<box flexDirection="column">
			<Show
				when={s()}
				fallback={
					<text fg={theme.fg_dim} content="no repo selected" />
				}
			>
				{(status) => {
					const color = () => health_color[status().health];
					const has_sync = () => status().ahead > 0 || status().behind > 0;
					const has_wt = () =>
						status().modified_count > 0 ||
						status().staged_count > 0;
					const has_extra = () =>
						status().untracked_count > 0 ||
						status().conflict_count > 0;
					const has_stash = () => status().stash_count > 0;

					return (
						<>
							{/* Line 1: branch + health */}
							<box flexDirection="row" height={1} gap={1}>
								<text fg={color()} content={healthIndicator(status().health)} />
								<text fg={theme.cyan} content={status().current_branch} />
							</box>

							{/* Line 2: ahead/behind or up to date */}
							<Show
								when={has_sync()}
								fallback={
									<box flexDirection="row" height={1}>
										<text fg={theme.fg_dim} content="up to date" />
									</box>
								}
							>
								<box flexDirection="row" height={1} gap={2}>
									<Show when={status().ahead > 0}>
										<text fg={theme.status.ahead} content={`↑${status().ahead} ahead`} />
									</Show>
									<Show when={status().behind > 0}>
										<text fg={theme.status.behind} content={`↓${status().behind} behind`} />
									</Show>
								</box>
							</Show>

							{/* Line 3: modified + staged */}
							<Show when={has_wt()}>
								<box flexDirection="row" height={1} gap={2}>
									<Show when={status().modified_count > 0}>
										<text fg={theme.status.modified} content={`~${status().modified_count} mod`} />
									</Show>
									<Show when={status().staged_count > 0}>
										<text fg={theme.green} content={`+${status().staged_count} staged`} />
									</Show>
								</box>
							</Show>

							{/* Line 4: untracked + conflicts */}
							<Show when={has_extra()}>
								<box flexDirection="row" height={1} gap={2}>
									<Show when={status().untracked_count > 0}>
										<text fg={theme.status.untracked} content={`?${status().untracked_count} untracked`} />
									</Show>
									<Show when={status().conflict_count > 0}>
										<text fg={theme.status.conflict} content={`!${status().conflict_count} conflicts`} />
									</Show>
								</box>
							</Show>

							{/* Line 5: stash + last commit */}
							<box flexDirection="row" height={1} gap={2}>
								<Show when={has_stash()}>
									<text fg={theme.status.stash} content={`✂ ${status().stash_count} stash`} />
								</Show>
								<text fg={theme.fg_dim} content={formatRelativeTime(status().head_time)} />
							</box>
						</>
					);
				}}
			</Show>
		</box>
	);
}

registerWidget({
	id: "git-status",
	label: "Git Status",
	size_hint,
	component: GitStatusWidget,
});

export { GitStatusWidget };
