import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "@/server/http/openapi";
import { collectRoutes } from "@/server/routes";

// The checked-in document is what the mobile client generates its code from. Falling out of step
// with the routes is a contract break, so it fails here rather than in the other repository.
describe("openapi.json", () => {
  it("is the document the routes describe", async () => {
    const committed = JSON.parse(
      readFileSync(fileURLToPath(new URL("../../../openapi.json", import.meta.url)), "utf8"),
    );

    expect(buildOpenApiDocument(await collectRoutes())).toEqual(committed);
  });
});

describe("named schemas", () => {
  it("lives in components.schemas, with every $ref resolving there", async () => {
    const document = buildOpenApiDocument(await collectRoutes()) as {
      components: { schemas?: Record<string, unknown> };
      paths: unknown;
    };
    const json = JSON.stringify(document.paths);
    const refs = [...json.matchAll(/"\$ref":"([^"]+)"/g)].map((match) => match[1]!);

    expect(json).not.toContain('"definitions"');
    expect(json).not.toContain('"$defs"');
    expect(document.components.schemas).toHaveProperty("PreWeighingPlan");
    expect(document.components.schemas).toHaveProperty("PreWeighingStageBody");
    expect(Object.keys(document.components.schemas ?? {}).filter((name) => name.startsWith("__schema"))).toEqual([]);
    expect(refs.length).toBeGreaterThan(0);

    for (const ref of refs) {
      expect(ref).toMatch(/^#\/components\/schemas\//);
      expect(document.components.schemas).toHaveProperty(ref.replace("#/components/schemas/", ""));
    }
  });
});
