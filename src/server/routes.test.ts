import { describe, expect, it } from "vitest";
import { collectRoutes, openApiPathOf } from "@/server/routes";

describe("openApiPathOf", () => {
  it("turns a route file's path into the path the document uses", () => {
    expect(openApiPathOf("src/app/v1/products/[sku]/recipe/route.ts")).toBe("/v1/products/{sku}/recipe");
    expect(openApiPathOf("src/app/v1/health/route.ts")).toBe("/v1/health");
    expect(openApiPathOf("src/app/(group)/v1/x/route.ts")).toBe("/v1/x");
  });
});

// Every route and the rule it declares, in one readable list. Loosening a permission stops being a
// one-word change buried in a module and starts being a line in the diff of this snapshot.
describe("routes inventory", () => {
  it("matches the recorded access of every route", async () => {
    const routes = await collectRoutes();
    const inventory = routes.map((route) => `${route.method} ${route.path} -> ${route.spec.auth}`).sort();

    expect(inventory.join("\n")).toMatchSnapshot();
  });
});
