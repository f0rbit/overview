import { For, Show, Switch, Match, createMemo } from "solid-js";
import type { WidgetRenderProps, RepoStatus, GithubIssue } from "@overview/core";
import { registerWidget } from "./registry";
import { theme } from "../../theme";
import { truncate } from "../../lib/format";
import { useGithub } from "../../lib/use-github";

const size_hint = { span: "half" as const, min_height: 2 };
const MAX_VISIBLE = 10;

const label_colors = [
	theme.cyan,
	theme.magenta,
	theme.yellow,
	theme.green,
	theme.red,
	theme.orange,
] as const;

function labelColor(index: number): string {
	return label_colors[index % label_colors.length]!;
}

function GithubIssuesWidget(props: WidgetRenderProps & { status: RepoStatus | null }) {
	const repo_path = createMemo(() => props.status?.path ?? null);
	const remote_url = createMemo(() => props.status?.remote_url ?? null);
	const github = useGithub(repo_path, remote_url);

	const issues = createMemo(() => github.data()?.issues ?? []);
	const visible = () => issues().slice(0, MAX_VISIBLE);
	const overflow = () => Math.max(0, issues().length - MAX_VISIBLE);

	const formatIssueLine = (issue: GithubIssue) => {
		const number_str = `#${issue.number}`;
		const dots_len = issue.labels.length > 0 ? issue.labels.length * 2 : 0;
		const available = props.width - 2 - number_str.length - 1 - dots_len;
		const title = truncate(issue.title, Math.max(1, available));
		return { number_str, title };
	};

	return (
		<box flexDirection="column">
			<Switch>
				<Match when={github.error()?.kind === "gh_cli_not_found"}>
					<text fg={theme.fg_dim} content="gh not available" />
					<text fg={theme.fg_dim} content="install: https://cli.github.com" />
				</Match>
				<Match when={github.error()?.kind === "not_github_repo"}>
					<text fg={theme.fg_dim} content="not a GitHub repo" />
				</Match>
				<Match when={github.error()?.kind === "gh_auth_required"}>
					<text fg={theme.fg_dim} content="gh auth required" />
				</Match>
				<Match when={github.error()}>
					<text fg={theme.fg_dim} content="GitHub error" />
				</Match>
				<Match when={github.loading() && !github.data()}>
					<text fg={theme.fg_dim} content="loading…" />
				</Match>
				<Match when={true}>
					<text fg={theme.fg_dark} content={`Issues (${issues().length})`} />
					<Show
						when={issues().length > 0}
						fallback={
							<text fg={theme.fg_dim} content="(no issues)" />
						}
					>
						<For each={visible()}>
							{(issue) => {
								const line = () => formatIssueLine(issue);
								return (
									<box flexDirection="row" height={1}>
										<text fg={theme.fg_dim} content={`${line().number_str} `} />
										<text fg={theme.fg} content={line().title} />
										<For each={issue.labels}>
											{(_, i) => (
												<text fg={labelColor(i())} content=" ●" />
											)}
										</For>
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
	id: "github-issues",
	label: "GitHub Issues",
	size_hint,
	component: GithubIssuesWidget,
});

export { GithubIssuesWidget };
