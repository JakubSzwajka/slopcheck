import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spinner } from "../src/progress.ts";

function fakeTerminal(columns = 80) {
	const chunks: string[] = [];
	return { chunks, stream: { columns, write: (text: string) => chunks.push(text) } };
}

describe("spinner", () => {
	it("hides the cursor, draws the phase with elapsed seconds, then clears the line and restores the cursor", () => {
		let clock = 0;
		const { chunks, stream } = fakeTerminal();
		const progress = spinner(stream, () => clock);
		clock = 2500;
		progress.phase("scanning clones");
		progress.stop();
		assert.deepEqual(chunks, ["\x1b[?25l", "\r\x1b[2K⠋ scanning clones  2.5s", "\r\x1b[2K\x1b[?25h"]);
	});

	it("writes nothing after stop, and stop twice is harmless", () => {
		const { chunks, stream } = fakeTerminal();
		const progress = spinner(stream);
		progress.stop();
		progress.stop();
		progress.phase("late");
		assert.equal(chunks.length, 2);
	});

	it("cuts a line wider than the terminal so it cannot wrap", () => {
		const { chunks, stream } = fakeTerminal(20);
		const progress = spinner(stream);
		progress.phase("base and head snapshots (whole repo)");
		progress.stop();
		const drawn = (chunks[1] ?? "").replace("\r\x1b[2K", "");
		assert.equal([...drawn].length, 19);
	});

	it("draws the whole line when the terminal reports no width", () => {
		const { chunks, stream } = fakeTerminal(0);
		const progress = spinner(stream, () => 0);
		progress.phase("scanning clones");
		progress.stop();
		assert.equal(chunks[1], "\r\x1b[2K\u280b scanning clones  0.0s");
	});

	it("animates on its own timer", async () => {
		const { chunks, stream } = fakeTerminal();
		const progress = spinner(stream);
		progress.phase("parsing");
		await new Promise((resolve) => setTimeout(resolve, 200));
		progress.stop();
		const frames = new Set(chunks.filter((chunk) => chunk.includes("parsing")).map((chunk) => chunk.charAt(5)));
		assert.ok(frames.size >= 2, `expected several frames, got ${[...frames].join("")}`);
	});
});
