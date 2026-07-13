export type JobHandler = (payload: unknown) => Promise<void>;

export type HandlerRegistry = {
  register(type: string, handler: JobHandler): void;
  get(type: string): JobHandler | undefined;
};

export function createHandlerRegistry(): HandlerRegistry {
  const handlers = new Map<string, JobHandler>();
  return {
    register(type, handler) {
      handlers.set(type, handler);
    },
    get(type) {
      return handlers.get(type);
    },
  };
}
