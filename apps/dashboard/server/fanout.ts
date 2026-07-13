import type { JobEvent } from "@job-queue/core";

export type Subscriber = (event: JobEvent) => void;

export function createFanout() {
  const subscribers = new Set<Subscriber>();

  return {
    subscribe(fn: Subscriber): () => void {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    broadcast(event: JobEvent): void {
      for (const fn of subscribers) {
        try {
          fn(event);
        } catch (err) {
          console.error("fanout: subscriber error", err);
        }
      }
    },
    get size() {
      return subscribers.size;
    },
  };
}

export type Fanout = ReturnType<typeof createFanout>;
