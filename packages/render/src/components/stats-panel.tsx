import { Show } from "solid-js";
import type { RepoStatus } from "@overview/core";
import { theme } from "../theme";

interface StatsPanelProps {
	status: RepoStatus | null;
	repoName: string;
	loading: boolean;
	focused: boolean;
	height: number | `${number}%` | "auto";
}

function formatRelativeTime(timestamp: number): string {
	const seconds = Math.floor(Date.now() / 1000) - timestamp;
	if (seconds < 60) return "just now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d ago`;
	const weeks = Math.floor(days / 7);
	if (weeks < 5) return `${weeks}w ago`;
	const months = Math.floor(days / 30);
	if (months < 12) return `${months}mo ago`;
	const years = Math.floor(days / 365);
	return `${years}y ago`;
}

function StatRow(props: { label: string; value: string; color?: string }) {
	return (
		<box flexDirection="row" height={1}>
			<text fg={theme.fg_dim} content={props.label.padEnd(12)} />
			<text fg={props.color ?? theme.fg} content={props.value} />
		</box>
	);
}

function CleanState(props: { status: RepoStatus }) {
	return (
		<box flexDirection="column" gap={1}>
			<text fg={theme.status.clean}>✓ Everything clean & up to date</text>
			<box flexDirection="column">
				<StatRow label="branch" value={props.status.current_branch} />
				<StatRow label="last commit" value={formatRelativeTime(props.status.head_time)} />
			</box>
		</box>
	);
}

function StatusDetails(props: { status: RepoStatus }) {
	return (
		<box flexDirection="column" gap={1}>
			<box flexDirection="column">
				<StatRow label="branch" value={props.status.current_branch} />
				<StatRow label="remote" value={props.status.remote_url ?? "(none)"} />
			</box>

			<Show when={props.status.ahead > 0 || props.status.behind > 0}>
				<box flexDirection="row" height={1} gap={2}>
					<text fg={theme.status.ahead} content={`↑ ${props.status.ahead} ahead`} />
					<text fg={theme.status.behind} content={`↓ ${props.status.behind} behind`} />
				</box>
			</Show>

			<Show
				when={
					props.status.modified_count > 0 ||
					props.status.staged_count > 0 ||
					props.status.untracked_count > 0 ||
					props.status.conflict_count > 0
				}
			>
				<box flexDirection="column">
					<Show when={props.status.modified_count > 0 || props.status.staged_count > 0}>
						<box flexDirection="row" height={1} gap={2}>
							<text fg={theme.status.modified} content={`~ ${props.status.modified_count} modified`} />
							<text fg={theme.green} content={`+ ${props.status.staged_count} staged`} />
						</box>
					</Show>
					<Show when={props.status.untracked_count > 0 || props.status.conflict_count > 0}>
						<box flexDirection="row" height={1} gap={2}>
							<text fg={theme.status.untracked} content={`? ${props.status.untracked_count} untracked`} />
							<text fg={theme.status.conflict} content={`! ${props.status.conflict_count} conflicts`} />
						</box>
					</Show>
				</box>
			</Show>

			<Show when={props.status.stash_count > 0}>
				<text fg={theme.status.stash} content={`✂ ${props.status.stash_count} stashes`} />
			</Show>

			<StatRow label="last commit" value={formatRelativeTime(props.status.head_time)} />
		</box>
	);
}

export function StatsPanel(props: StatsPanelProps) {
	return (
		<box
			borderStyle="rounded"
			borderColor={props.focused ? theme.border_highlight : theme.border}
			title={`stats: ${props.repoName}`}
			titleAlignment="left"
			flexDirection="column"
			flexGrow={1}
			height={props.height}
			padding={1}
			gap={1}
		>
			<Show
				when={!props.loading}
				fallback={<text fg={theme.fg_dim}>loading...</text>}
			>
				<Show
					when={props.status}
					fallback={<text fg={theme.fg_dim}>(select a repo)</text>}
				>
					{(status) => (
						<Show
							when={!status().is_clean}
							fallback={<CleanState status={status()} />}
						>
							<StatusDetails status={status()} />
						</Show>
					)}
				</Show>
			</Show>
		</box>
	);
}
