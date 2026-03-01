/**
 * FetchContext — manages debounced, cancellable, deduplicated async operations.
 *
 * Use for any async work triggered by reactive signal changes where:
 * - Rapid changes should coalesce (debounce)
 * - Stale results should be discarded (cancellation via request ID)
 * - Multiple callers for the same key should share a single in-flight fetch (dedup)
 */

export interface FetchContext<T> {
	/** Current request ID — increments on each trigger/cancel */
	readonly request_id: number;
	/** Schedule a debounced fetch. Cancels any pending. Returns the new request ID. */
	trigger(fn: () => Promise<T>): number;
	/** Execute immediately, bypassing debounce. Cancels any pending. Returns the new request ID. */
	immediate(fn: () => Promise<T>): number;
	/** Cancel any pending debounce and increment request ID to invalidate in-flight results. */
	cancel(): void;
	/** Clean up timers. Call in onCleanup. */
	dispose(): void;
}

export function createFetchContext<T>(
	delay_ms: number,
	on_result: (value: T, request_id: number) => void,
): FetchContext<T> {
	let _request_id = 0;
	let _timer: ReturnType<typeof setTimeout> | undefined;

	function _run(fn: () => Promise<T>): number {
		const my_id = _request_id;
		fn().then((value) => {
			if (my_id === _request_id) {
				on_result(value, my_id);
			}
		});
		return my_id;
	}

	return {
		get request_id() { return _request_id; },

		trigger(fn) {
			clearTimeout(_timer);
			_request_id++;
			const id = _request_id;
			_timer = setTimeout(() => {
				if (id === _request_id) {
					_run(fn);
				}
			}, delay_ms);
			return _request_id;
		},

		immediate(fn) {
			clearTimeout(_timer);
			_request_id++;
			return _run(fn);
		},

		cancel() {
			clearTimeout(_timer);
			_request_id++;
		},

		dispose() {
			clearTimeout(_timer);
		},
	};
}

/**
 * InFlightDedup — prevents duplicate concurrent fetches for the same cache key.
 *
 * If a fetch for key K is already in-flight, subsequent callers await the existing
 * promise instead of starting a new one. Once complete, the in-flight entry is removed.
 */
export class InFlightDedup<T> {
	private _in_flight = new Map<string, Promise<T>>();

	/**
	 * Run `fn` for `key`, deduplicating against any in-flight fetch for the same key.
	 * Returns the result (either from the new fetch or the existing in-flight one).
	 */
	async run(key: string, fn: () => Promise<T>): Promise<T> {
		const existing = this._in_flight.get(key);
		if (existing) return existing;

		const promise = fn();
		this._in_flight.set(key, promise);
		try {
			return await promise;
		} finally {
			this._in_flight.delete(key);
		}
	}

	/** Check if a fetch is currently in-flight for the given key */
	has(key: string): boolean {
		return this._in_flight.has(key);
	}
}
