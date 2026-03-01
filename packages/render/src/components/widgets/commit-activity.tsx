import { Show, createSignal, createEffect, createMemo } from "solid-js";
import type { WidgetRenderProps, RepoStatus } from "@overview/core";
import { collectCommitActivity, type CommitActivity } from "@overview/core";
import { registerWidget } from "./registry";
import { theme } from "../../theme";

const size_hint = { span: "third" as const, min_height: 2 };

const BLOCKS = " ▁▂▃▄▅▆▇█";

function renderSparkline(counts: number[]): string {
	const max = Math.max(...counts, 1);
	return counts
		.map((c) => {
			const level = Math.round((c / max) * 8);
			return BLOCKS[level] ?? " ";
		})
		.join("");
}

function CommitActivityWidget(props: WidgetRenderProps & { status: RepoStatus | null }) {
	const [activity, setActivity] = createSignal<CommitActivity | null>(null);

	createEffect(async () => {
		const path = props.status?.path;
		if (!path) {
			setActivity(null);
			return;
		}
		const result = await collectCommitActivity(path);
		if (result.ok) setActivity(result.value);
	});

	const sparkline = createMemo(() => {
		const a = activity();
		if (!a) return "";
		return renderSparkline(a.daily_counts);
	});

	const delta = createMemo(() => {
		const a = activity();
		if (!a) return 0;
		return a.total_this_week - a.total_last_week;
	});

	const delta_str = createMemo(() => {
		const d = delta();
		if (d > 0) return `+${d}`;
		if (d < 0) return `${d}`;
		return "0";
	});

	const delta_color = createMemo(() => {
		const d = delta();
		if (d > 0) return theme.green;
		if (d < 0) return theme.red;
		return theme.fg_dim;
	});

	const total_14d = createMemo(() => {
		const a = activity();
		if (!a) return 0;
		return a.daily_counts.reduce((sum, c) => sum + c, 0);
	});

	const sparkline_colored = createMemo(() => {
		const a = activity();
		if (!a) return [];
		return a.daily_counts.map((c) => ({
			char: BLOCKS[Math.round((c / Math.max(...a.daily_counts, 1)) * 8)] ?? " ",
			color: c > 0 ? theme.green : theme.fg_dim,
		}));
	});

	return (
		<box flexDirection="column">
			<Show
				when={activity()}
				fallback={
					<text fg={theme.fg_dim} content="(no activity data)" />
				}
			>
				{/* Row 1: Sparkline */}
				<box flexDirection="row" height={1}>
					{sparkline_colored().map((s) => (
						<text fg={s.color} content={s.char} />
					))}
				</box>

				{/* Row 2: Weekly stats */}
				<box flexDirection="row" height={1} gap={2}>
					<box flexDirection="row" gap={1}>
						<text fg={theme.fg_dim} content="this week:" />
						<text fg={theme.yellow} content={`${activity()!.total_this_week}`} />
					</box>
					<box flexDirection="row" gap={1}>
						<text fg={theme.fg_dim} content="last week:" />
						<text fg={theme.yellow} content={`${activity()!.total_last_week}`} />
					</box>
					<box flexDirection="row" gap={1}>
						<text fg={theme.fg_dim} content="delta:" />
						<text fg={delta_color()} content={delta_str()} />
					</box>
				</box>

				{/* Row 3: Total */}
				<box flexDirection="row" height={1} gap={1}>
					<text fg={theme.yellow} content={`${total_14d()}`} />
					<text fg={theme.fg_dim} content="commits in 14 days" />
				</box>
			</Show>
		</box>
	);
}

registerWidget({
	id: "commit-activity",
	label: "Commit Activity",
	size_hint,
	component: CommitActivityWidget,
});

export { CommitActivityWidget };
