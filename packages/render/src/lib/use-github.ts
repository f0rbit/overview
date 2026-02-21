import { createSignal, createEffect, type Accessor } from "solid-js";
import { DataCache } from "@overview/core/cache";
import { collectGithubData, type GithubRepoData, type GithubError } from "@overview/core/github";

const cache = new DataCache<GithubRepoData>();

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
		const result = await collectGithubData(path, url);
		setLoading(false);

		if (result.ok) {
			cache.set(path, result.value, GITHUB_CACHE_TTL);
			setData(result.value);
			setError(null);
		} else {
			setData(null);
			setError(result.error);
		}
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
