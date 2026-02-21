import { createSignal, createMemo, createEffect, For } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import type { RepoNode } from "@overview/core";
import { theme } from "../theme";
import { StatusBadge } from "./status-badge";

interface RepoListProps {
	repos: RepoNode[];
	focused: boolean;
	onSelect: (node: RepoNode) => void;
}

interface FlatNode {
	node: RepoNode;
	depth: number;
	is_last: boolean;
}

function flattenTree(nodes: RepoNode[], depth: number = 0): FlatNode[] {
	return nodes.flatMap((node, i) => {
		const entry: FlatNode = { node, depth, is_last: i === nodes.length - 1 };
		if (node.type === "directory" && node.expanded && node.children.length > 0) {
			return [entry, ...flattenTree(node.children, depth + 1)];
		}
		return [entry];
	});
}

function connector(is_last: boolean): string {
	return is_last ? "└──" : "├──";
}

function icon(node: RepoNode): string {
	if (node.type === "directory") return node.expanded ? "▾ " : "▸ ";
	if (node.type === "worktree") return "⊞ ";
	return "  ";
}

export function RepoList(props: RepoListProps) {
	const [selectedIndex, setSelectedIndex] = createSignal(0);

	const visible = createMemo(() => flattenTree(props.repos));

	const clampIndex = (idx: number) => Math.max(0, Math.min(idx, visible().length - 1));

	createEffect(() => {
		const items = visible();
		if (items.length === 0) return;
		const idx = clampIndex(selectedIndex());
		if (idx !== selectedIndex()) setSelectedIndex(idx);
		const item = items[idx];
		if (item) props.onSelect(item.node);
	});

	useKeyboard((key) => {
		if (!props.focused) return;
		const items = visible();
		if (items.length === 0) return;

		switch (key.name) {
			case "j":
			case "down": {
				const next = clampIndex(selectedIndex() + 1);
				setSelectedIndex(next);
				const item = items[next];
				if (item) props.onSelect(item.node);
				break;
			}
			case "k":
			case "up": {
				const next = clampIndex(selectedIndex() - 1);
				setSelectedIndex(next);
				const item = items[next];
				if (item) props.onSelect(item.node);
				break;
			}
			case "g": {
				setSelectedIndex(0);
				const item = items[0];
				if (item) props.onSelect(item.node);
				break;
			}
			case "G": {
				const last = items.length - 1;
				setSelectedIndex(last);
				const item = items[last];
				if (item) props.onSelect(item.node);
				break;
			}
			case "return": {
				const item = items[selectedIndex()];
				if (item && item.node.type === "directory") {
					item.node.expanded = !item.node.expanded;
					setSelectedIndex(clampIndex(selectedIndex()));
				}
				break;
			}
		}
	});

	return (
		<box flexDirection="column" width="100%" height="100%">
			<For each={visible()}>
				{(entry, i) => {
					const selected = () => i() === selectedIndex();
					const indent = "  ".repeat(entry.depth);
					const conn = connector(entry.is_last);
					const prefix = icon(entry.node);
					const label = `${indent}${conn} ${prefix}${entry.node.name}`;

					return (
						<box
							flexDirection="row"
							width="100%"
							height={1}
							backgroundColor={selected() ? theme.selection : undefined}
						>
							<text fg={selected() ? theme.fg : theme.fg_dark} content={label} />
							<box flexGrow={1} />
							<StatusBadge status={entry.node.status} />
						</box>
					);
				}}
			</For>
		</box>
	);
}
