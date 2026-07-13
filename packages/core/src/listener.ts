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

const JOB_STATUSES: readonly JobStatus[] = [
  "pending",
  "processing",
  "completed",
  "failed",
  "dead",
];

function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === "string" && (JOB_STATUSES as readonly string[]).includes(value);
}

export function parseJobEvent(payload: string): JobEvent {
  const raw = JSON.parse(payload) as Record<string, unknown>;
  if (
    typeof raw.id !== "string" ||
    typeof raw.type !== "string" ||
    typeof raw.queue !== "string" ||
    !isJobStatus(raw.status) ||
    (raw.from !== null && raw.from !== undefined && !isJobStatus(raw.from))
  ) {
    throw new Error(`job_events payload has missing or invalid fields: ${payload}`);
  }
  return {
    id: raw.id,
    type: raw.type,
    queue: raw.queue,
    status: raw.status,
    from: isJobStatus(raw.from) ? raw.from : null,
  };
}
