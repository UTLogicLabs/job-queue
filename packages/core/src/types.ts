export type JobStatus = "pending" | "processing" | "completed" | "failed" | "dead";

export type Job = {
  id: string;
  type: string;
  queue: string;
  priority: number;
  payload: unknown;
  payloadHash: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  lockedBy: string | null;
  lockedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  completedAt: Date | null;
};

export type EnqueueOptions = {
  queue?: string;
  priority?: number;
  runAt?: Date;
  maxAttempts?: number;
};

export type EnqueueResult = {
  job: Job;
  deduped: boolean;
};
