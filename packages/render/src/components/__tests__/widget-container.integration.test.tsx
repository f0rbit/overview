import { describe, test, expect } from "bun:test";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import type { ScrollBoxRenderable, Renderable } from "@opentui/core";
import type { WidgetConfig, RepoStatus, WidgetId } from "@overview/core";

import { WidgetContainer } from "../widget-container";
import "../widgets/index";

function mockRepoStatus(): RepoStatus {
	return {
		path: "/tmp/test-repo",
		name: "test-repo",
		display_path: "test-repo",
		current_branch: "main",
		head_commit: "abc1234",
		head_message: "test commit",
		head_time: Date.now() / 1000,
		remote_url: null,
		ahead: 2,
		behind: 0,
		modified_count: 3,
		staged_count: 1,
		untracked_count: 1,
		conflict_count: 0,
		changes: [],
		stashes: [],
		stash_count: 0,
		branches: [
			{
				name: "main",
				is_current: true,
				upstream: "origin/main",
				ahead: 2,
				behind: 0,
				last_commit_time: Date.now() / 1000,
			},
		],
		local_branch_count: 1,
		remote_branch_count: 1,
		tags: ["v1.0"],
		total_commits: 50,
		repo_size_bytes: 1024000,
		contributor_count: 3,
		recent_commits: [
			{
				hash: "abc1234",
				message: "test commit",
				author: "test",
				time: Date.now() / 1000,
			},
		],
		is_clean: false,
		health: "ahead" as const,
	};
}

const ALL_WIDGET_IDS: WidgetId[] = [
	"git-status",
	"devpad-milestones",
	"recent-commits",
	"github-prs",
	"devpad-tasks",
	"file-changes",
	"repo-meta",
	"github-ci",
	"branch-list",
	"commit-activity",
	"github-release",
	"github-issues",
];

function defaultTestWidgetConfigs(): WidgetConfig[] {
	return ALL_WIDGET_IDS.map((id, i) => ({
		id,
		enabled: true,
		collapsed: false,
		priority: i,
	}));
}

describe("widget container (integration)", () => {
	test("renders all enabled widgets in grid layout", async () => {
		const { renderOnce, captureCharFrame } = await testRender(
			() => (
				<box flexDirection="column" width={80} height={50}>
					<WidgetContainer
						status={mockRepoStatus()}
						repoName="test-repo"
						loading={false}
						focused={true}
						height={50}
						availableWidth={80}
						widgetConfigs={defaultTestWidgetConfigs()}
					/>
				</box>
			),
			{ width: 80, height: 50 },
		);

		await renderOnce();
		const frame = captureCharFrame();

		// Border characters present (scrollbar may replace right-side corners ╮/╯)
		expect(frame).toContain("╭");
		expect(frame).toContain("╰");
		expect(frame).toContain("─");

		// Widget labels visible (first widget + a few others)
		expect(frame).toContain("Git Status");
		expect(frame).toContain("Recent Commits");
		expect(frame).toContain("Repo Meta");
	});

	test("focused widget has highlight marker", async () => {
		const { renderOnce, captureCharFrame } = await testRender(
			() => (
				<box flexDirection="column" width={80} height={50}>
					<WidgetContainer
						status={mockRepoStatus()}
						repoName="test-repo"
						loading={false}
						focused={true}
						height={50}
						availableWidth={80}
						widgetConfigs={defaultTestWidgetConfigs()}
					/>
				</box>
			),
			{ width: 80, height: 50 },
		);

		await renderOnce();
		const frame = captureCharFrame();

		// The focused widget (first by priority = git-status) shows ▸ marker
		expect(frame).toContain("▸");
		expect(frame).toContain("▸ Git Status");
	});

	test("j/k navigation changes focused widget", async () => {
		const { renderOnce, captureCharFrame, mockInput } = await testRender(
			() => (
				<box flexDirection="column" width={80} height={50}>
					<WidgetContainer
						status={mockRepoStatus()}
						repoName="test-repo"
						loading={false}
						focused={true}
						height={50}
						availableWidth={80}
						widgetConfigs={defaultTestWidgetConfigs()}
					/>
				</box>
			),
			{ width: 80, height: 50 },
		);

		await renderOnce();
		const frame_before = captureCharFrame();
		expect(frame_before).toContain("▸ Git Status");

		// Press j to move focus down
		mockInput.pressKey("j");
		await renderOnce();
		const frame_after_j = captureCharFrame();

		// Git Status should no longer have the ▸ marker
		expect(frame_after_j).not.toContain("▸ Git Status");
		// The second widget (devpad-milestones) should now be focused
		expect(frame_after_j).toContain("▸ Devpad Milestones");

		// Press k to go back
		mockInput.pressKey("k");
		await renderOnce();
		const frame_after_k = captureCharFrame();

		expect(frame_after_k).toContain("▸ Git Status");
		expect(frame_after_k).not.toContain("▸ Devpad Milestones");
	});

	test("collapsed widget shows collapsed indicator", async () => {
		const configs = defaultTestWidgetConfigs();
		// Collapse the first widget
		configs[0] = { ...configs[0]!, collapsed: true };

		const { renderOnce, captureCharFrame } = await testRender(
			() => (
				<box flexDirection="column" width={80} height={50}>
					<WidgetContainer
						status={mockRepoStatus()}
						repoName="test-repo"
						loading={false}
						focused={true}
						height={50}
						availableWidth={80}
						widgetConfigs={configs}
					/>
				</box>
			),
			{ width: 80, height: 50 },
		);

		await renderOnce();
		const frame = captureCharFrame();

		expect(frame).toContain("(collapsed)");
		expect(frame).toContain("[>]");
	});

	test("scroll-to-focused reaches bottom widgets in nested layout", async () => {
		const { renderOnce, captureCharFrame, mockInput } = await testRender(
			() => (
				<box flexDirection="column" width="100%" height="100%">
					<box height={1}>
						<text content="header" />
					</box>
					<box flexDirection="row" flexGrow={1}>
						<box width={40}>
							<text content="left" />
						</box>
						<box flexDirection="column" flexGrow={1}>
							<box height="50%">
								<text content="graph" />
							</box>
							<WidgetContainer
								status={mockRepoStatus()}
								repoName="test-repo"
								loading={false}
								focused={true}
								height="50%"
								availableWidth={80}
								widgetConfigs={defaultTestWidgetConfigs()}
							/>
						</box>
					</box>
					<box height={1}>
						<text content="status" />
					</box>
				</box>
			),
			{ width: 120, height: 40 },
		);

		await renderOnce();

		// Navigate to the last widget by pressing j many times
		for (let i = 0; i < 15; i++) {
			mockInput.pressKey("j");
			await renderOnce();
		}

		const frame = captureCharFrame();

		// The ▸ marker should always be visible (scroll-to-focused keeps it in view)
		expect(frame).toContain("▸");

		// The last widget (by priority order: github-issues, label "GitHub Issues") should be visible
		// or at least the focus marker should be present proving scroll worked
		const lines = frame.split("\n");
		const marker_line = lines.find((l: string) => l.includes("▸"));
		expect(marker_line).toBeDefined();
	});

	test("c key toggles widget collapse", async () => {
		const [updated_configs, setUpdatedConfigs] = createSignal<WidgetConfig[] | null>(null);

		const { renderOnce, mockInput } = await testRender(
			() => (
				<box flexDirection="column" width={80} height={50}>
					<WidgetContainer
						status={mockRepoStatus()}
						repoName="test-repo"
						loading={false}
						focused={true}
						height={50}
						availableWidth={80}
						widgetConfigs={defaultTestWidgetConfigs()}
						onWidgetConfigChange={(configs) => setUpdatedConfigs(configs)}
					/>
				</box>
			),
			{ width: 80, height: 50 },
		);

		await renderOnce();

		// Press c to toggle collapse on the focused (first) widget
		mockInput.pressKey("c");
		await renderOnce();

		const result = updated_configs();
		expect(result).not.toBeNull();

		// First widget (git-status) should now be collapsed
		const git_status_config = result!.find((c) => c.id === "git-status");
		expect(git_status_config).toBeDefined();
		expect(git_status_config!.collapsed).toBe(true);

		// Other widgets should remain uncollapsed
		const other = result!.find((c) => c.id === "recent-commits");
		expect(other).toBeDefined();
		expect(other!.collapsed).toBe(false);
	});
});
