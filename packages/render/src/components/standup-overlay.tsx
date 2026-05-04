import { Show, For, createSignal, createEffect, onCleanup } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import type { ActivityItem, RepoActivity, StandupRange } from "@overview/core";
import type { AIProvider, SummaryStream } from "../lib/ai";
import { theme } from "../theme";

export interface StandupOverlayPayload {
	window: StandupRange;
	activities: readonly RepoActivity[];
}

interface StandupOverlayProps {
	visible: boolean;
	payload: StandupOverlayPayload | null;
	ai_provider: AIProvider | null;
	onClose: () => void;
}

type AIState = "idle" | "streaming" | "done" | "error";

type FocusSection = "summary" | "ai" | "raw";

const FOCUS_ORDER: readonly FocusSection[] = ["summary", "ai", "raw"];

function formatted_line(item: ActivityItem): string {
	const meta_str = item.meta
		? "  " + Object.entries(item.meta).map(([k, v]) => `[${k}=${v}]`).join(" ")
		: "";
	const author = item.author ? ` — ${item.author}` : "";
	return `${item.id}  ${item.title}${author}${meta_str}`;
}

function cycle_focus(current: FocusSection, direction: 1 | -1): FocusSection {
	const idx = FOCUS_ORDER.indexOf(current);
	const next = (idx + direction + FOCUS_ORDER.length) % FOCUS_ORDER.length;
	return FOCUS_ORDER[next]!;
}

function SectionHeader(props: {
	id: FocusSection;
	open: boolean;
	label: string;
	focused: boolean;
}) {
	return (
		<text
			content={`${props.open ? "▾" : "▸"} ${props.label}`}
			fg={props.focused ? theme.yellow : theme.fg_dim}
		/>
	);
}

export function StandupOverlay(props: StandupOverlayProps) {
	const [summary_open, setSummaryOpen] = createSignal(true);
	const [ai_open, setAiOpen] = createSignal(false);
	const [raw_open, setRawOpen] = createSignal(false);
	const [focus_section, setFocusSection] = createSignal<FocusSection>("summary");
	const [ai_text, setAiText] = createSignal<string>("");
	const [ai_state, setAiState] = createSignal<AIState>("idle");
	const [ai_error, setAiError] = createSignal<string | null>(null);

	let current_stream: SummaryStream | null = null;

	createEffect(() => {
		if (!props.visible || !props.payload || !props.ai_provider) {
			if (current_stream) {
				current_stream.abort();
				current_stream = null;
			}
			return;
		}

		const provider = props.ai_provider;
		const payload = props.payload;

		setAiText("");
		setAiError(null);
		setAiState("streaming");

		void (async () => {
			const result = await provider.summarize({
				range_label: payload.window.label,
				activities: payload.activities,
				style: "narrative",
			});
			if (!result.ok) {
				setAiState("error");
				const cause = "cause" in result.error ? result.error.cause : "";
				setAiError(`${result.error.kind}${cause ? `: ${cause}` : ""}`);
				return;
			}
			current_stream = result.value;
			try {
				for await (const chunk of result.value.chunks()) {
					setAiText((prev) => prev + chunk);
				}
				setAiState("done");
			} catch (e) {
				setAiState("error");
				setAiError(`stream_failed: ${String(e)}`);
			} finally {
				current_stream = null;
			}
		})();
	});

	onCleanup(() => {
		if (current_stream) current_stream.abort();
	});

	function toggle_focused() {
		const f = focus_section();
		if (f === "summary") setSummaryOpen(!summary_open());
		else if (f === "ai") setAiOpen(!ai_open());
		else setRawOpen(!raw_open());
	}

	useKeyboard((key) => {
		if (!props.visible) return;

		if (key.name === "q" || key.name === "escape") {
			props.onClose();
			return;
		}

		if (key.name === "down" || key.name === "j") {
			setFocusSection(cycle_focus(focus_section(), 1));
			return;
		}

		if (key.name === "up" || key.name === "k") {
			setFocusSection(cycle_focus(focus_section(), -1));
			return;
		}

		if (key.name === "return") {
			toggle_focused();
			return;
		}
	});

	return (
		<Show when={props.visible && props.payload !== null}>
			<box
				position="absolute"
				width="80%"
				height="85%"
				left="10%"
				top="7%"
				backgroundColor={theme.bg_dark}
				borderStyle="rounded"
				borderColor={theme.blue}
				title="Standup"
				titleAlignment="center"
				padding={1}
				flexDirection="column"
				gap={1}
				zIndex={110}
			>
				<text
					content={`Standup — ${props.payload!.window.label}`}
					fg={theme.blue}
				/>

				<box flexDirection="column">
					<SectionHeader
						id="summary"
						open={summary_open()}
						label="Summary"
						focused={focus_section() === "summary"}
					/>
					<Show when={summary_open()}>
						<box flexDirection="column">
							<Show
								when={
									props.payload!.activities.some((a) => a.sections.length > 0)
								}
								fallback={
									<text content="(no activity in window)" fg={theme.fg_dim} />
								}
							>
								<For each={props.payload!.activities.filter((a) => a.sections.length > 0)}>
									{(activity) => (
										<box flexDirection="column">
											<text content={"  " + activity.repo_name} fg={theme.fg_dim} />
											<For each={activity.sections}>
												{(section) => (
													<text
														content={"    " + section.source_label + "  " + section.summary_line}
														fg={theme.fg}
													/>
												)}
											</For>
										</box>
									)}
								</For>
							</Show>
						</box>
					</Show>
				</box>

				<box flexDirection="column">
					<SectionHeader
						id="ai"
						open={ai_open()}
						label="AI Summary"
						focused={focus_section() === "ai"}
					/>
					<Show when={ai_open()}>
						<box flexDirection="column">
							<Show when={props.ai_provider === null}>
								<text
									content="(AI provider not configured — set ai_provider in ~/.config/overview/config.json)"
									fg={theme.fg_dim}
								/>
							</Show>
							<Show when={props.ai_provider !== null && ai_state() === "streaming" && ai_text() === ""}>
								<text content="thinking..." fg={theme.fg_dim} />
							</Show>
							<Show when={props.ai_provider !== null && (ai_state() === "streaming" || ai_state() === "done") && ai_text() !== ""}>
								<For each={ai_text().split("\n")}>
									{(line) => <text content={line} fg={theme.fg} />}
								</For>
							</Show>
							<Show when={props.ai_provider !== null && ai_state() === "error"}>
								<text content={`AI summary failed: ${ai_error()}`} fg={theme.red} />
							</Show>
						</box>
					</Show>
				</box>

				<box flexDirection="column" flexGrow={1}>
					<SectionHeader
						id="raw"
						open={raw_open()}
						label="Raw"
						focused={focus_section() === "raw"}
					/>
					<Show when={raw_open()}>
						<scrollbox flexGrow={1}>
							<box flexDirection="column" flexShrink={0}>
								<For each={props.payload!.activities.filter((a) => a.sections.length > 0)}>
									{(activity) => (
										<box flexDirection="column">
											<text content={`## ${activity.repo_name}`} fg={theme.yellow} />
											<For each={activity.sections}>
												{(section) => (
													<box flexDirection="column">
														<text content={`### ${section.source_label}`} fg={theme.blue} />
														<For each={section.items}>
															{(item) => (
																<text content={" " + formatted_line(item)} fg={theme.fg} />
															)}
														</For>
													</box>
												)}
											</For>
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
