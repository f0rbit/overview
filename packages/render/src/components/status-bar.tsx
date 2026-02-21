import { createMemo, Show } from "solid-js";
import { theme } from "../theme";

export type AppMode = "NORMAL" | "DETAIL" | "SEARCH" | "HELP";

interface StatusBarProps {
	mode: AppMode;
	repoCount: number;
	dirtyCount: number;
	aheadCount: number;
	scanning: boolean;
	message: string | null;
}

const KEY_HINTS: Record<AppMode, string> = {
	NORMAL: "j/k:nav  Enter:expand  g:ggi  r:refresh  q:quit  ?:help",
	DETAIL: "j/k:scroll  h/l:panel  g:ggi  r:refresh  q:back",
	SEARCH: "type to filter  Esc:cancel",
	HELP: "q:close",
};

export function StatusBar(props: StatusBarProps) {
	const keyHints = createMemo(() => KEY_HINTS[props.mode]);

	const summaryColor = createMemo(() => {
		if (props.scanning) return theme.fg_dim;
		if (props.dirtyCount === 0 && props.aheadCount === 0) return theme.green;
		return theme.yellow;
	});

	const summaryText = createMemo(() => {
		if (props.scanning) return "scanning...";
		if (props.dirtyCount === 0 && props.aheadCount === 0) {
			return `✓ all ${props.repoCount} repos clean`;
		}
		const parts: string[] = [];
		if (props.dirtyCount > 0) parts.push(`${props.dirtyCount} dirty`);
		if (props.aheadCount > 0) parts.push(`${props.aheadCount} ahead`);
		return parts.join(", ");
	});

	return (
		<box height={1} width="100%" backgroundColor={theme.bg_dark} flexDirection="row" paddingLeft={1} paddingRight={1}>
			<text fg={theme.blue}>[{props.mode}]</text>
			<Show when={props.message} fallback={<text fg={theme.fg_dim}> {keyHints()}</text>}>
				<text fg={theme.yellow}> {props.message}</text>
			</Show>
			<box flexGrow={1} />
			<text fg={summaryColor()}>{summaryText()}</text>
		</box>
	);
}
