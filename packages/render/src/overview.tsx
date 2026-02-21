import { render } from "@opentui/solid";
import { loadConfig, parseCliArgs, mergeCliArgs } from "./config";
import { MainScreen } from "./screens";

const configResult = await loadConfig();
if (!configResult.ok) {
	console.error("Failed to load config:", configResult.error);
	process.exit(1);
}

const cliArgs = parseCliArgs(Bun.argv);
const config = mergeCliArgs(configResult.value, cliArgs);

const App = () => <MainScreen config={config} />;

render(App);
