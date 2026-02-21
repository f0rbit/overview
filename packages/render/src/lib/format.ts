export function truncate(str: string, maxLen: number): string {
	if (str.length <= maxLen) return str;
	return str.slice(0, maxLen - 1) + "…";
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B";
	const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);
	const value = bytes / 1024 ** exp;
	const unit = BYTE_UNITS[exp]!;
	return value < 10 ? `${value.toFixed(1)} ${unit}` : `${Math.round(value)} ${unit}`;
}

export function padTo(str: string, len: number): string {
	if (str.length >= len) return str.slice(0, len);
	return str + " ".repeat(len - str.length);
}
