import solidPlugin from "@opentui/solid/bun-plugin";

const result = await Bun.build({
	entrypoints: ["packages/render/src/overview.tsx"],
	outdir: "dist",
	target: "bun",
	format: "esm",
	external: ["@opentui/core", "@opentui/core/*"],
	plugins: [solidPlugin],
});

if (!result.success) {
	for (const log of result.logs) console.error(log);
	process.exit(1);
}

for (const output of result.outputs) {
	console.log(`  ${output.path} (${(output.size / 1024).toFixed(1)} KB)`);
}
