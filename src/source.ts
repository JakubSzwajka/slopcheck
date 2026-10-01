import { Lang, parse, type SgRoot } from "@ast-grep/napi";

export type Source = {
	path: string;
	text: string;
	root: SgRoot;
	code: Set<number>;
};

export function langFor(path: string): Lang {
	return path.endsWith(".tsx") ? Lang.Tsx : Lang.TypeScript;
}

export function parseSource(path: string, text: string): Source {
	const root = parse(langFor(path), text);
	return { path, text, root, code: codeLines(root, text) };
}

export function codeLines(root: SgRoot, text: string): Set<number> {
	const lines = text.split("\n");
	const masked = new Map<number, Array<[number, number]>>();
	const mask = (line: number, from: number, to: number) => {
		const list = masked.get(line) ?? [];
		list.push([from, to]);
		masked.set(line, list);
	};
	// Comment spans come from the tree, so strings and regexes that look like comments are not masked.
	for (const comment of root.root().findAll({ rule: { kind: "comment" } })) {
		const { start, end } = comment.range();
		if (start.line === end.line) {
			mask(start.line, start.column, end.column);
			continue;
		}
		mask(start.line, start.column, Number.POSITIVE_INFINITY);
		for (let line = start.line + 1; line < end.line; line++) mask(line, 0, Number.POSITIVE_INFINITY);
		mask(end.line, 0, end.column);
	}
	const code = new Set<number>();
	lines.forEach((line, index) => {
		if (hasCode(line, masked.get(index) ?? [])) code.add(index + 1);
	});
	return code;
}

function hasCode(line: string, masks: Array<[number, number]>): boolean {
	if (masks.length === 0) return /\S/.test(line);
	for (let column = 0; column < line.length; column++) {
		if (/\s/.test(line[column] ?? " ")) continue;
		if (!masks.some(([from, to]) => column >= from && column < to)) return true;
	}
	return false;
}

export function codeLinesIn(code: Set<number>, start: number, end: number): number {
	let count = 0;
	for (let line = start; line <= end; line++) if (code.has(line)) count++;
	return count;
}
