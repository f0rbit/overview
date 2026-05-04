import { describe, test, expect, afterEach } from "bun:test";
import { ok } from "@f0rbit/corpus";
import {
	register_activity_source,
	get_activity_source,
	list_activity_sources,
	_clear_activity_registry_for_tests,
} from "../registry";
import type { ActivitySource } from "../types";

afterEach(() => {
	_clear_activity_registry_for_tests();
});

describe("activity registry", () => {
	test("register_activity_source stores a source", () => {
		const fake_source: ActivitySource = {
			id: "fake",
			label: "Fake Source",
			collect: async () => ok(null),
		};

		register_activity_source(fake_source);
		const retrieved = get_activity_source("fake");
		expect(retrieved).toBeDefined();
		expect(retrieved?.id).toBe("fake");
	});

	test("get_activity_source returns undefined for unknown id", () => {
		const result = get_activity_source("nonexistent");
		expect(result).toBeUndefined();
	});

	test("list_activity_sources includes registered sources", () => {
		const source1: ActivitySource = {
			id: "src1",
			label: "Source 1",
			collect: async () => ok(null),
		};
		const source2: ActivitySource = {
			id: "src2",
			label: "Source 2",
			collect: async () => ok(null),
		};

		register_activity_source(source1);
		register_activity_source(source2);

		const list = list_activity_sources();
		expect(list).toHaveLength(2);
		expect(list.map((s) => s.id)).toContain("src1");
		expect(list.map((s) => s.id)).toContain("src2");
	});

	test("re-registering with same id replaces the source", () => {
		const source1: ActivitySource = {
			id: "test",
			label: "Version 1",
			collect: async () => ok(null),
		};
		const source2: ActivitySource = {
			id: "test",
			label: "Version 2",
			collect: async () => ok(null),
		};

		register_activity_source(source1);
		expect(get_activity_source("test")?.label).toBe("Version 1");

		register_activity_source(source2);
		expect(get_activity_source("test")?.label).toBe("Version 2");
	});

	test("_clear_activity_registry_for_tests empties the registry", () => {
		const source: ActivitySource = {
			id: "temp",
			label: "Temp",
			collect: async () => ok(null),
		};

		register_activity_source(source);
		expect(list_activity_sources()).toHaveLength(1);

		_clear_activity_registry_for_tests();
		expect(list_activity_sources()).toHaveLength(0);
	});
});
