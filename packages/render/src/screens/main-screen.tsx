import { createSignal, createEffect, createMemo, onMount, onCleanup, Show } from "solid-js";
import { useKeyboard, useTerminalDimensions, useRenderer } from "@opentui/solid";
import type { RepoNode, GitGraphOutput, OverviewConfig, HealthStatus, WidgetConfig } from "@overview/core";
import { scanAndCollect, captureGraph, collectStats, collectStatus, createRepoWatcher, collectCommitActivity } from "@overview/core";
import { RepoList, GitGraph, WidgetContainer, StatusBar, HelpOverlay, type AppMode } from "../components";
import { filterTree, sortTree, nextFilter, nextSort, type SortMode, type FilterMode } from "../lib/filter";
import { createFetchContext } from "../lib/fetch-context";
import { launchGgi, launchEditor, launchSessionizer } from "../lib/actions";
import { loadWidgetState, saveWidgetState, defaultWidgetConfig, getWidgetState, updateWidgetState } from "../lib/widget-state";
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

function collectRepoPaths(nodes: RepoNode[]): string[] {
	return nodes.flatMap((n) =>
		n.type === "directory" ? collectRepoPaths(n.children) : [n.path],
	);
}

function updateRepoStatus(nodes: RepoNode[], repoPath: string, status: RepoNode["status"]): void {
	for (const n of nodes) {
		if (n.type === "directory") {
			updateRepoStatus(n.children, repoPath, status);
		} else if (n.path === repoPath) {
			n.status = status;
		}
	}
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
	const [sortMode, setSortMode] = createSignal<SortMode>(props.config.sort);
	const [filterMode, setFilterMode] = createSignal<FilterMode>(props.config.filter);
	const [showHelp, setShowHelp] = createSignal(false);
	const [widgetConfigs, setWidgetConfigs] = createSignal<WidgetConfig[]>(defaultWidgetConfig());
	const [repoVersion, setRepoVersion] = createSignal(0);

	const renderer = useRenderer();

	const dimensions = useTerminalDimensions();
	const leftWidth = () => 40;

	const rightPanelWidth = createMemo(() => {
		const w = dimensions().width - leftWidth() - 2; // subtract left panel border
		return Math.max(10, w);
	});

	const processedRepos = createMemo(() => {
		repoVersion(); // track version for reactivity
		let result = repos();
		result = filterTree(result, filterMode());
		result = sortTree(result, sortMode());
		return result;
	});

	const statusMessage = createMemo(() => {
		const parts: string[] = [];
		if (filterMode() !== "all") parts.push(`filter: ${filterMode()}`);
		if (sortMode() !== "name") parts.push(`sort: ${sortMode()}`);
		return parts.length > 0 ? parts.join("  ") : message();
	});

	const repoCount = createMemo(() => countNodes(repos()));
	const dirtyCount = createMemo(() => countByHealth(repos(), (h) => h !== "clean"));
	const aheadCount = createMemo(() => countByHealth(repos(), (h) => h === "ahead" || h === "diverged"));

	const widgetSummary = createMemo(() => {
		const configs = widgetConfigs();
		const enabled = configs.filter((c) => c.enabled).length;
		return `${enabled}/${configs.length} widgets`;
	});

	async function handleWidgetConfigChange(configs: WidgetConfig[]) {
		setWidgetConfigs(configs);
		const state = { ...getWidgetState(), widgets: configs };
		updateWidgetState(state);
		await saveWidgetState(state);
	}

	let _details_request_id = 0;
	let _details_timer: ReturnType<typeof setTimeout> | undefined;

	async function fetchDetails(node: RepoNode | null) {
		if (!node || node.type === "directory") {
			setGraph(null);
			setGraphLoading(false);
			setStatsLoading(false);
			return;
		}

		const my_request_id = _details_request_id;

		setGraphLoading(true);
		setStatsLoading(true);

		const [graphResult, statsResult, activityResult] = await Promise.all([
			captureGraph(node.path),
			collectStats(node.path),
			collectCommitActivity(node.path),
		]);

		// Stale check — a newer request was issued while we were awaiting
		if (my_request_id !== _details_request_id) return;

		if (graphResult.ok) setGraph(graphResult.value);
		else setGraph(null);

		if (statsResult.ok && node.status) {
			node.status.tags = statsResult.value.tags;
			node.status.total_commits = statsResult.value.total_commits;
			node.status.repo_size_bytes = statsResult.value.repo_size_bytes;
			node.status.contributor_count = statsResult.value.contributor_count;
			node.status.recent_commits = statsResult.value.recent_commits;
		}

		if (activityResult.ok && node.status) {
			node.status.commit_activity = activityResult.value;
		}

		setGraphLoading(false);
		setStatsLoading(false);
	}

	createEffect(() => {
		const node = selectedNode();
		clearTimeout(_details_timer);
		if (!node || node.type === "directory") {
			_details_request_id++;
			setGraph(null);
			setGraphLoading(false);
			setStatsLoading(false);
			return;
		}
		// Show loading state immediately
		setGraphLoading(true);
		setStatsLoading(true);
		// Debounce the actual fetch
		_details_request_id++;
		_details_timer = setTimeout(() => {
			fetchDetails(node);
		}, 250);
	});

	const watcher = createRepoWatcher({
		debounce_ms: 500,
		on_change: (repoPath) => {
			collectStatus(repoPath, props.config.scan_dirs[0]!).then((result) => {
				if (result.ok) {
				updateRepoStatus(repos(), repoPath, result.value);
				setRepoVersion(v => v + 1);
				}
			});
		},
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
				watcher.watch(collectRepoPaths(result.value));
			}
		}
		setScanning(false);
	}

	onMount(() => {
		performScan();
		loadWidgetState().then((result) => {
			if (result.ok) {
				setWidgetConfigs(result.value.widgets);
				updateWidgetState(result.value);
			}
		});
	});

	onCleanup(() => {
		clearTimeout(_details_timer);
		watcher.close();
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
				case "r":
					_details_request_id++;
					clearTimeout(_details_timer);
					fetchDetails(selectedNode());
					break;
				case "R":
					performScan();
					break;
				case "f":
					setFilterMode(nextFilter(filterMode()));
					break;
				case "s":
					setSortMode(nextSort(sortMode()));
					break;
				case "o": {
					const node = selectedNode();
					if (node?.type === "repo" || node?.type === "worktree") {
						launchEditor(node.path, props.config.actions.editor, {
							onSuspend: () => renderer.suspend(),
							onResume: () => renderer.resume(),
						});
					}
					break;
				}
				case "t": {
					const node = selectedNode();
					if ((node?.type === "repo" || node?.type === "worktree") && props.config.actions.sessionizer) {
						launchSessionizer(node.path, props.config.actions.sessionizer, {
							onSuspend: () => renderer.suspend(),
							onResume: () => renderer.resume(),
						});
					}
					break;
				}
			}

			if (key.raw === "?") {
				setShowHelp(!showHelp());
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
				case "g": {
					const node = selectedNode();
					if (node?.type === "repo" || node?.type === "worktree") {
						launchGgi(node.path, props.config.actions.ggi, {
							onSuspend: () => renderer.suspend(),
							onResume: () => renderer.resume(),
						});
					}
					break;
				}
				case "o": {
					const node = selectedNode();
					if (node?.type === "repo" || node?.type === "worktree") {
						launchEditor(node.path, props.config.actions.editor, {
							onSuspend: () => renderer.suspend(),
							onResume: () => renderer.resume(),
						});
					}
					break;
				}
				case "t": {
					const node = selectedNode();
					if ((node?.type === "repo" || node?.type === "worktree") && props.config.actions.sessionizer) {
						launchSessionizer(node.path, props.config.actions.sessionizer, {
							onSuspend: () => renderer.suspend(),
							onResume: () => renderer.resume(),
						});
					}
					break;
				}
				case "r":
					_details_request_id++;
					clearTimeout(_details_timer);
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
				<text fg={theme.fg_dim} content={`${props.config.scan_dirs[0]} — ${repoCount()} repos`} />
				<Show when={scanning()}>
					<text fg={theme.yellow}> scanning...</text>
				</Show>
			</box>

			{/* Main content */}
			<box flexDirection="row" flexGrow={1}>
				{/* Left panel */}
				<box width={leftWidth()} flexDirection="column" borderStyle="rounded" borderColor={theme.border}>
					<RepoList
						repos={processedRepos()}
						focused={focusPanel() === "list"}
						onSelect={handleSelect}
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
					<WidgetContainer
						status={selectedNode()?.status ?? null}
						repoName={selectedNode()?.name ?? ""}
						loading={statsLoading()}
						focused={focusPanel() === "stats"}
						height="50%"
						availableWidth={rightPanelWidth()}
						widgetConfigs={widgetConfigs()}
						onWidgetConfigChange={handleWidgetConfigChange}
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
				message={statusMessage()}
				widgetSummary={widgetSummary()}
			/>

			<HelpOverlay visible={showHelp()} onClose={() => setShowHelp(false)} />
		</box>
	);
}
