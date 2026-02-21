import { For, Show } from "solid-js";
import type { WidgetRenderProps, RepoStatus, BranchInfo } from "@overview/core";
import { registerWidget } from "./registry";
import { theme } from "../../theme";
import { truncate } from "../../lib/format";

const size_request = { min_rows: 3, preferred_rows: 6, max_rows: 10 };
const STALE_THRESHOLD = 30 * 24 * 60 * 60; // 30 days in seconds

function sortBranches(branches: BranchInfo[]): BranchInfo[] {
	return [...branches].sort((a, b) => {
		if (a.is_current !== b.is_current) return a.is_current ? -1 : 1;
		return b.last_commit_time - a.last_commit_time;
	});
}

function isStale(branch: BranchInfo): boolean {
	const now = Math.floor(Date.now() / 1000);
	return now - branch.last_commit_time > STALE_THRESHOLD;
}

function BranchListWidget(props: WidgetRenderProps & { status: RepoStatus | null }) {
	const branches = () => props.status ? sortBranches(props.status.branches) : [];
	const visible_count = () => props.allocated_rows - 1;
	const visible = () => branches().slice(0, visible_count());
	const overflow = () => Math.max(0, branches().length - visible_count());
	const has_sync = (b: BranchInfo) => b.ahead > 0 || b.behind > 0;

	return (
		<box flexDirection="column">
			<Show
				when={props.status}
				fallback={
					<text fg={theme.fg_dim} content="no repo selected" />
				}
			>
				{(status) => (
					<>
						<text fg={theme.fg_dark} content={`Branches (${status().branches.length})`} />

						<Show
							when={branches().length > 0}
							fallback={
								<text fg={theme.fg_dim} content="(no branches)" />
							}
						>
							<For each={visible()}>
								{(branch) => (
									<box flexDirection="row" height={1}>
										<text
											fg={branch.is_current ? theme.green : theme.fg}
											content={branch.is_current ? "* " : "  "}
										/>
										<text
											fg={branch.is_current ? theme.green : theme.fg}
											content={truncate(branch.name, props.width - 20)}
										/>
										<Show when={has_sync(branch)}>
											<Show when={branch.ahead > 0}>
												<text fg={theme.yellow} content={` ↑${branch.ahead}`} />
											</Show>
											<Show when={branch.behind > 0}>
												<text fg={theme.cyan} content={` ↓${branch.behind}`} />
											</Show>
										</Show>
										<Show when={isStale(branch)}>
											<text fg={theme.orange} content=" (stale)" />
										</Show>
									</box>
								)}
							</For>

							<Show when={overflow() > 0}>
								<text fg={theme.fg_dim} content={`+${overflow()} more`} />
							</Show>
						</Show>
					</>
				)}
			</Show>
		</box>
	);
}

registerWidget({
	id: "branch-list",
	label: "Branches",
	size_request,
	component: BranchListWidget,
});

export { BranchListWidget };
