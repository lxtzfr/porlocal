import fs from "node:fs";
import path from "node:path";
import { configDir, configFile, logsDir } from "./paths.js";
import type { PorlocalConfig } from "./types.js";

const defaultConfig: PorlocalConfig = {
  version: 1,
  apiPort: 7737,
  healthIntervalSeconds: 10,
  maxRestartAttempts: 5,
  projects: [],
};

export function ensureConfigDirs(): void {
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
}

export function loadConfig(): PorlocalConfig {
  ensureConfigDirs();
  if (!fs.existsSync(configFile)) {
    saveConfig(defaultConfig);
    return defaultConfig;
  }
  const raw = fs.readFileSync(configFile, "utf-8");
  return { ...defaultConfig, ...(JSON.parse(raw) as Partial<PorlocalConfig>) };
}

export function saveConfig(config: PorlocalConfig): void {
  ensureConfigDirs();
  const tmpFile = path.join(configDir, ".config.json.tmp");
  fs.writeFileSync(tmpFile, JSON.stringify(config, null, 2));
  fs.renameSync(tmpFile, configFile);
}
