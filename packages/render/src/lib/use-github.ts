import { createSignal, createEffect, type Accessor } from "solid-js";
import { DataCache } from "@overview/core/cache";
import { collectGithubData, type GithubRepoData, type GithubError } from "@overview/core/github";
import { InFlightDedup } from "./fetch-context";

const cache = new DataCache<GithubRepoData>();
const dedup = new InFlightDedup<void>();

const GITHUB_CACHE_TTL = 120_000;

export function useGithub(
	repo_path: Accessor<string | null>,
	remote_url: Accessor<string | null>,
): {
	data: Accessor<GithubRepoData | null>;
	error: Accessor<GithubError | null>;
	loading: Accessor<boolean>;
	refresh: () => void;
} {
	const [data, setData] = createSignal<GithubRepoData | null>(null);
	const [error, setError] = createSignal<GithubError | null>(null);
	const [loading, setLoading] = createSignal(false);

	async function fetchData() {
		const path = repo_path();
		const url = remote_url();
		if (!path) {
			setData(null);
			setError(null);
			return;
		}

		const cached = cache.get(path);
		if (cached) {
			setData(cached);
			setError(null);
			return;
		}

		setLoading(true);

		// Deduplicate: if another widget instance is already fetching this path,
		// wait for it instead of starting a redundant fetch
		await dedup.run(path, async () => {
			const result = await collectGithubData(path, url);
			if (result.ok) {
				cache.set(path, result.value, GITHUB_CACHE_TTL);
			}
		});

		// Read result from cache (populated by whichever instance ran first)
		const fresh = cache.get(path);
		if (fresh) {
			setData(fresh);
			setError(null);
		} else {
			setData(null);
			setError(null);
		}
		setLoading(false);
	}

	createEffect(() => {
		repo_path();
		remote_url();
		fetchData();
	});

	return {
		data,
		error,
		loading,
		refresh: fetchData,
	};
}
