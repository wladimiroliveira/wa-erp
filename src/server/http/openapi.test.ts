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
