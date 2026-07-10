export type BackoffOptions = {
  baseMs?: number;
  maxMs?: number;
  random?: () => number;
};

export function backoffMs(attempts: number, options: BackoffOptions = {}): number {
  const base = options.baseMs ?? 1000;
  const max = options.maxMs ?? 5 * 60 * 1000;
  const random = options.random ?? Math.random;
  const exponential = base * 2 ** attempts;
  const jitter = random() * base;
  return Math.min(exponential + jitter, max);
}
