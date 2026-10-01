export type Progress = { phase(label: string): void; stop(): void };

export type SpinnerStream = { write(text: string): unknown; columns?: number };

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL_MS = 80;
const CLEAR_LINE = "\r\x1b[2K";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";

export const silentProgress: Progress = { phase() {}, stop() {} };

export function progressFor(stream: NodeJS.WriteStream): Progress {
  return stream.isTTY ? spinner(stream) : silentProgress;
}

export function spinner(
  stream: SpinnerStream,
  now: () => number = () => performance.now(),
): Progress {
  const start = now();
  let label = "";
  let frame = 0;
  let active = true;
  const draw = () => {
    const seconds = ((now() - start) / 1000).toFixed(1);
    const line = `${FRAMES[frame++ % FRAMES.length]} ${label}  ${seconds}s`;
    // A pty with no size reports 0 columns; draw the whole line then.
    const width = stream.columns ? stream.columns - 1 : Number.POSITIVE_INFINITY;
    // A line wider than the terminal wraps, and \r would then clear only its tail.
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
  // Stopping on exit too means Ctrl-C and errors leave the cursor visible and the line clear.
  process.on("exit", stop);
  return {
    phase(next) {
      label = next;
      if (active) draw();
    },
    stop,
  };
}
