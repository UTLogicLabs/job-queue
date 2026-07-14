export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  if (typeof err !== "object" || err === null) return false;
  const pgErr = err as { code?: string; constraint?: string };
  if (pgErr.code !== "23505") return false;
  return constraint === undefined || pgErr.constraint === constraint;
}

export class DuplicateCompletionError extends Error {
  readonly jobId: string;

  constructor(jobId: string) {
    super(`Job ${jobId} was already completed by another worker`);
    this.name = "DuplicateCompletionError";
    this.jobId = jobId;
  }
}
