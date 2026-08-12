import { useCallback, useEffect, useState } from "react";
import type { PortListener } from "@porlocal/core";
import { fetchPorts } from "../lib/porlocal-client";

const POLL_INTERVAL_MS = 5000;

/** Polls the system ports view — a live SSE feed is overkill for something only checked occasionally. */
export function usePortsSnapshot() {
  const [ports, setPorts] = useState<PortListener[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    fetchPorts()
      .then(setPorts)
      .catch(() => {
        // Daemon not reachable yet; keep the last known snapshot instead of clearing it.
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return { ports, loading, refresh };
}
