import { For, Show, createMemo } from "solid-js";
import type { WidgetRenderProps, RepoStatus, DevpadMilestone } from "@overview/core";
import { registerWidget } from "./registry";
import { theme } from "../../theme";
import { truncate } from "../../lib/format";
import { useDevpad } from "../../lib/use-devpad";

const size_request = { min_rows: 2, preferred_rows: 4, max_rows: 8 };

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
				<Show
					when={milestones().length > 0}
					fallback={<text fg={theme.fg_dim} content="no milestones" />}
				>
					<For each={milestones()}>
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
								<box flexDirection="column">
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
				</Show>
			</Show>
		</box>
	);
}

registerWidget({
	id: "devpad-milestones",
	label: "Devpad Milestones",
	size_request,
	component: DevpadMilestonesWidget,
});

export { DevpadMilestonesWidget };
