import os from "node:os";
import path from "node:path";

function configRoot(): string {
  if (process.platform === "win32") {
    return process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support");
  }
  return process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
}

export const configDir = path.join(configRoot(), "porlocal");
export const configFile = path.join(configDir, "config.json");
export const logsDir = path.join(configDir, "logs");
