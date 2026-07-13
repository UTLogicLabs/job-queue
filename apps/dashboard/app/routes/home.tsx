import { useEffect, useState } from "react";
import { getListener } from "../../server/listener.js";
import type { Snapshot } from "../../server/aggregates.js";

export async function loader() {
  const { aggregates } = await getListener();
  return aggregates.getSnapshot();
}

export default function Home({ loaderData }: { loaderData: Snapshot }) {
  const [snapshot, setSnapshot] = useState(loaderData);

  useEffect(() => {
    const source = new EventSource("/dashboard/events");
    source.onmessage = (e) => {
      const parsed = JSON.parse(e.data) as { snapshot: Snapshot };
      setSnapshot(parsed.snapshot);
    };
    return () => source.close();
  }, []);

  return (
    <main className="p-8 space-y-8">
      <h1 className="text-2xl font-semibold">job-queue dashboard</h1>

      <div className="flex gap-8">
        <div className="rounded border border-border p-4">
          <div className="text-sm text-muted-foreground">throughput/min</div>
          <div className="text-3xl font-semibold">{snapshot.throughputPerMin}</div>
        </div>
        <div className="rounded border border-border p-4">
          <div className="text-sm text-muted-foreground">failure rate</div>
          <div className="text-3xl font-semibold">{snapshot.failureRatePercent.toFixed(1)}%</div>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-medium mb-2">queue depth</h2>
        <table className="text-left">
          <thead>
            <tr className="text-sm text-muted-foreground">
              <th className="pr-8">queue</th>
              <th className="pr-8">status</th>
              <th>count</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.queueDepth.map(({ queue, status, count }) => (
              <tr key={`${queue}:${status}`}>
                <td className="pr-8">{queue}</td>
                <td className="pr-8">{status}</td>
                <td>{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        last reconciled: {new Date(snapshot.lastReconciledAt).toLocaleTimeString()}
      </p>
    </main>
  );
}
