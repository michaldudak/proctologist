export function toBoolean(value: number): boolean {
	return value === 1;
}

export function fromBoolean(value: boolean): number {
	return value ? 1 : 0;
}

export function toJson(value: unknown): string {
	return JSON.stringify(value);
}

export function fromJson<T>(value: string | null, fallback: T): T {
	if (value === null) {
		return fallback;
	}
	return JSON.parse(value) as T;
}
