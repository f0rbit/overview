import type { WidgetId, WidgetConfig, WidgetSizeRequest } from "@overview/core";

export interface WidgetAllocation {
	id: WidgetId;
	rows: number;
}

export function getEffectiveSizeRequest(
	config: WidgetConfig,
	base_request: WidgetSizeRequest,
): WidgetSizeRequest {
	if (config.collapsed) return { min_rows: 1, preferred_rows: 1, max_rows: 1 };
	return base_request;
}

export function allocateWidgets(
	available_rows: number,
	configs: WidgetConfig[],
	size_requests: Map<WidgetId, WidgetSizeRequest>,
): WidgetAllocation[] {
	const active = configs
		.filter((c) => c.enabled)
		.sort((a, b) => a.priority - b.priority)
		.filter((c) => size_requests.has(c.id));

	if (active.length === 0) return [];

	const effective = active.map((c) => ({
		config: c,
		request: getEffectiveSizeRequest(c, size_requests.get(c.id)!),
	}));

	const separator_rows = Math.max(0, active.length - 1);
	let remaining = available_rows - separator_rows;

	const allocations = new Map<WidgetId, number>();

	// Phase 1: minimum allocation
	for (const { config, request } of effective) {
		if (remaining < request.min_rows) break;
		allocations.set(config.id, request.min_rows);
		remaining -= request.min_rows;
	}

	// Phase 2: distribute surplus up to preferred
	for (const { config, request } of effective) {
		const current = allocations.get(config.id);
		if (current === undefined || remaining <= 0) continue;
		const extra = Math.min(request.preferred_rows - current, remaining);
		if (extra > 0) {
			allocations.set(config.id, current + extra);
			remaining -= extra;
		}
	}

	// Phase 3: overflow bonus up to max
	for (const { config, request } of effective) {
		const current = allocations.get(config.id);
		if (current === undefined || remaining <= 0) continue;
		const extra = Math.min(request.max_rows - current, remaining);
		if (extra > 0) {
			allocations.set(config.id, current + extra);
			remaining -= extra;
		}
	}

	return active
		.filter((c) => allocations.has(c.id))
		.map((c) => ({ id: c.id, rows: allocations.get(c.id)! }));
}
