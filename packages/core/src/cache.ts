export interface CacheEntry<T> {
	data: T;
	fetched_at: number;
	ttl_ms: number;
}

export class DataCache<T> {
	private entries = new Map<string, CacheEntry<T>>();

	get(key: string): T | null {
		const entry = this.entries.get(key);
		if (!entry) return null;
		if (Date.now() - entry.fetched_at > entry.ttl_ms) {
			this.entries.delete(key);
			return null;
		}
		return entry.data;
	}

	set(key: string, data: T, ttl_ms: number): void {
		this.entries.set(key, { data, fetched_at: Date.now(), ttl_ms });
	}

	invalidate(key: string): void {
		this.entries.delete(key);
	}

	clear(): void {
		this.entries.clear();
	}
}
