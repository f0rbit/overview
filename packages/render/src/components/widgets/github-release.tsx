import { Show, createMemo } from "solid-js";
import type { WidgetRenderProps, RepoStatus } from "@overview/core";
import { registerWidget } from "./registry";
import { theme } from "../../theme";
import { useGithub } from "../../lib/use-github";
import { formatRelativeTime } from "../../lib/format";

const size_hint = { span: "third" as const, min_height: 1 };

function GithubReleaseWidget(props: WidgetRenderProps & { status: RepoStatus | null }) {
	const repo_path = createMemo(() => props.status?.path ?? null);
	const remote_url = createMemo(() => props.status?.remote_url ?? null);
	const github = useGithub(repo_path, remote_url);

	const published_relative = () => {
		const release = github.data()?.latest_release;
		if (!release) return "";
		const ts = Math.floor(new Date(release.published_at).getTime() / 1000);
		return formatRelativeTime(ts);
	};

	return (
		<box flexDirection="column">
			<Show when={!github.error()}>
				<Show
					when={github.data()?.latest_release}
					fallback={
						<text fg={theme.fg_dim} content="no releases" />
					}
				>
					{(release) => (
						<>
							{/* Row 1: tag + published date */}
							<box flexDirection="row" height={1} gap={1}>
								<text fg={theme.green} content={release().tag_name} />
								<text fg={theme.fg_dim} content={published_relative()} />
							</box>

							{/* Row 2: commits since release */}
							<box flexDirection="row" height={1} gap={1}>
								<text
									fg={release().commits_since > 0 ? theme.yellow : theme.green}
									content={`${release().commits_since}`}
								/>
								<text fg={theme.fg_dim} content="commits since release" />
							</box>
						</>
					)}
				</Show>
			</Show>

			{/* Error states */}
			<Show when={github.error()?.kind === "gh_cli_not_found"}>
				<box flexDirection="row" height={1} gap={1}>
					<text fg={theme.fg_dim} content="gh not available" />
					<text fg={theme.cyan} content="https://cli.github.com" />
				</box>
			</Show>
			<Show when={github.error()?.kind === "not_github_repo"}>
				<text fg={theme.fg_dim} content="not a GitHub repo" />
			</Show>
		</box>
	);
}

registerWidget({
	id: "github-release",
	label: "Latest Release",
	size_hint,
	component: GithubReleaseWidget,
});

export { GithubReleaseWidget };
