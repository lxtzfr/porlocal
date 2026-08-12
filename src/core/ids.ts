import { randomUUID } from "node:crypto";

export function generateId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}
