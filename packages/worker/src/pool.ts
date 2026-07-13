// Bounded-concurrency executor — not a single Promise.all over the whole claimed batch,
// so one slow job doesn't stall an otherwise-idle worker slot (docs/ARCHITECTURE.md).
export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const item = items[index++];
      await fn(item);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}
