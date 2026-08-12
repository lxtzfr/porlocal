import { useEffect, useRef, useState } from "react";
import { Code, Drawer, ScrollArea } from "@mantine/core";
import { fetchLogs } from "../lib/porlocal-client";

interface LogsDrawerProps {
  serverId: string | null;
  serverLabel: string;
  onClose: () => void;
  subscribeLogs: (serverId: string, listener: (line: string) => void) => () => void;
}

export function LogsDrawer({ serverId, serverLabel, onClose, subscribeLogs }: LogsDrawerProps) {
  const [lines, setLines] = useState<string[]>([]);
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!serverId) return;
    let cancelled = false;
    setLines([]);
    fetchLogs(serverId).then((data) => {
      if (!cancelled) setLines(data.lines);
    });
    const unsubscribe = subscribeLogs(serverId, (line) => {
      setLines((prev) => [...prev.slice(-999), line]);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [serverId, subscribeLogs]);

  useEffect(() => {
    viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight });
  }, [lines]);

  return (
    <Drawer opened={serverId !== null} onClose={onClose} title={serverLabel} position="right" size="lg">
      <ScrollArea h="calc(100vh - 80px)" viewportRef={viewportRef}>
        <Code block>{lines.join("\n") || "No output yet."}</Code>
      </ScrollArea>
    </Drawer>
  );
}
