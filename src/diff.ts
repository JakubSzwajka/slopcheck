/** Added line numbers (1-based, head side) per file, read from a `git diff -U0` hunk list. */
export function parseAddedLines(diff: string): Map<string, Set<number>> {
	const added = new Map<string, Set<number>>();
	let current: Set<number> | null = null;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+++ ")) {
			const target = line.slice(4).replace(/^"(.*)"$/, "$1");
			current = target === "/dev/null" ? null : ensure(added, target.replace(/^b\//, ""));
			continue;
		}
		const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
		if (hunk && current) {
			const start = Number(hunk[1]);
			const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
			for (let offset = 0; offset < count; offset++) current.add(start + offset);
		}
	}
	return added;
}

/** Every line of a new file counts as added. */
export function allLines(text: string): Set<number> {
	const count = text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
	return new Set(Array.from({ length: count }, (_, index) => index + 1));
}

function ensure(map: Map<string, Set<number>>, key: string): Set<number> {
	const existing = map.get(key);
	if (existing) return existing;
	const created = new Set<number>();
	map.set(key, created);
	return created;
}
