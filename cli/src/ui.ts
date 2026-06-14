const tty = process.stdout.isTTY;

const ESC = '\x1b';
const paint = (code: number) => (s: string) => (tty ? `${ESC}[${code}m${s}${ESC}[0m` : s);

export const bold = paint(1);
export const dim = paint(2);
export const green = paint(32);
export const cyan = paint(36);
export const yellow = paint(33);

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * A braille-dot spinner for a pending step. On a TTY it animates in place and
 * `stop()` wipes the line; otherwise it prints `text` once and `stop()` is a
 * no-op — so piped/CI output stays clean and line-based.
 */
export function spinner(text: string): { stop: () => void } {
  if (!tty) {
    process.stdout.write(`  ${text}\n`);
    return { stop() {} };
  }
  let i = 0;
  const render = () =>
    process.stdout.write(`\r${cyan(SPINNER_FRAMES[i++ % SPINNER_FRAMES.length]!)} ${text}`);
  // Hide the cursor while spinning; 'exit' restores it even on ctrl-c, since we
  // add no SIGINT handler that would suppress Node's default termination.
  const showCursor = () => process.stdout.write(`${ESC}[?25h`);
  process.stdout.write(`${ESC}[?25l`);
  process.once('exit', showCursor);
  render();
  const timer = setInterval(render, 80);
  return {
    stop() {
      clearInterval(timer);
      process.removeListener('exit', showCursor);
      process.stdout.write(`\r${ESC}[2K${ESC}[?25h`); // wipe line, restore cursor
    },
  };
}

export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}
