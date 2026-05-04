import { describe, test, expect } from "bun:test";
import { load_plugins } from "../plugins";

describe("load_plugins", () => {
	test("returns import_failed for non-existent package", async () => {
		const errors = await load_plugins(["definitely-not-a-real-package-xyz-123"]);
		expect(errors).toHaveLength(1);
		const err = errors[0];
		expect(err).toBeDefined();
		if (err) {
			expect(err.kind).toBe("import_failed");
			expect(err.package_name).toBe(
				"definitely-not-a-real-package-xyz-123",
			);
		}
	});

	test("returns empty errors for empty input", async () => {
		const errors = await load_plugins([]);
		expect(errors).toHaveLength(0);
	});
});
