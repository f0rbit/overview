import { BorderChars, type BorderSides } from "@opentui/core";
import type { WidgetId, WidgetSpan, WidgetSizeHint, WidgetConfig } from "@overview/core";

const B = BorderChars.rounded;

// ── Types ──

export interface GridWidget {
	id: WidgetId;
	size_hint: WidgetSizeHint;
	config: WidgetConfig;
}

export interface GridRow {
	widgets: GridWidget[];
	columns: 1 | 2 | 3;
}

export interface GridLayout {
	rows: GridRow[];
	total_width: number;
}

// ── Span resolution ──

export function resolveSpan(span: WidgetSpan, panel_width: number): "full" | "half" | "third" {
	if (span === "third") {
		if (panel_width >= 60) return "third";
		if (panel_width >= 40) return "half";
		return "full";
	}
	if (span === "half" && panel_width >= 40) return "half";
	return "full";
}

// ── Row computation ──

export function computeRows(widgets: GridWidget[], panel_width: number): GridRow[] {
	const enabled = widgets.filter((w) => w.config.enabled);

	const fulls: GridWidget[] = [];
	const halfs: GridWidget[] = [];
	const thirds: GridWidget[] = [];

	for (const widget of enabled) {
		const effective = resolveSpan(widget.size_hint.span, panel_width);
		if (effective === "full") {
			fulls.push(widget);
		} else if (effective === "half") {
			halfs.push(widget);
		} else {
			thirds.push(widget);
		}
	}

	const rows: GridRow[] = [];

	for (const widget of fulls) {
		rows.push({ widgets: [widget], columns: 1 });
	}

	// Group thirds into rows of 3; leftovers auto-expand
	for (let i = 0; i < thirds.length; i += 3) {
		if (i + 2 < thirds.length) {
			rows.push({ widgets: [thirds[i]!, thirds[i + 1]!, thirds[i + 2]!], columns: 3 });
		} else if (i + 1 < thirds.length) {
			// 2 leftover thirds → auto-expand to 2-column row
			rows.push({ widgets: [thirds[i]!, thirds[i + 1]!], columns: 2 });
		} else {
			// 1 leftover third → auto-expand to 1-column row
			rows.push({ widgets: [thirds[i]!], columns: 1 });
		}
	}

	// Group halfs into rows of 2; leftover auto-expands
	for (let i = 0; i < halfs.length; i += 2) {
		if (i + 1 < halfs.length) {
			rows.push({ widgets: [halfs[i]!, halfs[i + 1]!], columns: 2 });
		} else {
			rows.push({ widgets: [halfs[i]!], columns: 1 });
		}
	}

	rows.sort((a, b) => {
		const min_a = Math.min(...a.widgets.map((w) => w.config.priority));
		const min_b = Math.min(...b.widgets.map((w) => w.config.priority));
		return min_a - min_b;
	});

	return rows;
}

// ── Full grid layout computation ──

export function computeGridLayout(widgets: GridWidget[], panel_width: number): GridLayout {
	return {
		rows: computeRows(widgets, panel_width),
		total_width: panel_width,
	};
}

// ── Horizontal border line generation ──

function cornerChar(type: "top" | "mid" | "bottom", side: "left" | "right"): string {
	if (type === "top") return side === "left" ? B.topLeft : B.topRight;
	if (type === "bottom") return side === "left" ? B.bottomLeft : B.bottomRight;
	return side === "left" ? B.leftT : B.rightT;
}

function junctionColumns(row: GridRow | null, total_width: number): Set<number> {
	if (!row) return new Set();
	if (row.columns === 2) return new Set([Math.floor(total_width / 2)]);
	if (row.columns === 3) return new Set([Math.floor(total_width / 3), Math.floor(2 * total_width / 3)]);
	return new Set();
}

function junctionChar(
	type: "top" | "mid" | "bottom",
	in_prev: boolean,
	in_next: boolean,
): string {
	if (type === "top") return B.topT;      // junction only from below
	if (type === "bottom") return B.bottomT; // junction only from above

	// mid: check both directions
	if (in_prev && in_next) return B.cross;
	if (in_prev) return B.bottomT;
	if (in_next) return B.topT;
	return B.horizontal;
}

export function buildBorderLine(
	type: "top" | "mid" | "bottom",
	total_width: number,
	prev_row: GridRow | null,
	next_row: GridRow | null,
): string {
	if (total_width <= 0) return "";

	const prev_junctions = junctionColumns(type === "top" ? null : prev_row, total_width);
	const next_junctions = junctionColumns(type === "bottom" ? null : next_row, total_width);
	const all_junctions = new Set([...prev_junctions, ...next_junctions]);

	const chars: string[] = [];
	for (let col = 0; col < total_width; col++) {
		if (col === 0) {
			chars.push(cornerChar(type, "left"));
		} else if (col === total_width - 1) {
			chars.push(cornerChar(type, "right"));
		} else if (all_junctions.has(col)) {
			chars.push(junctionChar(type, prev_junctions.has(col), next_junctions.has(col)));
		} else {
			chars.push(B.horizontal);
		}
	}

	return chars.join("");
}

// ── Title insertion into border line ──

export function buildBorderLineWithTitle(line: string, title: string): string {
	if (title.length === 0 || line.length < 4) return line;
	const title_str = ` ${title} `;
	if (title_str.length >= line.length - 2) {
		// Title too long — truncate
		const available = line.length - 4; // leave corners + 1 char each side
		if (available <= 0) return line;
		const truncated = ` ${title.slice(0, available - 1)}… `;
		return line.slice(0, 1) + truncated + line.slice(1 + truncated.length);
	}
	return line.slice(0, 1) + title_str + line.slice(1 + title_str.length);
}

// ── Widget border sides ──

export function getWidgetBorderSides(row: GridRow, widget_index: number): BorderSides[] {
	if (row.columns === 1) {
		return ["left", "right"];
	}
	// Multi-column row: last widget gets both sides, others get left only
	if (widget_index === row.columns - 1) {
		return ["left", "right"];
	}
	return ["left"];
}

// ── Content width calculation ──

export function contentWidth(span: WidgetSpan, panel_width: number): number {
	const resolved = resolveSpan(span, panel_width);
	if (resolved === "full") {
		// border={["left", "right"]} takes 2 chars
		return Math.max(1, panel_width - 2);
	}
	if (resolved === "third") {
		// First column width minus left border (1 char)
		const first_junction = Math.floor(panel_width / 3);
		return Math.max(1, first_junction - 1);
	}
	// Half: right column width minus 2 border chars
	const junction = Math.floor(panel_width / 2);
	return Math.max(1, panel_width - junction - 2);
}
