import { For, Show, createMemo } from "solid-js";
import type { WidgetRenderProps, RepoStatus, GithubWorkflowRun } from "@overview/core";
import { registerWidget } from "./registry";
import { theme } from "../../theme";
import { truncate } from "../../lib/format";
import { useGithub } from "../../lib/use-github";

const size_request = { min_rows: 2, preferred_rows: 4, max_rows: 6 };

function statusIcon(run: GithubWorkflowRun): { icon: string; color: string } {
	if (run.conclusion === "success") return { icon: "✓", color: theme.green };
	if (run.conclusion === "failure") return { icon: "✗", color: theme.red };
	if (run.conclusion === "cancelled") return { icon: "⊘", color: theme.fg_dim };
	if (run.status === "in_progress" || run.status === "queued") return { icon: "◌", color: theme.yellow };
	return { icon: "◌", color: theme.fg_dim };
}

function GithubCIWidget(props: WidgetRenderProps & { status: RepoStatus | null }) {
	const repo_path = createMemo(() => props.status?.path ?? null);
	const remote_url = createMemo(() => props.status?.remote_url ?? null);
	const github = useGithub(repo_path, remote_url);

	const runs = createMemo(() => github.data()?.ci_runs ?? []);

	const all_green = createMemo(() => {
		const r = runs();
		return r.length > 0 && r.every((run) => run.conclusion === "success");
	});

	const visible_runs = createMemo(() => {
		return runs().slice(0, props.allocated_rows);
	});

	return (
		<box flexDirection="column">
			{/* gh CLI not available */}
			<Show when={github.error()?.kind === "gh_cli_not_found"}>
				<box flexDirection="row" height={1} gap={1}>
					<text fg={theme.fg_dim} content="gh not available" />
					<text fg={theme.blue} content="https://cli.github.com" />
				</box>
			</Show>

			{/* Not a GitHub repo */}
			<Show when={github.error()?.kind === "not_github_repo"}>
				<text fg={theme.fg_dim} content="not a GitHub repo" />
			</Show>

			{/* Loading */}
			<Show when={!github.error() && github.loading()}>
				<text fg={theme.fg_dim} content="loading…" />
			</Show>

			{/* No error, not loading — show data */}
			<Show when={!github.error() && !github.loading()}>
				<Show when={runs().length === 0}>
					<text fg={theme.fg_dim} content="no CI runs" />
				</Show>

				{/* All green: collapse to single line */}
				<Show when={all_green()}>
					<text fg={theme.green} content="CI: all green ✓" />
				</Show>

				{/* Mixed results: show each run */}
				<Show when={!all_green() && runs().length > 0}>
					<For each={visible_runs()}>
						{(run) => {
							const si = () => statusIcon(run);
							const name_budget = () => {
								const branch_str = ` ${run.head_branch}`;
								return Math.max(1, props.width - 2 - branch_str.length);
							};

							return (
								<box flexDirection="row" height={1}>
									<text fg={si().color} content={si().icon} />
									<text content={" "} />
									<text content={truncate(run.name, name_budget())} />
									<text fg={theme.fg_dim} content={` ${run.head_branch}`} />
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
	id: "github-ci",
	label: "GitHub CI",
	size_request,
	component: GithubCIWidget,
});

export { GithubCIWidget };
