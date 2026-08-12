import fs from "node:fs";
import path from "node:path";

const MARKER_START = "<!-- porlocal:managed-rule:start -->";
const MARKER_END = "<!-- porlocal:managed-rule:end -->";

const RULE_BODY = `## Development servers

- Always use Porlocal (\`porlocal ...\`) to start, stop, restart, or inspect local development servers — never launch one directly in a terminal, in the background, or through another supervisor.
- Start with \`porlocal status\`. Use \`--json\` only when you need machine-readable fields.
- Register a project/server once with \`porlocal add-project\`/\`porlocal add-server\` (check \`porlocal status\` first — don't create a duplicate). Use \`porlocal detect <path>\` to find the likely dev command instead of guessing.
- If a configured server's port is already held by something else, use \`porlocal take-over <project/server>\` instead of picking a different port.
- \`porlocal kill-port\`/\`take-over\` require confirmation and must never be run against something you haven't verified with \`porlocal port <n>\` first.`;

const RULE_BLOCK = `${MARKER_START}\n${RULE_BODY}\n${MARKER_END}`;

export interface UpsertResult {
  created: boolean;
  updated: boolean;
}

/** Idempotently inserts or refreshes the managed rule block, leaving the rest of the file untouched. */
export function upsertAgentRule(filePath: string): UpsertResult {
  const exists = fs.existsSync(filePath);
  const existing = exists ? fs.readFileSync(filePath, "utf-8") : "";
  const startIdx = existing.indexOf(MARKER_START);
  const endIdx = existing.indexOf(MARKER_END);

  if (startIdx !== -1 && endIdx !== -1) {
    const before = existing.slice(0, startIdx);
    const after = existing.slice(endIdx + MARKER_END.length);
    const next = `${before}${RULE_BLOCK}${after}`;
    if (next === existing) return { created: false, updated: false };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, next);
    return { created: false, updated: true };
  }

  const needsSeparator = existing.length > 0 && !existing.endsWith("\n");
  const needsBlankLine = existing.length > 0 && !existing.endsWith("\n\n");
  const separator = existing.length === 0 ? "" : needsSeparator ? "\n\n" : needsBlankLine ? "\n" : "";
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${existing}${separator}${RULE_BLOCK}\n`);
  return { created: !exists, updated: exists };
}
