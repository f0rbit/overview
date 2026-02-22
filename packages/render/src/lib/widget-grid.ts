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
	columns: 1 | 2;
}

export interface GridLayout {
	rows: GridRow[];
	total_width: number;
}

// ── Span resolution ──

export function resolveSpan(span: WidgetSpan, panel_width: number): "full" | "half" {
	if (span === "half" && panel_width >= 40) return "half";
	return "full";
}

// ── Row computation ──

export function computeRows(widgets: GridWidget[], panel_width: number): GridRow[] {
	const enabled = widgets.filter((w) => w.config.enabled);

	const fulls: GridWidget[] = [];
	const halfs: GridWidget[] = [];

	for (const widget of enabled) {
		const effective = resolveSpan(widget.size_hint.span, panel_width);
		if (effective === "full") {
			fulls.push(widget);
		} else {
			halfs.push(widget);
		}
	}

	const rows: GridRow[] = [];

	for (const widget of fulls) {
		rows.push({ widgets: [widget], columns: 1 });
	}

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

function junctionChar(
	prev_row: GridRow | null,
	next_row: GridRow | null,
): string {
	const from_above = prev_row !== null && prev_row.columns === 2;
	const from_below = next_row !== null && next_row.columns === 2;

	if (from_above && from_below) return B.cross;
	if (from_above) return B.bottomT;
	if (from_below) return B.topT;
	return B.horizontal; // no junction needed
}

export function buildBorderLine(
	type: "top" | "mid" | "bottom",
	total_width: number,
	prev_row: GridRow | null,
	next_row: GridRow | null,
): string {
	if (total_width <= 0) return "";

	// Junction column is at the midpoint for 2-column rows
	const has_junction = (type === "top" && next_row?.columns === 2) ||
		(type === "bottom" && prev_row?.columns === 2) ||
		(type === "mid" && (prev_row?.columns === 2 || next_row?.columns === 2));
	const junction_col = has_junction ? Math.floor(total_width / 2) : -1;

	const chars: string[] = [];
	for (let col = 0; col < total_width; col++) {
		if (col === 0) {
			chars.push(cornerChar(type, "left"));
		} else if (col === total_width - 1) {
			chars.push(cornerChar(type, "right"));
		} else if (col === junction_col) {
			chars.push(junctionChar(
				type === "top" ? null : prev_row,
				type === "bottom" ? null : next_row,
			));
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
	// 2-column row
	if (widget_index === 0) {
		return ["left"]; // right border drawn by the right widget's left border
	}
	return ["left", "right"]; // left = shared divider, right = outer edge
}

// ── Content width calculation ──

export function contentWidth(span: WidgetSpan, panel_width: number): number {
	const resolved = resolveSpan(span, panel_width);
	if (resolved === "full") {
		// border={["left", "right"]} takes 2 chars
		return Math.max(1, panel_width - 2);
	}
	// Half-width right column is the smaller one:
	// outer width = panel_width - junction, borders take 2 chars
	const junction = Math.floor(panel_width / 2);
	return Math.max(1, panel_width - junction - 2);
}
