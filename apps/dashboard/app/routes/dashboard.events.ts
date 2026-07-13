import type { LoaderFunctionArgs } from "react-router";
import type { JobEvent } from "@job-queue/core";
import { getListener } from "../../server/listener.js";
import type { Snapshot } from "../../server/aggregates.js";

const KEEPALIVE_INTERVAL_MS = 15_000;

type SseMessage = { event?: JobEvent; snapshot: Snapshot };

export async function loader({ request }: LoaderFunctionArgs) {
  const { fanout, aggregates } = await getListener();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (message: SseMessage) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`));
      };

      const unsubscribe = fanout.subscribe((event) => {
        send({ event, snapshot: aggregates.getSnapshot() });
      });

      send({ snapshot: aggregates.getSnapshot() });

      const keepalive = setInterval(() => {
        controller.enqueue(encoder.encode(`: keepalive\n\n`));
      }, KEEPALIVE_INTERVAL_MS);

      request.signal.addEventListener("abort", () => {
        clearInterval(keepalive);
        unsubscribe();
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
