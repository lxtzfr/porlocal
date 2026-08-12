import fs from "node:fs";
import path from "node:path";
import { logsDir } from "./paths.js";

const MAX_BUFFER_LINES = 2000;
const buffers = new Map<string, string[]>();

function filePathFor(serverId: string): string {
  return path.join(logsDir, `${serverId}.log`);
}

export function appendLog(serverId: string, chunk: string): void {
  const lines = chunk.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return;

  const buffer = buffers.get(serverId) ?? [];
  buffer.push(...lines);
  if (buffer.length > MAX_BUFFER_LINES) buffer.splice(0, buffer.length - MAX_BUFFER_LINES);
  buffers.set(serverId, buffer);

  fs.mkdirSync(logsDir, { recursive: true });
  fs.appendFileSync(filePathFor(serverId), lines.map((line) => `${line}\n`).join(""));
}

/** In-memory buffer first; falls back to the log file when the daemon just restarted. */
export function tailLogs(serverId: string, count = 100): string[] {
  const buffer = buffers.get(serverId);
  if (buffer) return buffer.slice(-count);
  try {
    const content = fs.readFileSync(filePathFor(serverId), "utf-8");
    return content.split(/\r?\n/).filter((line) => line.length > 0).slice(-count);
  } catch {
    return [];
  }
}
