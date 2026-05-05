// Theme tokens used:
//   blue       — border + action name in header
//   fg_dim     — header metadata, queued/skipped icons, action col, durations, footer hint
//   yellow     — running icon, summary colour when failures > 0
//   green      — succeeded icon, summary colour when zero failures
//   red        — failed icon
//   bg_dark    — overlay background
// All tokens verified present in `packages/render/src/theme/index.ts`.

import { useKeyboard } from "@opentui/solid";
import { For, Show, createMemo } from "solid-js";
import type { BatchAction, BatchFilter, BatchTask } from "../lib/batch";
import { theme } from "../theme";

export interface BatchOverlayPayload {
	action: BatchAction;
	filter: BatchFilter;
	dry_run: boolean;
	force: boolean;
	tasks_accessor: () => readonly BatchTask[];
	abort: () => void;
	done_accessor: () => boolean;
}

interface BatchOverlayProps {
	visible: boolean;
	payload: BatchOverlayPayload | null;
	onClose: () => void;
}

const COL_REPO = 25;
const COL_ACTION = 8;
const COL_DURATION = 8;

type IconColorToken = "fg_dim" | "yellow" | "green" | "red";

function status_icon(status: BatchTask["status"]): { icon: string; color_token: IconColorToken } {
	switch (status) {
		case "queued":
			return { icon: "▸", color_token: "fg_dim" };
		case "running":
			return { icon: "…", color_token: "yellow" };
		case "succeeded":
			return { icon: "✓", color_token: "green" };
		case "failed":
			return { icon: "✗", color_token: "red" };
		case "skipped":
			return { icon: "−", color_token: "fg_dim" };
	}
}

function row_message(task: BatchTask): string {
	if (task.status === "skipped" && task.skip_reason) {
		return `(${task.skip_reason.replace(/_/g, " ")})`;
	}
	return task.result_message ?? "";
}

function pad_or_truncate(s: string, n: number): string {
	if (s.length === n) return s;
	if (s.length < n) return s.padEnd(n, " ");
	return `${s.slice(0, Math.max(0, n - 1))}…`;
}

function pad_left(s: string, n: number): string {
	if (s.length >= n) return s;
	return s.padStart(n, " ");
}

function format_duration(task: BatchTask): string {
	if (task.duration_ms === undefined) return "";
	return `${task.duration_ms}ms`;
}

function header_text(
	payload: BatchOverlayPayload,
	completed: number,
	total: number,
): {
	action_segment: string;
	meta_segment: string;
} {
	const dry = payload.dry_run ? " [DRY-RUN]" : "";
	const force = payload.force ? " [FORCE]" : "";
	return {
		action_segment: `git ${payload.action}`,
		meta_segment: ` — filter: ${payload.filter}${dry}${force}  [${completed}/${total}]`,
	};
}

function TaskRow(props: { task: BatchTask }) {
	const icon = status_icon(props.task.status);
	const duration = format_duration(props.task);
	return (
		<box flexDirection="row" height={1}>
			<text content={pad_or_truncate(icon.icon, 2)} fg={theme[icon.color_token]} />
			<text content={pad_or_truncate(props.task.repo_name, COL_REPO)} fg={theme.fg} />
			<text content={pad_or_truncate(props.task.action, COL_ACTION)} fg={theme.fg_dim} />
			<text content={row_message(props.task)} fg={theme.fg} flexGrow={1} />
			<text content={pad_left(duration, COL_DURATION)} fg={theme.fg_dim} />
		</box>
	);
}

export function BatchOverlay(props: BatchOverlayProps) {
	const tasks = createMemo<readonly BatchTask[]>(() => props.payload?.tasks_accessor() ?? []);

	const counts = createMemo(() => {
		const ts = tasks();
		let succeeded = 0;
		let failed = 0;
		let skipped = 0;
		let running = 0;
		let queued = 0;
		for (const t of ts) {
			if (t.status === "succeeded") succeeded++;
			else if (t.status === "failed") failed++;
			else if (t.status === "skipped") skipped++;
			else if (t.status === "running") running++;
			else queued++;
		}
		return {
			succeeded,
			failed,
			skipped,
			running,
			queued,
			total: ts.length,
			completed: succeeded + failed + skipped,
		};
	});

	const done = createMemo(() => props.payload?.done_accessor() ?? false);

	useKeyboard((key) => {
		if (!props.visible) return;

		if (key.name === "escape") {
			if (!done()) {
				props.payload?.abort();
				return;
			}
			props.onClose();
			return;
		}

		if (key.name === "q") {
			if (done()) props.onClose();
			return;
		}
	});

	return (
		<Show when={props.visible ? props.payload : null}>
			{(payload) => (
				<box
					position="absolute"
					width="70%"
					height="80%"
					left="15%"
					top="10%"
					backgroundColor={theme.bg_dark}
					borderStyle="rounded"
					borderColor={theme.blue}
					title="Batch operation"
					titleAlignment="center"
					padding={1}
					flexDirection="column"
					gap={1}
					zIndex={110}
				>
					<box flexDirection="row" height={1}>
						<text content={header_text(payload(), counts().completed, counts().total).action_segment} fg={theme.blue} />
						<text content={header_text(payload(), counts().completed, counts().total).meta_segment} fg={theme.fg_dim} />
					</box>

					<Show when={tasks().length > 0} fallback={<text content="(no tasks to run)" fg={theme.fg_dim} />}>
						<scrollbox flexGrow={1}>
							<box flexDirection="column" flexShrink={0}>
								<For each={tasks()}>{(task) => <TaskRow task={task} />}</For>
							</box>
						</scrollbox>
					</Show>

					<box height={1}>
						<Show when={done()} fallback={<text content="Running... (Esc to abort, q when done)" fg={theme.fg_dim} />}>
							<text
								content={`${counts().succeeded} succeeded, ${counts().failed} failed, ${counts().skipped} skipped`}
								fg={counts().failed === 0 ? theme.green : theme.yellow}
							/>
						</Show>
					</box>
				</box>
			)}
		</Show>
	);
}
