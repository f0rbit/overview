import { ok, err, try_catch_async, format_error, type Result } from "@f0rbit/corpus";
import type { default as Anthropic } from "@anthropic-ai/sdk";
import type {
	AIProvider,
	AIProviderConfig,
	ProviderError,
	SummarizeInput,
	SummaryStream,
} from "./types";
import { build_user_prompt, DEFAULT_SYSTEM_PROMPT } from "./prompt";

type AnthropicClient = InstanceType<typeof Anthropic>;
type SdkStream = ReturnType<AnthropicClient["messages"]["stream"]>;

const DEFAULT_MAX_TOKENS = 2048;

export async function createAnthropicProvider(
	cfg: AIProviderConfig,
): Promise<Result<AIProvider, ProviderError>> {
	const env_var = cfg.api_key_env ?? "ANTHROPIC_API_KEY";
	const api_key = process.env[env_var];
	if (!api_key) {
		return err({ kind: "auth_failed", cause: `${env_var} not set` });
	}

	const { default: AnthropicCtor } = await import("@anthropic-ai/sdk");
	const client = new AnthropicCtor({ apiKey: api_key });

	return ok({
		id: "anthropic",
		summarize: (input) => summarize_impl(client, cfg, input),
	});
}

async function summarize_impl(
	client: AnthropicClient,
	cfg: AIProviderConfig,
	input: SummarizeInput,
): Promise<Result<SummaryStream, ProviderError>> {
	const stream_result = await try_catch_async(
		async () =>
			client.messages.stream({
				model: cfg.model,
				max_tokens: cfg.max_tokens ?? DEFAULT_MAX_TOKENS,
				system: DEFAULT_SYSTEM_PROMPT,
				messages: [{ role: "user", content: build_user_prompt(input) }],
			}),
		classify_error,
	);

	if (!stream_result.ok) return err(stream_result.error);
	return ok(adapt_stream(stream_result.value));
}

function adapt_stream(sdk_stream: SdkStream): SummaryStream {
	let final_promise: Promise<string> | null = null;
	let aborted = false;

	return {
		async *chunks(): AsyncGenerator<string> {
			for await (const event of sdk_stream) {
				if (aborted) break;
				if (
					event.type === "content_block_delta" &&
					event.delta.type === "text_delta"
				) {
					yield event.delta.text;
				}
			}
		},
		final(): Promise<string> {
			if (final_promise) return final_promise;
			final_promise = sdk_stream.finalMessage().then((msg) =>
				msg.content
					.filter(
						(b): b is Extract<typeof b, { type: "text" }> => b.type === "text",
					)
					.map((b) => b.text)
					.join(""),
			);
			return final_promise;
		},
		abort(): void {
			aborted = true;
			sdk_stream.abort();
		},
	};
}

function classify_error(e: unknown): ProviderError {
	const status = read_status(e);
	const message = read_message(e);

	if (status === 401) {
		return { kind: "auth_failed", cause: message };
	}
	if (status === 429) {
		const retry = parse_retry_after(e);
		return retry !== null
			? { kind: "rate_limited", retry_after_seconds: retry }
			: { kind: "rate_limited" };
	}
	if (typeof status === "number") {
		return { kind: "api_failed", status, cause: message };
	}
	return { kind: "network_failed", cause: format_error(e) };
}

function read_status(e: unknown): number | undefined {
	if (typeof e !== "object" || e === null) return undefined;
	const status = (e as { status?: unknown }).status;
	return typeof status === "number" ? status : undefined;
}

function read_message(e: unknown): string {
	if (e instanceof Error) return e.message;
	return format_error(e);
}

function parse_retry_after(e: unknown): number | null {
	if (typeof e !== "object" || e === null) return null;
	const headers = (e as { headers?: unknown }).headers;
	if (!headers || typeof headers !== "object") return null;
	const raw = (headers as Record<string, unknown>)["retry-after"];
	if (typeof raw !== "string") return null;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
