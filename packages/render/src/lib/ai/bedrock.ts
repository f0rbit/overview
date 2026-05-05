import { type Result, err, format_error, ok, try_catch, try_catch_async } from "@f0rbit/corpus";
import { DEFAULT_SYSTEM_PROMPT, build_user_prompt } from "./prompt";
import type { AIProvider, AIProviderConfig, ProviderError, SummarizeInput, SummaryStream } from "./types";

type BedrockModule = typeof import("@aws-sdk/client-bedrock-runtime");
type BedrockClient = InstanceType<BedrockModule["BedrockRuntimeClient"]>;
type ResponseStreamEvent = import("@aws-sdk/client-bedrock-runtime").ResponseStream;

const DEFAULT_REGION = "us-east-1";
const DEFAULT_MAX_TOKENS = 2048;
const ANTHROPIC_BEDROCK_VERSION = "bedrock-2023-05-31";

export async function createBedrockProvider(cfg: AIProviderConfig): Promise<Result<AIProvider, ProviderError>> {
	if (cfg.aws_profile && !process.env.AWS_PROFILE) {
		process.env.AWS_PROFILE = cfg.aws_profile;
	}

	const sdk_result = await try_catch_async(
		() => import("@aws-sdk/client-bedrock-runtime"),
		(e): ProviderError => ({
			kind: "network_failed",
			cause: `failed to load @aws-sdk/client-bedrock-runtime: ${format_error(e)}`,
		}),
	);
	if (!sdk_result.ok) return err(sdk_result.error);

	const sdk = sdk_result.value;
	const client = new sdk.BedrockRuntimeClient({
		region: cfg.aws_region ?? DEFAULT_REGION,
	});

	return ok({
		id: "bedrock",
		summarize: (input) => summarize_impl(client, sdk, cfg, input),
	});
}

async function summarize_impl(
	client: BedrockClient,
	sdk: BedrockModule,
	cfg: AIProviderConfig,
	input: SummarizeInput,
): Promise<Result<SummaryStream, ProviderError>> {
	const body = {
		anthropic_version: ANTHROPIC_BEDROCK_VERSION,
		max_tokens: cfg.max_tokens ?? DEFAULT_MAX_TOKENS,
		system: DEFAULT_SYSTEM_PROMPT,
		messages: [{ role: "user", content: build_user_prompt(input) }],
	};

	const command = new sdk.InvokeModelWithResponseStreamCommand({
		modelId: cfg.model,
		contentType: "application/json",
		accept: "application/json",
		body: new TextEncoder().encode(JSON.stringify(body)),
	});

	const send_result = await try_catch_async(
		() => client.send(command),
		(e) => map_aws_error(e),
	);
	if (!send_result.ok) return err(send_result.error);

	const response_body = send_result.value.body;
	if (!response_body) {
		return err({
			kind: "api_failed",
			status: 0,
			cause: "Bedrock response body was empty",
		});
	}

	return ok(adapt_stream(response_body));
}

function map_aws_error(e: unknown): ProviderError {
	const name = (e as { name?: string } | null)?.name;
	const message = (e as { message?: string } | null)?.message ?? format_error(e);
	const status = (e as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;

	if (name === "ExpiredTokenException" || name === "UnrecognizedClientException") {
		return {
			kind: "auth_failed",
			cause: `${message} (try re-running aws sso login)`,
		};
	}
	if (name === "AccessDeniedException") {
		return { kind: "auth_failed", cause: message };
	}
	if (name === "ThrottlingException") {
		return { kind: "rate_limited" };
	}
	if (typeof status === "number") {
		return { kind: "api_failed", status, cause: message };
	}
	return { kind: "network_failed", cause: format_error(e) };
}

function adapt_stream(response_body: AsyncIterable<ResponseStreamEvent>): SummaryStream {
	let aborted = false;
	let collected = "";

	async function* iterate(): AsyncGenerator<string> {
		const decoder = new TextDecoder();
		for await (const event of response_body) {
			if (aborted) break;
			const bytes = (event as { chunk?: { bytes?: Uint8Array } }).chunk?.bytes;
			if (!bytes) continue;
			const text = decoder.decode(bytes);
			const parsed = parse_chunk_text(text);
			if (parsed === null) continue;
			collected += parsed;
			yield parsed;
		}
	}

	let chunks_iterator: AsyncGenerator<string> | null = null;
	let final_promise: Promise<string> | null = null;

	return {
		chunks() {
			if (!chunks_iterator) chunks_iterator = iterate();
			return chunks_iterator;
		},
		async final() {
			if (final_promise) return final_promise;
			final_promise = (async () => {
				if (!chunks_iterator) chunks_iterator = iterate();
				for await (const _ of chunks_iterator) {
					/* accumulate via closure */
				}
				return collected;
			})();
			return final_promise;
		},
		abort() {
			aborted = true;
		},
	};
}

function parse_chunk_text(text: string): string | null {
	const decoded = try_parse_json(text);
	if (decoded === null) return null;
	if (
		decoded.type === "content_block_delta" &&
		decoded.delta?.type === "text_delta" &&
		typeof decoded.delta.text === "string"
	) {
		return decoded.delta.text;
	}
	return null;
}

interface BedrockChunkPayload {
	type?: string;
	delta?: { type?: string; text?: string };
}

function try_parse_json(text: string): BedrockChunkPayload | null {
	const result = try_catch(
		() => JSON.parse(text) as BedrockChunkPayload,
		() => null,
	);
	return result.ok ? result.value : null;
}
