import type { Result } from "@f0rbit/corpus";
import type { RepoActivity } from "@overview/core";

export type { AIProviderConfig } from "@overview/core";

export interface SummarizeInput {
	range_label: string;
	activities: readonly RepoActivity[];
	style?: "concise" | "narrative";
}

export type ProviderError =
	| { kind: "not_configured" }
	| { kind: "auth_failed"; cause: string }
	| { kind: "rate_limited"; retry_after_seconds?: number }
	| { kind: "network_failed"; cause: string }
	| { kind: "api_failed"; status: number; cause: string };

export interface SummaryStream {
	chunks(): AsyncIterable<string>;
	final(): Promise<string>;
	abort(): void;
}

export interface AIProvider {
	id: "anthropic" | "bedrock" | "in-memory";
	summarize(input: SummarizeInput): Promise<Result<SummaryStream, ProviderError>>;
}
