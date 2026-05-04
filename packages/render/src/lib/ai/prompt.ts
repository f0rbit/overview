import type { SummarizeInput } from "./types";

export const DEFAULT_SYSTEM_PROMPT =
	"You are a concise multi-repo standup summariser. " +
	"Given activity sections grouped by repo, write a 3–5 sentence narrative summary " +
	"of what was accomplished. Highlight notable repos and themes. " +
	"Do not list individual commits — synthesize. Plain text only, no markdown.";

const ITEM_CAP_PER_SECTION = 8;

export function build_user_prompt(input: SummarizeInput): string {
	const lines: string[] = [];
	lines.push(`Activity window: ${input.range_label}`);
	lines.push("");

	const non_empty = input.activities.filter((a) => a.sections.length > 0);
	if (non_empty.length === 0) {
		lines.push("(no activity in this window)");
		return lines.join("\n");
	}

	for (const activity of non_empty) {
		lines.push(`## ${activity.repo_name}`);
		for (const section of activity.sections) {
			lines.push(`### ${section.source_label} (${section.summary_line})`);
			const item_count = Math.min(section.items.length, ITEM_CAP_PER_SECTION);
			for (let i = 0; i < item_count; i++) {
				const item = section.items[i]!;
				const meta_str = item.meta
					? "  " +
						Object.entries(item.meta)
							.map(([k, v]) => `[${k}=${v}]`)
							.join(" ")
					: "";
				const author = item.author ? ` — ${item.author}` : "";
				lines.push(`- ${item.title}${author}${meta_str}`);
			}
			if (section.items.length > item_count) {
				lines.push(`- (+${section.items.length - item_count} more)`);
			}
		}
		lines.push("");
	}

	lines.push(`Style: ${input.style ?? "narrative"}`);
	return lines.join("\n");
}
