/**
 * Concurrency pool — limits the number of concurrent async operations.
 *
 * Use when spawning many parallel subprocesses (e.g., scanning 50+ repos at startup)
 * to avoid overwhelming the system.
 */
export function createPool(concurrency: number) {
	let active = 0;
	const queue: Array<() => void> = [];

	function release() {
		active--;
		const next = queue.shift();
		if (next) {
			active++;
			next();
		}
	}

	return {
		/** Run an async function within the concurrency limit */
		async run<T>(fn: () => Promise<T>): Promise<T> {
			if (active < concurrency) {
				active++;
				try {
					return await fn();
				} finally {
					release();
				}
			}
			return new Promise<T>((resolve, reject) => {
				queue.push(() => {
					fn().then(resolve, reject).finally(release);
				});
			});
		},

		/** Current number of active tasks */
		get active_count() { return active; },

		/** Current number of queued tasks */
		get queue_length() { return queue.length; },
	};
}
