import { type Result, err, ok } from "@f0rbit/corpus";
import type { AIProvider, AIProviderConfig, ProviderError } from "./types";

export async function createProvider(cfg: AIProviderConfig): Promise<Result<AIProvider | null, ProviderError>> {
	if (cfg.provider === null) return ok(null);
	if (cfg.provider === "anthropic") {
		const mod = await import("./anthropic");
		return mod.createAnthropicProvider(cfg);
	}
	if (cfg.provider === "bedrock") {
		const mod = await import("./bedrock");
		return mod.createBedrockProvider(cfg);
	}
	return err({ kind: "not_configured" });
}
