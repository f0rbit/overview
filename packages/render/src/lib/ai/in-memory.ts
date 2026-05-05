import { type Result, err, ok } from "@f0rbit/corpus";
import type { AIProvider, ProviderError, SummarizeInput, SummaryStream } from "./types";

const DEFAULT_RESPONSE =
	"This week you focused on three repos with steady progress. " +
	"Several small features and a couple of refactors landed. " +
	"No notable regressions.";

export interface InMemoryProviderOptions {
	response?: string;
	fail_with?: ProviderError;
	delay_ms?: number;
	chunk_size?: number;
}

export interface InMemoryProvider extends AIProvider {
	last_input: SummarizeInput | null;
	call_count: number;
}

export function createInMemoryProvider(opts: InMemoryProviderOptions = {}): InMemoryProvider {
	const response = opts.response ?? DEFAULT_RESPONSE;
	const delay_ms = opts.delay_ms ?? 0;
	const chunk_size = opts.chunk_size ?? 50;

	const provider: InMemoryProvider = {
		id: "in-memory",
		last_input: null,
		call_count: 0,
		summarize: async (input) => {
			provider.last_input = input;
			provider.call_count++;
			if (opts.fail_with) return err(opts.fail_with);
			return ok(make_stream(response, delay_ms, chunk_size));
		},
	};
	return provider;
}

function make_stream(text: string, delay_ms: number, chunk_size: number): SummaryStream {
	let aborted = false;

	async function* iterate(): AsyncGenerator<string> {
		for (let i = 0; i < text.length; i += chunk_size) {
			if (aborted) break;
			if (delay_ms > 0) await new Promise((r) => setTimeout(r, delay_ms));
			yield text.slice(i, i + chunk_size);
		}
	}

	let chunks_it: AsyncGenerator<string> | null = null;
	let final_promise: Promise<string> | null = null;

	return {
		chunks() {
			if (!chunks_it) chunks_it = iterate();
			return chunks_it;
		},
		async final() {
			if (final_promise) return final_promise;
			final_promise = (async () => {
				let acc = "";
				if (!chunks_it) chunks_it = iterate();
				for await (const c of chunks_it) acc += c;
				return acc;
			})();
			return final_promise;
		},
		abort() {
			aborted = true;
		},
	};
}
