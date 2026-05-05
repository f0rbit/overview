import { describe, expect, test } from "bun:test";
import { createProvider } from "../dispatcher";

describe("createProvider", () => {
	test("provider: null returns ok(null) without loading SDK", async () => {
		const result = await createProvider({ provider: null, model: "x" });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe(null);
		}
	});

	test("provider: anthropic without API key returns auth_failed", async () => {
		const original = process.env.ANTHROPIC_API_KEY;
		delete process.env.ANTHROPIC_API_KEY;
		try {
			const result = await createProvider({
				provider: "anthropic",
				model: "claude-opus-4-7",
			});
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("auth_failed");
			}
		} finally {
			if (original) {
				process.env.ANTHROPIC_API_KEY = original;
			}
		}
	});

	test("provider: invalid provider name returns not_configured", async () => {
		const result = await createProvider({
			provider: "invalid-provider" as any,
			model: "x",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("not_configured");
		}
	});
});
