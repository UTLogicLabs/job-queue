import { Client, type ClientConfig } from "pg";
import type { JobStatus } from "./types.js";

export type JobEvent = {
  id: string;
  type: string;
  queue: string;
  status: JobStatus;
  from: JobStatus | null;
};

export function createListenerClient(config: ClientConfig = {}): Client {
  return new Client({
    connectionString: process.env.DATABASE_URL,
    ...config,
  });
}

export function parseJobEvent(payload: string): JobEvent {
  const raw = JSON.parse(payload) as Record<string, unknown>;
  if (
    typeof raw.id !== "string" ||
    typeof raw.type !== "string" ||
    typeof raw.queue !== "string" ||
    typeof raw.status !== "string"
  ) {
    throw new Error(`job_events payload missing required fields: ${payload}`);
  }
  return {
    id: raw.id,
    type: raw.type,
    queue: raw.queue,
    status: raw.status as JobStatus,
    from: typeof raw.from === "string" ? (raw.from as JobStatus) : null,
  };
}
