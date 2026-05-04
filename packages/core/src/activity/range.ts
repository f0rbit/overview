import type { StandupRange } from "./types";

export function range_daily(now: Date): StandupRange {
	const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
	return { kind: "daily", since, until: now, label: "past 24h" };
}

export function range_weekly(now: Date): StandupRange {
	const d = new Date(now);
	d.setHours(0, 0, 0, 0);
	const dow = d.getDay();
	const days_back = (dow + 6) % 7;
	d.setDate(d.getDate() - days_back);
	const month_short = d.toLocaleString("en", { month: "short" });
	const weekday_short = d.toLocaleString("en", { weekday: "short" });
	return {
		kind: "weekly",
		since: d,
		until: now,
		label: `since ${weekday_short} ${month_short} ${d.getDate()}`,
	};
}

export function range_custom(since: Date, now: Date): StandupRange {
	return {
		kind: "custom",
		since,
		until: now,
		label: `since ${since.toISOString().slice(0, 10)}`,
	};
}
