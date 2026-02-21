import { render, useKeyboard } from "@opentui/solid";

const App = () => {
	useKeyboard((key) => {
		if (key.name === "q" || key.name === "escape") {
			process.exit(0);
		}
	});

	return (
		<box
			flexDirection="column"
			width="100%"
			height="100%"
		>
			<box
				borderStyle="rounded"
				borderColor="#3b4261"
				title="overview"
				titleAlignment="center"
				padding={1}
				flexGrow={1}
			>
				<text fg="#7aa2f7">overview — git health dashboard</text>
				<text fg="#565f89">press q to quit</text>
			</box>
		</box>
	);
};

render(App);
