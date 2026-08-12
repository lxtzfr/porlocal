import fs from "node:fs";
import path from "node:path";

export interface ServerSuggestion {
  name: string;
  command: string;
  port: number | null;
  directory: string | null;
  source: string;
}

const FRAMEWORK_PORTS: Record<string, number> = {
  astro: 4321,
  "@remix-run/dev": 3000,
  next: 3000,
  nuxt: 3000,
  "@sveltejs/kit": 5173,
  vite: 5173,
  expo: 8081,
  "@angular/cli": 4200,
  "react-scripts": 3000,
  convex: 3210,
};

const LOCKFILE_RUNNERS: Array<[string, string]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["bun.lockb", "bun run"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm run"],
];

const PREFERRED_SCRIPTS = ["dev", "start", "serve", "develop", "watch"];

/** Reads a project folder and guesses the dev servers it can run. Best-effort only. */
export function detectSuggestions(root: string): ServerSuggestion[] {
  if (!fs.existsSync(root)) return [];
  return detectNode(root, root);
}

function detectNode(dir: string, base: string): ServerSuggestion[] {
  const packageJsonPath = path.join(dir, "package.json");
  if (!fs.existsSync(packageJsonPath)) return [];

  const json = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const scripts = json.scripts ?? {};
  if (Object.keys(scripts).length === 0) return [];

  const runner = detectRunner(dir);
  const deps = new Set([
    ...Object.keys(json.dependencies ?? {}),
    ...Object.keys(json.devDependencies ?? {}),
  ]);
  const relative = path.relative(base, dir) || null;
  const label = relative ? `${relative}/package.json` : "package.json";

  return scriptNamesToTry(Object.keys(scripts)).map((key) => {
    const script = scripts[key] ?? "";
    const port = portFromScript(script) ?? frameworkPort(deps, script);
    return {
      name: relative ? path.basename(relative) : key,
      command: `${runner} ${key}`,
      port: port ?? null,
      directory: relative,
      source: label,
    };
  });
}

function scriptNamesToTry(keys: string[]): string[] {
  const all = new Set(keys);
  const ordered = PREFERRED_SCRIPTS.filter((name) => all.has(name));
  const namespaced = [...all]
    .filter((k) => k.startsWith("dev:") || k.startsWith("start:") || k.startsWith("serve:"))
    .sort();
  return [...ordered, ...namespaced].slice(0, 8);
}

function detectRunner(dir: string): string {
  for (const [file, runner] of LOCKFILE_RUNNERS) {
    if (fs.existsSync(path.join(dir, file))) return runner;
  }
  return "npm run";
}

function portFromScript(script: string): number | null {
  const patterns = [/--port[= ]+(\d{2,5})/, /(?:^|\s)-p[= ]+(\d{2,5})/, /PORT[= ]+(\d{2,5})/];
  for (const pattern of patterns) {
    const match = script.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function frameworkPort(deps: Set<string>, script: string): number | null {
  for (const [dependency, port] of Object.entries(FRAMEWORK_PORTS)) {
    if (deps.has(dependency) || script.includes(dependency)) return port;
  }
  return null;
}
