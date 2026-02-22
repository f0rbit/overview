import { For, Show, Switch, Match, createMemo } from "solid-js";
import type { WidgetRenderProps, RepoStatus, DevpadMilestone } from "@overview/core";
import { registerWidget } from "./registry";
import { theme } from "../../theme";
import { truncate } from "../../lib/format";
import { useDevpad } from "../../lib/use-devpad";

const size_hint = { span: "half" as const, min_height: 2 };

function progressBar(total: number, completed: number, width: number): string {
	if (total === 0) return "░".repeat(width);
	const filled = Math.round((completed / total) * width);
	return "█".repeat(filled) + "░".repeat(width - filled);
}

function DevpadMilestonesWidget(props: WidgetRenderProps & { status: RepoStatus | null }) {
	const remote_url = createMemo(() => props.status?.remote_url ?? null);
	const repo_name = createMemo(() => props.status?.name ?? "");
	const devpad = useDevpad(remote_url, repo_name);

	const milestones = createMemo(() => devpad.data()?.milestones ?? []);
	const max_visible = 4;
	const visible = () => milestones().slice(0, max_visible);
	const overflow = () => Math.max(0, milestones().length - max_visible);

	return (
		<box flexDirection="column">
			<Switch>
				<Match when={devpad.error()}>
					{(err) => <text fg={theme.fg_dim} content={err()} />}
				</Match>
				<Match when={devpad.loading() && !devpad.data()}>
					<text fg={theme.fg_dim} content="loading…" />
				</Match>
				<Match when={!devpad.data()?.project && devpad.data() !== null}>
					<text fg={theme.fg_dim} content="no devpad project" />
				</Match>
				<Match when={true}>
					<Show
						when={milestones().length > 0}
						fallback={<text fg={theme.fg_dim} content="no milestones" />}
					>
						<For each={visible()}>
							{(ms) => {
								const pct = () =>
									ms.goals_total > 0
										? Math.round((ms.goals_completed / ms.goals_total) * 100)
										: 0;
								const bar_width = 12;
								const label = () => {
									const version_str = ms.target_version ? ` (${ms.target_version})` : "";
									return truncate(`${ms.name}${version_str}`, Math.max(1, props.width - bar_width - 8));
								};
								const bar = () => progressBar(ms.goals_total, ms.goals_completed, bar_width);
								const bar_color = () => (pct() === 100 ? theme.green : theme.blue);

								return (
									<box flexDirection="column" height={2}>
										<box flexDirection="row" height={1}>
											<text content={label()} />
											<text fg={theme.fg_dim} content={` ${ms.goals_completed}/${ms.goals_total}`} />
										</box>
										<box flexDirection="row" height={1}>
											<text fg={bar_color()} content={bar()} />
											<text fg={theme.fg_dim} content={` ${pct()}%`} />
										</box>
									</box>
								);
							}}
						</For>
						<Show when={overflow() > 0}>
							<text fg={theme.fg_dim} content={`+${overflow()} more`} />
						</Show>
					</Show>
				</Match>
			</Switch>
		</box>
	);
}

registerWidget({
	id: "devpad-milestones",
	label: "Devpad Milestones",
	size_hint,
	component: DevpadMilestonesWidget,
});

export { DevpadMilestonesWidget };
