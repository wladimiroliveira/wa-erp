import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "@/proxy";
import { REQUEST_PATH_HEADER, SESSION_COOKIE } from "@/server/auth/proxy-contract";

const SRC = resolve(__dirname);

function resolveLocal(specifier: string, from: string): string | null {
  let base: string;

  if (specifier.startsWith("@/")) base = resolve(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(from), specifier);
  else return null;

  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];

  return candidates.find((candidate) => existsSync(candidate) && candidate.match(/\.tsx?$/)) ?? null;
}

type ImportGraph = { modules: Set<string>; packages: Set<string> };

// Every local module and every package the file pulls in at runtime; `import type` vanishes at
// build and does not count.
function runtimeImportsOf(file: string, graph: ImportGraph = { modules: new Set(), packages: new Set() }): ImportGraph {
  if (graph.modules.has(file)) return graph;
  graph.modules.add(file);

  const source = readFileSync(file, "utf8");

  for (const [, typeOnly, specifier = ""] of source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"([^"]+)"/gm)) {
    if (typeOnly) continue;
    const target = resolveLocal(specifier, file);
    if (target === null) graph.packages.add(specifier);
    else runtimeImportsOf(target, graph);
  }

  return graph;
}

const proxyGraph = () => runtimeImportsOf(resolve(SRC, "proxy.ts"));

describe("proxy", () => {
  // Server code that imports a "use client" module gets client references, not values: a constant
  // turns into a function that throws, and that is what ended up spelled out in the sign-in URL.
  it("does not reach a client module, not even through another import", () => {
    const clientModules = [...proxyGraph().modules].filter((file) =>
      /^\s*["']use client["']/.test(readFileSync(file, "utf8")),
    );

    expect(clientModules).toEqual([]);
  });

  // The proxy runs on every request and only looks at whether a cookie is there: dragging Prisma
  // and the environment loader in for a cookie name is weight it never uses.
  it("pulls in no package but Next itself", () => {
    expect([...proxyGraph().packages]).toEqual(["next/server"]);
  });

  it("sends an anonymous visitor to the sign-in screen with the way back in `from`", () => {
    const response = proxy(new NextRequest("http://localhost:3000/daf?page=2"));
    const location = new URL(response.headers.get("location") ?? "");

    expect(location.pathname).toBe("/login");
    expect([...location.searchParams.keys()]).toEqual(["from"]);
    expect(location.searchParams.get("from")).toBe("/daf?page=2");
  });

  it("lets a visitor with the session cookie through", () => {
    const request = new NextRequest("http://localhost:3000/daf", {
      headers: { cookie: `${SESSION_COOKIE}=token` },
    });

    expect(proxy(request).headers.get("location")).toBeNull();
  });

  it.each([
    ["with", { cookie: `${SESSION_COOKIE}=stale` }],
    ["without", {}],
  ])("lets a visitor %s the cookie reach the end of a stale session", (_, headers) => {
    const request = new NextRequest("http://localhost:3000/session-ended?from=%2Fdaf", { headers });

    expect(proxy(request).headers.get("location")).toBeNull();
  });

  // A cookie that no longer opens a session is found out later, by the layout; the proxy hands it
  // the requested path so that sign-in screen can still offer the way back. Next carries a
  // rewritten request header to the render as `x-middleware-request-<name>`.
  it("hands the requested path on to the render", () => {
    const request = new NextRequest("http://localhost:3000/daf?page=2", {
      headers: { cookie: `${SESSION_COOKIE}=token`, [REQUEST_PATH_HEADER]: "/forged" },
    });

    expect(proxy(request).headers.get(`x-middleware-request-${REQUEST_PATH_HEADER}`)).toBe("/daf?page=2");
  });
});
