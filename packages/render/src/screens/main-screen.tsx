import { createSignal, createEffect, createMemo, onMount, Show } from "solid-js";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import type { RepoNode, GitGraphOutput, OverviewConfig, HealthStatus } from "@overview/core";
import { scanAndCollect, captureGraph, collectStats } from "@overview/core";
import { RepoList, GitGraph, StatsPanel, StatusBar, type AppMode } from "../components";
import { theme } from "../theme";

interface MainScreenProps {
	config: OverviewConfig;
}

function countNodes(nodes: RepoNode[]): number {
	return nodes.reduce(
		(acc, n) => acc + (n.type === "directory" ? countNodes(n.children) : 1),
		0,
	);
}

function countByHealth(nodes: RepoNode[], pred: (h: HealthStatus) => boolean): number {
	return nodes.reduce((acc, n) => {
		if (n.type === "directory") return acc + countByHealth(n.children, pred);
		return acc + (n.status && pred(n.status.health) ? 1 : 0);
	}, 0);
}

export function MainScreen(props: MainScreenProps) {
	const [repos, setRepos] = createSignal<RepoNode[]>([]);
	const [selectedNode, setSelectedNode] = createSignal<RepoNode | null>(null);
	const [graph, setGraph] = createSignal<GitGraphOutput | null>(null);
	const [graphLoading, setGraphLoading] = createSignal(false);
	const [statsLoading, setStatsLoading] = createSignal(false);
	const [scanning, setScanning] = createSignal(true);
	const [mode, setMode] = createSignal<AppMode>("NORMAL");
	const [focusPanel, setFocusPanel] = createSignal<"list" | "graph" | "stats">("list");
	const [message, setMessage] = createSignal<string | null>(null);

	const dimensions = useTerminalDimensions();
	const leftWidth = createMemo(() => Math.floor(dimensions().width * props.config.layout.left_width_pct / 100));

	const repoCount = createMemo(() => countNodes(repos()));
	const dirtyCount = createMemo(() => countByHealth(repos(), (h) => h !== "clean"));
	const aheadCount = createMemo(() => countByHealth(repos(), (h) => h === "ahead" || h === "diverged"));

	async function fetchDetails(node: RepoNode | null) {
		if (!node || node.type === "directory") {
			setGraph(null);
			return;
		}

		setGraphLoading(true);
		setStatsLoading(true);

		const [graphResult, statsResult] = await Promise.all([
			captureGraph(node.path),
			collectStats(node.path),
		]);

		if (graphResult.ok) setGraph(graphResult.value);
		else setGraph(null);

		if (statsResult.ok && node.status) {
			node.status.tags = statsResult.value.tags;
			node.status.total_commits = statsResult.value.total_commits;
			node.status.repo_size_bytes = statsResult.value.repo_size_bytes;
			node.status.contributor_count = statsResult.value.contributor_count;
			node.status.recent_commits = statsResult.value.recent_commits;
		}

		setGraphLoading(false);
		setStatsLoading(false);
	}

	createEffect(() => {
		const node = selectedNode();
		fetchDetails(node);
	});

	async function performScan() {
		setScanning(true);
		for (const dir of props.config.scan_dirs) {
			const result = await scanAndCollect(dir, {
				depth: props.config.depth,
				ignore: props.config.ignore,
			});
			if (result.ok) {
				setRepos(result.value);
			}
		}
		setScanning(false);
	}

	onMount(() => {
		performScan();
	});

	const FOCUS_ORDER = ["list", "graph", "stats"] as const;

	function cycleFocus() {
		const current = focusPanel();
		const idx = FOCUS_ORDER.indexOf(current);
		setFocusPanel(FOCUS_ORDER[(idx + 1) % FOCUS_ORDER.length]!);
	}

	function handleSelect(node: RepoNode) {
		setSelectedNode(node);
	}

	useKeyboard((key) => {
		const m = mode();

		if (key.name === "tab") {
			cycleFocus();
			return;
		}

		if (m === "NORMAL") {
			switch (key.name) {
				case "q":
				case "escape":
					process.exit(0);
					break;
				case "return": {
					const node = selectedNode();
					if (node && node.type !== "directory") {
						setMode("DETAIL");
						setFocusPanel("graph");
					}
					break;
				}
				case "g":
					setMessage("ggi: not yet implemented");
					setTimeout(() => setMessage(null), 2000);
					break;
				case "r":
					fetchDetails(selectedNode());
					break;
				case "R":
					performScan();
					break;
				case "?":
					setMessage("help: not yet implemented");
					setTimeout(() => setMessage(null), 2000);
					break;
			}
			return;
		}

		if (m === "DETAIL") {
			switch (key.name) {
				case "q":
				case "escape":
					setMode("NORMAL");
					setFocusPanel("list");
					break;
				case "h":
					setFocusPanel("graph");
					break;
				case "l":
					setFocusPanel("stats");
					break;
				case "g":
					setMessage("ggi: not yet implemented");
					setTimeout(() => setMessage(null), 2000);
					break;
				case "r":
					fetchDetails(selectedNode());
					break;
			}
		}
	});

	return (
		<box flexDirection="column" width="100%" height="100%" backgroundColor={theme.bg}>
			{/* Header */}
			<box height={1} width="100%" backgroundColor={theme.bg_dark} paddingLeft={1}>
				<text fg={theme.blue}>overview</text>
				<box flexGrow={1} />
				<text fg={theme.fg_dim}>{props.config.scan_dirs[0]} — {repoCount()} repos</text>
				<Show when={scanning()}>
					<text fg={theme.yellow}> scanning...</text>
				</Show>
			</box>

			{/* Main content */}
			<box flexDirection="row" flexGrow={1}>
				{/* Left panel */}
				<box width={leftWidth()} flexDirection="column" borderStyle="rounded" borderColor={theme.border}>
					<RepoList
						repos={repos()}
						focused={focusPanel() === "list"}
						onSelect={handleSelect}
						width={leftWidth()}
					/>
				</box>

				{/* Right panels */}
				<box flexDirection="column" flexGrow={1}>
					<GitGraph
						graph={graph()}
						repoName={selectedNode()?.name ?? ""}
						loading={graphLoading()}
						focused={focusPanel() === "graph"}
						height="50%"
					/>
					<StatsPanel
						status={selectedNode()?.status ?? null}
						repoName={selectedNode()?.name ?? ""}
						loading={statsLoading()}
						focused={focusPanel() === "stats"}
						height="50%"
					/>
				</box>
			</box>

			{/* Status bar */}
			<StatusBar
				mode={mode()}
				repoCount={repoCount()}
				dirtyCount={dirtyCount()}
				aheadCount={aheadCount()}
				scanning={scanning()}
				message={message()}
			/>
		</box>
	);
}
