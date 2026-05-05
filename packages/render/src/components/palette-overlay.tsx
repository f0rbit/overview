import type { InputRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/solid";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { type CommandContext, type MatchResult, list_commands, match_commands, parse_input } from "../lib/palette";
import { theme } from "../theme";

interface PaletteOverlayProps {
	visible: boolean;
	ctx: CommandContext;
	onClose: () => void;
}

const ID_COL_WIDTH = 30;

function pad_or_truncate(str: string, width: number): string {
	if (str.length >= width) return `${str.slice(0, width - 1)}…`;
	return str.padEnd(width);
}

export function PaletteOverlay(props: PaletteOverlayProps) {
	const [query, setQuery] = createSignal("");
	const [selected_idx, setSelectedIdx] = createSignal(0);
	let input_ref: InputRenderable | undefined;

	const matches = createMemo<MatchResult[]>(() => {
		const q = query();
		return match_commands(q, list_commands());
	});

	createEffect(() => {
		matches();
		setSelectedIdx(0);
	});

	createEffect(() => {
		if (props.visible) {
			setQuery("");
			setSelectedIdx(0);
			queueMicrotask(() => input_ref?.focus());
		}
	});

	async function execute_selected() {
		const m = matches()[selected_idx()];
		if (!m) return;

		// The ":" prefix is rendered separately as a fixed glyph so the user
		// sees a clean input. We re-prepend it before parsing so command ids
		// (which include the ":") match correctly.
		const raw_input = `:${query()}`;
		const parsed = parse_input(raw_input);

		let args: unknown = undefined;
		if (parsed.ok && parsed.value.command_id === m.command.id) {
			args = parsed.value.args;
		}

		props.onClose();

		const result = await m.command.execute(args, props.ctx);
		if (!result.ok) {
			props.ctx.emit({
				kind: "command_failed",
				command_id: m.command.id,
				error: result.error,
			});
			return;
		}
		props.ctx.emit({ kind: "command_done", command_id: m.command.id });
	}

	useKeyboard((key) => {
		if (!props.visible) return;

		if (key.name === "escape") {
			props.onClose();
			return;
		}

		if (key.name === "down" || (key.ctrl && key.name === "n")) {
			const max_idx = Math.max(0, matches().length - 1);
			setSelectedIdx(Math.min(selected_idx() + 1, max_idx));
			return;
		}

		if (key.name === "up" || (key.ctrl && key.name === "p")) {
			setSelectedIdx(Math.max(selected_idx() - 1, 0));
			return;
		}

		if (key.name === "return") {
			void execute_selected();
			return;
		}
	});

	return (
		<Show when={props.visible}>
			<box
				position="absolute"
				width="60%"
				left="20%"
				top="20%"
				backgroundColor={theme.bg_dark}
				borderStyle="rounded"
				borderColor={theme.blue}
				title="Palette"
				titleAlignment="center"
				padding={1}
				flexDirection="column"
				gap={1}
				zIndex={110}
			>
				<box flexDirection="row" height={1}>
					<text content=":" fg={theme.blue} />
					<input ref={input_ref} focused={props.visible} value={query()} onInput={(v) => setQuery(v)} flexGrow={1} />
				</box>

				<box flexGrow={1} flexDirection="column">
					<Show when={matches().length > 0} fallback={<text content="(no matching commands)" fg={theme.fg_dim} />}>
						<scrollbox flexGrow={1}>
							<box flexDirection="column" flexShrink={0}>
								<For each={matches()}>
									{(m, i) => (
										<box
											flexDirection="row"
											height={1}
											backgroundColor={selected_idx() === i() ? theme.bg_highlight : undefined}
										>
											{/* TODO: highlight matched positions from m.positions */}
											<text content={pad_or_truncate(m.command.id, ID_COL_WIDTH)} fg={theme.yellow} />
											<text content={m.command.label} fg={theme.fg} flexGrow={1} />
											<text content={m.command.description} fg={theme.fg_dim} />
										</box>
									)}
								</For>
							</box>
						</scrollbox>
					</Show>
				</box>
			</box>
		</Show>
	);
}
