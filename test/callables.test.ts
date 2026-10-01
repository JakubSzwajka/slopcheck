import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractCallables } from "../src/callables.ts";
import { parseSource } from "../src/source.ts";

function callables(code: string, path = "file.ts") {
	return extractCallables(parseSource(path, code));
}

function ccOf(body: string): number {
	const [callable] = callables(`function f(a, b, c, xs, o) {\n${body}\n}\n`);
	assert.ok(callable);
	return callable.cc;
}

describe("cyclomatic complexity", () => {
	const cases: Array<[string, string, number]> = [
		["straight line", "return a;", 1],
		["if", "if (a) b();", 2],
		["if / else if / else", "if (a) b(); else if (c) d(); else e();", 3],
		["for", "for (let i = 0; i < 3; i++) b();", 2],
		["for-in", "for (const k in o) b(k);", 2],
		["for-of", "for (const x of xs) b(x);", 2],
		["while", "while (a) b();", 2],
		["do-while", "do { b(); } while (a);", 2],
		["switch counts cases, not default", "switch (a) { case 1: b(); break; case 2: case 3: c(); break; default: d(); }", 4],
		["catch", "try { a(); } catch (e) { b(e); }", 2],
		["try without catch", "try { a(); } finally { b(); }", 1],
		["ternary", "return a ? b : c;", 2],
		["&&", "return a && b;", 2],
		["||", "return a || b;", 2],
		["??", "return a ?? b;", 2],
		["other binary operators do not count", "return a + b * c === 3;", 1],
		["optional chaining does not count", "return o?.a?.b;", 1],
		["conditional type does not count", "type T<X> = X extends string ? 1 : 2; return a;", 1],
	];
	for (const [label, body, expected] of cases) {
		it(label, () => assert.equal(ccOf(body), expected));
	}

	it("does not count branches of a nested callable toward the outer one", () => {
		const found = callables(`function outer(a) {
	if (a) run();
	const inner = (b) => {
		if (b) return 1;
		return b ? 2 : 3;
	};
	items.forEach((x) => x && use(x));
	return inner;
}`);
		const byKey = new Map(found.map((callable) => [callable.key, callable.cc]));
		assert.equal(byKey.get("outer"), 2);
		assert.equal(byKey.get("outer.inner"), 3);
		assert.equal(byKey.get("outer.<forEach cb>"), 2);
	});

	it("parses TSX", () => {
		const [component] = callables("export function Card({ open }: Props) {\n  return <div>{open ? <b /> : null}</div>;\n}\n", "card.tsx");
		assert.equal(component?.key, "Card");
		assert.equal(component?.cc, 2);
	});
});

describe("SLOC", () => {
	it("ignores blank lines and comment-only lines, keeps lines with code and a trailing comment", () => {
		const [callable] = callables(`function f(a) {
	// a line comment

	/* a block comment
	   over two lines */
	const b = a + 1; // trailing comment
	/** doc */ const c = b;

	return c;
}`);
		assert.equal(callable?.sloc, 5);
	});

	it("does not treat a string that looks like a comment as a comment", () => {
		const [callable] = callables('function f() {\n\tconst url = "http://example.com";\n\treturn url;\n}');
		assert.equal(callable?.sloc, 4);
	});

	it("computes mass as CC * sqrt(SLOC)", () => {
		const [callable] = callables("function f(a) {\n\tif (a) return 1;\n\treturn 2;\n}");
		assert.equal(callable?.cc, 2);
		assert.equal(callable?.sloc, 4);
		assert.equal(callable?.mass, 4);
	});
});

describe("qualified names", () => {
	it("names classes, accessors, constructors, object methods and bindings", () => {
		const keys = callables(`
class Box {
	constructor() {}
	get size() { return 1; }
	set size(v) {}
	static create() {}
	#secret() {}
	handler = () => {};
}
const api = { load() {}, save: async () => {}, nested: { deep() {} } };
function outer() { function inner() {} return inner; }
const expr = function () {};
this.onClick = function () {};
export default function () {}
`).map((callable) => callable.key);
		assert.deepEqual(keys, [
			"Box.constructor",
			"Box.get size",
			"Box.set size",
			"Box.create",
			"Box.#secret",
			"Box.handler",
			"api.load",
			"api.save",
			"api.nested.deep",
			"outer",
			"outer.inner",
			"expr",
			"this.onClick",
			"default",
		]);
	});

	it("gives anonymous callables a stable key from their call and first string argument", () => {
		const keys = callables(`
describe("parser", () => {
	it("reads a file", () => {});
	it("reads a file", () => {});
	list.map((x) => x.id);
});
setTimeout(function () {}, 10);
`).map((callable) => callable.key);
		assert.deepEqual(keys, [
			'<describe("parser") cb>',
			'<describe("parser") cb>.<it("reads a file") cb>',
			'<describe("parser") cb>.<it("reads a file") cb>#2',
			'<describe("parser") cb>.<map cb>',
			"<setTimeout cb>",
		]);
	});
});
