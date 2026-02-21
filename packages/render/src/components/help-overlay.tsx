import { Show, For } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { theme } from "../theme";

interface HelpOverlayProps {
	visible: boolean;
	onClose: () => void;
}

const SECTIONS = [
	{
		title: "Navigation",
		items: [
			{ key: "j / ↓", desc: "Move down" },
			{ key: "k / ↑", desc: "Move up" },
			{ key: "g", desc: "First repo" },
			{ key: "G", desc: "Last repo" },
			{ key: "Enter", desc: "Expand/collapse or enter detail mode" },
		],
	},
	{
		title: "Actions",
		items: [
			{ key: "g (in detail)", desc: "Launch ggi" },
			{ key: "o", desc: "Open in $EDITOR" },
			{ key: "t", desc: "Open tmux session" },
			{ key: "r", desc: "Refresh selected repo" },
			{ key: "R", desc: "Full rescan" },
		],
	},
	{
		title: "View",
		items: [
			{ key: "h / l", desc: "Switch panel focus" },
			{ key: "Tab", desc: "Cycle panel focus" },
			{ key: "f", desc: "Cycle filter (all/dirty/clean/ahead/behind)" },
			{ key: "s", desc: "Cycle sort (name/status/last-commit)" },
			{ key: "/", desc: "Search repos" },
		],
	},
	{
		title: "Widgets (stats panel focused)",
		items: [
			{ key: "j / k", desc: "Navigate between widgets" },
			{ key: "c", desc: "Collapse/expand focused widget" },
			{ key: "C", desc: "Collapse/expand all widgets" },
		],
	},
	{
		title: "General",
		items: [
			{ key: "q", desc: "Quit / back" },
			{ key: "?", desc: "Toggle help" },
			{ key: "Esc", desc: "Cancel / close" },
		],
	},
] as const;

function Section(props: { title: string; items: ReadonlyArray<{ key: string; desc: string }> }) {
	return (
		<box flexDirection="column">
			<text fg={theme.yellow} content={props.title} />
			<For each={props.items}>
				{(item) => (
					<box flexDirection="row" height={1}>
					<text fg={theme.blue} content={item.key.padEnd(16)} />
					<text fg={theme.fg} content={item.desc} />
					</box>
				)}
			</For>
		</box>
	);
}

export function HelpOverlay(props: HelpOverlayProps) {
	useKeyboard((key) => {
		if (!props.visible) return;

		if (key.name === "q" || key.name === "escape" || key.raw === "?") {
			props.onClose();
		}
	});

	return (
		<Show when={props.visible}>
			<box
				position="absolute"
				width="60%"
				height="80%"
				left="20%"
				top="10%"
				backgroundColor={theme.bg_dark}
				borderStyle="rounded"
				borderColor={theme.blue}
				title="Help"
				titleAlignment="center"
				padding={2}
				flexDirection="column"
				gap={1}
				zIndex={100}
			>
				<For each={SECTIONS}>
					{(section) => <Section title={section.title} items={section.items} />}
				</For>
			</box>
		</Show>
	);
}
