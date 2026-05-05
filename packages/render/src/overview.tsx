import { render } from "@opentui/solid";
import { load_plugins } from "@overview/core";
import { loadConfig, mergeCliArgs, parseCliArgs } from "./config";
import { MainScreen } from "./screens";

const configResult = await loadConfig();
if (!configResult.ok) {
	console.error("Failed to load config:", configResult.error);
	process.exit(1);
}

const cliArgs = parseCliArgs(Bun.argv);
const config = mergeCliArgs(configResult.value, cliArgs);

const plugin_errors = await load_plugins(config.plugins ?? []);
for (const e of plugin_errors) {
	console.error(`[plugin ${e.package_name}] ${e.kind}: ${"cause" in e ? e.cause : ""}`);
}

const App = () => <MainScreen config={config} />;

render(App);
