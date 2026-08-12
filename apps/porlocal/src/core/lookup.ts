import type { PorlocalConfig, ProjectConfig, ServerConfig } from "@porlocal/core";

export interface ResolvedServer {
  project: ProjectConfig;
  server: ServerConfig;
}

/** Resolves a server by id, by "project/server" name, or by a name unique across all projects. */
export function resolveServer(config: PorlocalConfig, ref: string): ResolvedServer | null {
  for (const project of config.projects) {
    const byId = project.servers.find((server) => server.id === ref);
    if (byId) return { project, server: byId };
  }

  if (ref.includes("/")) {
    const [projectName, serverName] = ref.split("/", 2);
    for (const project of config.projects) {
      if (project.name.toLowerCase() !== projectName.toLowerCase()) continue;
      const server = project.servers.find((s) => s.name.toLowerCase() === serverName.toLowerCase());
      if (server) return { project, server };
    }
    return null;
  }

  const matches: ResolvedServer[] = [];
  for (const project of config.projects) {
    for (const server of project.servers) {
      if (server.name.toLowerCase() === ref.toLowerCase()) matches.push({ project, server });
    }
  }
  return matches.length === 1 ? matches[0] : null;
}
