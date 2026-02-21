export const theme = {
	// Base
	bg: "#1a1b26",
	bg_dark: "#16161e",
	bg_highlight: "#283457",
	fg: "#c0caf5",
	fg_dark: "#a9b1d6",
	fg_dim: "#565f89",

	// Accents
	blue: "#7aa2f7",
	cyan: "#7dcfff",
	green: "#9ece6a",
	yellow: "#e0af68",
	red: "#f7768e",
	magenta: "#bb9af7",
	orange: "#ff9e64",

	// UI
	border: "#3b4261",
	border_highlight: "#7aa2f7",
	selection: "#283457",
	comment: "#565f89",

	// Status colors
	status: {
		clean: "#9ece6a",
		ahead: "#e0af68",
		behind: "#7dcfff",
		modified: "#7aa2f7",
		conflict: "#f7768e",
		untracked: "#565f89",
		stash: "#bb9af7",
	},
} as const;

export type Theme = typeof theme;
