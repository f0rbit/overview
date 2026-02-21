import { Show } from "solid-js";
import type { WidgetRenderProps, RepoStatus } from "@overview/core";
import { registerWidget } from "./registry";
import { theme } from "../../theme";
import { formatBytes } from "../../lib/format";

const size_request = { min_rows: 2, preferred_rows: 3, max_rows: 4 };

const SEMVER_RE = /^v?\d+\.\d+/;

function RepoMetaWidget(props: WidgetRenderProps & { status: RepoStatus | null }) {
	const rows = () => props.allocated_rows;
	const s = () => props.status;

	return (
		<box flexDirection="column">
			<Show
				when={s()}
				fallback={
					<text fg={theme.fg_dim} content="(no data)" />
				}
			>
				{(status) => {
					const latest_tag = () => status().tags[status().tags.length - 1] ?? null;
					const tag_is_semver = () => {
						const tag = latest_tag();
						return tag !== null && SEMVER_RE.test(tag);
					};

					return (
						<>
							{/* Row 1: commits + contributors */}
							<box flexDirection="row" height={1} gap={2}>
								<box flexDirection="row" gap={1}>
									<text fg={theme.yellow} content={`${status().total_commits}`} />
									<text fg={theme.fg_dim} content="commits" />
								</box>
								<box flexDirection="row" gap={1}>
									<text fg={theme.yellow} content={`${status().contributor_count}`} />
									<text fg={theme.fg_dim} content="contributors" />
								</box>
							</box>

							{/* Row 2: repo size + tag count */}
							<box flexDirection="row" height={1} gap={2}>
								<box flexDirection="row" gap={1}>
									<text fg={theme.yellow} content={formatBytes(status().repo_size_bytes)} />
									<text fg={theme.fg_dim} content="on disk" />
								</box>
								<box flexDirection="row" gap={1}>
									<text fg={theme.yellow} content={`${status().tags.length}`} />
									<text fg={theme.fg_dim} content="tags" />
								</box>
							</box>

							{/* Row 3: latest tag */}
							<Show when={rows() >= 3 && latest_tag()}>
								<box flexDirection="row" height={1} gap={1}>
									<text fg={theme.fg_dim} content="latest:" />
									<text
										fg={tag_is_semver() ? theme.green : theme.fg}
										content={latest_tag()!}
									/>
								</box>
							</Show>
						</>
					);
				}}
			</Show>
		</box>
	);
}

registerWidget({
	id: "repo-meta",
	label: "Repo Meta",
	size_request,
	component: RepoMetaWidget,
});

export { RepoMetaWidget };
