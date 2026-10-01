/** Reports which phase of the run is going on. */
export type Progress = { phase(label: string): void; stop(): void };

export type SpinnerStream = { write(text: string): unknown; columns?: number };

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL_MS = 80;
const CLEAR_LINE = "\r\x1b[2K";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";

export const silentProgress: Progress = { phase() {}, stop() {} };

/** A spinner on stderr when it is a terminal, otherwise nothing at all. */
export function progressFor(stream: NodeJS.WriteStream): Progress {
	return stream.isTTY ? spinner(stream) : silentProgress;
}

/**
 * One self-redrawing status line: `⠋ phase  3.2s`. `stop` clears the line and
 * restores the cursor; it also runs on process exit, so Ctrl-C and errors leave
 * the terminal clean.
 */
export function spinner(stream: SpinnerStream, now: () => number = () => performance.now()): Progress {
	const start = now();
	let label = "";
	let frame = 0;
	let active = true;
	const draw = () => {
		const seconds = ((now() - start) / 1000).toFixed(1);
		const line = `${FRAMES[frame++ % FRAMES.length]} ${label}  ${seconds}s`;
		// A line wider than the terminal wraps, and \r would then clear only its tail.
		// A pty with no size reports 0 columns; draw the whole line then.
		const width = stream.columns ? stream.columns - 1 : Number.POSITIVE_INFINITY;
		stream.write(`${CLEAR_LINE}${[...line].slice(0, width).join("")}`);
	};
	const stop = () => {
		if (!active) return;
		active = false;
		clearInterval(timer);
		process.off("exit", stop);
		stream.write(`${CLEAR_LINE}${SHOW_CURSOR}`);
	};
	stream.write(HIDE_CURSOR);
	const timer = setInterval(draw, INTERVAL_MS);
	timer.unref();
	process.on("exit", stop);
	return {
		phase(next) {
			label = next;
			if (active) draw();
		},
		stop,
	};
}
