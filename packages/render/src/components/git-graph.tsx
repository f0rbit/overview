import { Show, For } from "solid-js";
import type { GitGraphOutput } from "@overview/core";
import { theme } from "../theme";

interface GitGraphProps {
	graph: GitGraphOutput | null;
	repoName: string;
	loading: boolean;
	focused: boolean;
	height: number | `${number}%` | "auto";
}

interface Segment {
	text: string;
	color: string;
}

// Graph characters: * | / \ _ (edges and merge points)
const GRAPH_CHARS = /^[*|/\\_\s.]+/;
// Short hash: 7+ hex chars
const HASH_RE = /^[0-9a-f]{7,12}/;
// Ref decoration: (HEAD -> main, origin/main, tag: v1.0)
const REF_RE = /^\([^)]+\)/;

function parseGraphLine(line: string): Segment[] {
	const segments: Segment[] = [];

	// 1. Graph prefix (lines, merge points)
	const graphMatch = line.match(GRAPH_CHARS);
	let rest = line;

	if (graphMatch) {
		const graphPart = graphMatch[0];
		// Color the * merge points differently from the | / \ lines
		if (graphPart.includes("*")) {
			const starIdx = graphPart.indexOf("*");
			if (starIdx > 0) {
				segments.push({ text: graphPart.slice(0, starIdx), color: theme.fg_dim });
			}
			segments.push({ text: "*", color: theme.green });
			const after = graphPart.slice(starIdx + 1);
			if (after) {
				segments.push({ text: after, color: theme.fg_dim });
			}
		} else {
			segments.push({ text: graphPart, color: theme.fg_dim });
		}
		rest = line.slice(graphPart.length);
	}

	if (!rest) return segments;

	// 2. Hash
	const hashMatch = rest.match(HASH_RE);
	if (hashMatch) {
		segments.push({ text: hashMatch[0], color: theme.yellow });
		rest = rest.slice(hashMatch[0].length);
	}

	if (!rest) return segments;

	// 3. Space before ref
	if (rest.startsWith(" ")) {
		segments.push({ text: " ", color: theme.fg });
		rest = rest.slice(1);
	}

	// 4. Ref decoration
	const refMatch = rest.match(REF_RE);
	if (refMatch) {
		segments.push({ text: refMatch[0], color: theme.cyan });
		rest = rest.slice(refMatch[0].length);
	}

	// 5. Commit message (everything remaining)
	if (rest) {
		segments.push({ text: rest, color: theme.fg });
	}

	return segments;
}

function GraphLine(props: { line: string }) {
	const segments = () => parseGraphLine(props.line);

	return (
		<box flexDirection="row" height={1}>
			<For each={segments()}>
				{(seg) => <text fg={seg.color} content={seg.text} />}
			</For>
		</box>
	);
}

export function GitGraph(props: GitGraphProps) {
	return (
		<box
			borderStyle="rounded"
			borderColor={props.focused ? theme.border_highlight : theme.border}
			title={`git graph: ${props.repoName}`}
			titleAlignment="left"
			flexDirection="column"
			flexGrow={1}
			height={props.height}
		>
			<Show
				when={!props.loading && props.graph && props.graph.lines.length > 0}
				fallback={
				<text fg={theme.fg_dim} content={props.loading ? "loading..." : "(no commits)"} />
				}
			>
				<scrollbox
					focused={props.focused}
					viewportCulling={true}
					flexGrow={1}
				>
					<For each={props.graph!.lines}>
						{(line) => <GraphLine line={line} />}
					</For>
				</scrollbox>
			<box height={1}>
				<text fg={theme.fg_dim} content={`(${props.graph!.total_lines} commits)`} />
			</box>
			</Show>
		</box>
	);
}
