const tty = process.stdout.isTTY;

const ESC = '\x1b';
const paint = (code: number) => (s: string) => (tty ? `${ESC}[${code}m${s}${ESC}[0m` : s);

export const bold = paint(1);
export const dim = paint(2);
export const green = paint(32);
export const cyan = paint(36);
export const yellow = paint(33);

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
