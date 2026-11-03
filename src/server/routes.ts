import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { RouteHandler, Spec } from "@/server/http/handler";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

const METHODS: readonly Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export type CollectedRoute = { method: Method; path: string; spec: Spec };

const APP_DIR = fileURLToPath(new URL("../app", import.meta.url));

/**
 * The path a route file answers at, as the OpenAPI document writes it: the segments under
 * `src/app`, route groups dropped, `[name]` as `{name}`.
 */
export function openApiPathOf(file: string): string {
  const segments = file.split(/[\\/]/);
  const start = segments.indexOf("app") + 1;

  return (
    "/" +
    segments
      .slice(start, -1)
      .filter((segment) => !segment.startsWith("("))
      .map((segment) => segment.replace(/^\[(\w+)\]$/, "{$1}"))
      .join("/")
  );
}

function* routeFilesUnder(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) yield* routeFilesUnder(path);
    else if (entry.name === "route.ts") yield path;
  }
}

/**
 * Every route of the API, read from the files under `src/app/v1`: the file system is the route
 * table, so a route declares its path once, where Next reads it, and the documentation and the
 * inventory read the same declaration. Only for scripts and tests: Next bundles nothing dynamic.
 */
export async function collectRoutes(): Promise<CollectedRoute[]> {
  const routes: CollectedRoute[] = [];

  for (const file of routeFilesUnder(join(APP_DIR, "v1"))) {
    const module: Partial<Record<Method, RouteHandler>> = await import(pathToFileURL(file).href);
    const path = openApiPathOf(`app${sep}${relative(APP_DIR, file)}`);

    for (const method of METHODS) {
      const handler = module[method];

      if (handler?.spec !== undefined) routes.push({ method, path, spec: handler.spec });
    }
  }

  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}
