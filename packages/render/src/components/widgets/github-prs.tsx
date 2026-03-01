import { For, Show, Switch, Match, createMemo } from "solid-js";
import type { WidgetRenderProps, RepoStatus, GithubPR } from "@overview/core";
import { registerWidget } from "./registry";
import { theme } from "../../theme";
import { truncate } from "../../lib/format";
import { useGithub } from "../../lib/use-github";

const size_hint = { span: "half" as const, min_height: 2 };
const MAX_VISIBLE = 10;

function statusIcon(pr: GithubPR): { char: string; color: string } {
	if (pr.is_draft) return { char: "●", color: theme.orange };
	if (pr.state === "closed" || pr.state === "CLOSED") return { char: "●", color: theme.fg_dim };
	return { char: "●", color: theme.green };
}

function ciIndicator(pr: GithubPR): { char: string; color: string } | null {
	if (pr.ci_status === "success") return { char: "✓", color: theme.green };
	if (pr.ci_status === "failure") return { char: "✗", color: theme.red };
	if (pr.ci_status === "pending") return { char: "◌", color: theme.yellow };
	return null;
}

function reviewIndicator(pr: GithubPR): { char: string; color: string } | null {
	const d = pr.review_decision;
	if (d === "APPROVED") return { char: "R", color: theme.green };
	if (d === "CHANGES_REQUESTED") return { char: "R", color: theme.orange };
	if (d === "REVIEW_REQUIRED") return { char: "R", color: theme.fg_dim };
	return null;
}

function GithubPRsWidget(props: WidgetRenderProps & { status: RepoStatus | null }) {
	const repo_path = createMemo(() => props.status?.path ?? null);
	const remote_url = createMemo(() => props.status?.remote_url ?? null);
	const github = useGithub(repo_path, remote_url);

	const prs = createMemo(() => github.data()?.prs ?? []);
	const visible = () => prs().slice(0, MAX_VISIBLE);
	const overflow = () => Math.max(0, prs().length - MAX_VISIBLE);

	const formatPrLine = (pr: GithubPR) => {
		const si = statusIcon(pr);
		const ci = ciIndicator(pr);
		const rv = reviewIndicator(pr);
		const number_str = `#${pr.number}`;
		// 2 (icon+space) + number + 1 space + ci(2) + rv(2) = overhead
		const suffix_len = (ci ? 2 : 0) + (rv ? 2 : 0);
		const available = props.width - 2 - number_str.length - 1 - suffix_len;
		const title = truncate(pr.title, Math.max(1, available));
		return { si, ci, rv, number_str, title };
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
					<text fg={theme.fg_dark} content={`GitHub PRs (${prs().length})`} />
					<Show
						when={prs().length > 0}
						fallback={
							<text fg={theme.fg_dim} content="(no open PRs)" />
						}
					>
						<For each={visible()}>
							{(pr) => {
								const line = () => formatPrLine(pr);
								return (
									<box flexDirection="row" height={1}>
										<text fg={line().si.color} content={`${line().si.char} `} />
										<text fg={theme.fg_dim} content={line().number_str} />
										<text content={` ${line().title}`} />
										<Show when={line().ci}>
											{(ci) => (
												<text fg={ci().color} content={` ${ci().char}`} />
											)}
										</Show>
										<Show when={line().rv}>
											{(rv) => (
												<text fg={rv().color} content={` ${rv().char}`} />
											)}
										</Show>
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
	id: "github-prs",
	label: "GitHub PRs",
	size_hint,
	component: GithubPRsWidget,
});

export { GithubPRsWidget };
