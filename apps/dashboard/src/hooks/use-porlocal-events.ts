import { useEffect, useRef, useState } from "react";
import { PORLOCAL_API_BASE, type ProjectConfig, type ServerState } from "../lib/porlocal-client";

interface LogEvent {
  serverId: string;
  line: string;
}

interface Snapshot {
  projects: ProjectConfig[];
  states: ServerState[];
}

/** Single SSE connection to the daemon, fanning out state snapshots and per-server log lines. */
export function usePorlocalEvents() {
  const [connected, setConnected] = useState(false);
  const [projects, setProjects] = useState<ProjectConfig[]>([]);
  const [states, setStates] = useState<Record<string, ServerState>>({});
  const logListeners = useRef(new Map<string, Set<(line: string) => void>>());

  useEffect(() => {
    const source = new EventSource(`${PORLOCAL_API_BASE}/events`);

    source.addEventListener("open", () => setConnected(true));
    source.addEventListener("error", () => setConnected(false));

    source.addEventListener("snapshot", (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as Snapshot;
      setProjects(data.projects);
      setStates(Object.fromEntries(data.states.map((state) => [state.serverId, state])));
    });

    source.addEventListener("state", (event) => {
      const state = JSON.parse((event as MessageEvent<string>).data) as ServerState;
      setStates((prev) => ({ ...prev, [state.serverId]: state }));
    });

    source.addEventListener("log", (event) => {
      const entry = JSON.parse((event as MessageEvent<string>).data) as LogEvent;
      logListeners.current.get(entry.serverId)?.forEach((listener) => listener(entry.line));
    });

    return () => source.close();
  }, []);

  function subscribeLogs(serverId: string, listener: (line: string) => void): () => void {
    const listeners = logListeners.current.get(serverId) ?? new Set();
    listeners.add(listener);
    logListeners.current.set(serverId, listeners);
    return () => listeners.delete(listener);
  }

  return { connected, projects, states, subscribeLogs };
}
