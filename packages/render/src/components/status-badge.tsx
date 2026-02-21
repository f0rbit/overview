import type { RepoStatus } from "@overview/core";
import { theme } from "../theme";

interface StatusBadgeProps {
	status: RepoStatus | null;
}

interface BadgePart {
	text: string;
	color: string;
}

function buildBadgeParts(status: RepoStatus): BadgePart[] {
	const parts: BadgePart[] = [];

	if (status.health === "conflict") {
		parts.push({ text: "!", color: theme.status.conflict });
	} else if (status.health === "clean" && status.modified_count === 0 && status.untracked_count === 0) {
		parts.push({ text: "✓", color: theme.status.clean });
	} else {
		if (status.modified_count > 0) {
			parts.push({ text: `~${status.modified_count}`, color: theme.status.modified });
		}

		if (status.untracked_count > 0 && status.modified_count === 0 && status.ahead === 0 && status.behind === 0) {
			parts.push({ text: "?", color: theme.status.untracked });
		}

		if (status.ahead > 0) {
			parts.push({ text: `↑${status.ahead}`, color: theme.status.ahead });
		}

		if (status.behind > 0) {
			parts.push({ text: `↓${status.behind}`, color: theme.status.behind });
		}
	}

	if (status.stash_count > 0) {
		parts.push({ text: "✂", color: theme.status.stash });
	}

	return parts;
}

export function StatusBadge(props: StatusBadgeProps) {
	const parts = () => {
		const s = props.status;
		if (!s) return [{ text: "…", color: theme.fg_dim }] as BadgePart[];
		return buildBadgeParts(s);
	};

	return (
		<text>
			{parts().map((p) => (
				<text fg={p.color}>{p.text}</text>
			))}
		</text>
	);
}
